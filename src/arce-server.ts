import * as fs from "fs";
import {ArceServerToClientMessage, ArceCommand, ArceClientToServerMessage, ConnectedClient, ArceBaseCommand, ScriptFn} from "./interfaces";
import {ArceClient} from "./arce-client";
import {randomUUID} from "crypto";
import {waitUntil} from "./util/waitUntil";
import path from "path";
import http from "http";
import https from "https";
import express, {Express} from "express";
import {WebSocket, Server} from "ws";
import {Response, Request} from 'express-serve-static-core';
// TODO find better way. esprima doesn't seem to work with es6 imports
const esprima = require('esprima');


export class ArceServer {
  readonly client: ConnectedClient;
  readonly sslEnabled: boolean;
  protected readonly app: Express;
  protected readonly server: http.Server | https.Server;
  protected readonly port: number;

  constructor(cert_file_name = '', key_file_name = '', port = 12000) {
    this.app = express();
    // this.app.use(express.json());
    // this.app.use(express.text());
    this.client = {
      socket: null,
      commands: new Map(),
    };

    this.port = port;

    const certPath = path.resolve(__dirname, cert_file_name);
    const keyPath = path.resolve(__dirname, key_file_name);
    this.sslEnabled = Boolean(cert_file_name && key_file_name && fs.existsSync(certPath) && fs.existsSync(keyPath));
    cert_file_name && key_file_name && !this.sslEnabled && console.warn('ssl cert or key not found');

    // Workaround to be able to re-use the same port for both http requests and ws messages.
    // The http server listens to upgrade requests and delegates the relevant objects to the wsServer which then listens to messages.
    this.server = this.sslEnabled
      ? https.createServer({key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8')}, this.app)
      : http.createServer(this.app);
    const wsServer = new Server({noServer: true});
    wsServer.on('connection', socket => {
      this.openSocketHandler(socket);
      socket.on('close', this.closeSocketHandler.bind(this, socket));
      socket.on('message', this.messageHandler.bind(this, socket));
    });

    this.server.on('upgrade', (request, socket, head) => {
      wsServer.handleUpgrade(request, socket, head, socket => {
        wsServer.emit('connection', socket, request);
      });
    });

    this.app.get('/public*', async (req, res) => {
      // TODO with express there is probably a better way to send a template file than with uwebsocketsjs. Adjust
      // TODO This temporary. Allow serving of all files in public folder. Useful for prefab helper scripts which client can load lazily on demand
      try {
        const filepath = path.resolve(__dirname, `./public/example-client.html`);
        let content = fs.readFileSync(filepath).toString();
        if (this.sslEnabled) content = content.split(`http://localhost:`).join(`https://localhost:`);
        if (this.port !== 12000) content = content.split(`:12000`).join(`:${port}`);
        res.setHeader('Content-Type', 'text/html').status(200).end(content);
      } catch (e) {
        res.status(404).end();
      }
    });

    this.app.get('/client', async (req, res) => {
      const url = `${this.sslEnabled ? 'wss' : 'ws'}://${req.hostname}:${this.port}`;
      res.setHeader('Content-Type', 'application/javascript').status(200).end(this.getClientScript(url));
    });

    this.app.get('/command/:id', async (req, res) => {
      try {
        const command = this.client.commands.get(req.params.id);
        if (!command) return res.status(404).end();
        return this.jsonRes(res, command, 200);
      } catch (e) {
        res.status(500).end();
      }
    });

    this.app.get('/', async (req, res) => {
      res.setHeader('Content-Type', 'application/json').status(200).end(JSON.stringify({
        version: process.env.npm_package_version,
        // TODO eventually allow multiple clients and identify them by some kind of id. E.g. via localhost:12000/client?id="some-id".
        clientConnected: Boolean(this.client.socket)
      }));
    });

    this.app.post('/command', async (req, res) => {
      const {timeout, ...scriptContext} = req.query;
      const script = await this.parseBodyString(req);
      const command = await this.executeString(script, scriptContext, Number(timeout || 2500));
      this.jsonRes(res, command);
    });
  }

  async execute<T>(scriptFn: ScriptFn<T>, scriptContext: ArceCommand['scriptContext'] = {}, timeout = 2500): Promise<ArceCommand> {
    return this.executeString(scriptFn.toString(), scriptContext, timeout);
  }

  async executeString(script: ArceCommand['script'], scriptContext: ArceBaseCommand['scriptContext'], timeout = 2500): Promise<ArceCommand> {
    const command: ArceCommand = this.createArceCommand(script, scriptContext);
    if (command.error) return command; // syntax error in script or malformed scriptContext
    try {
      if (!this.client.socket) await waitUntil(() => this.client.socket, timeout);
      const message: ArceServerToClientMessage = {script: command.script, awaitId: command.awaitId, scriptContext: command.scriptContext};
      if (this.client.socket) this.client.socket.send(JSON.stringify(message));
      await command.promise;
      return command; // command was executed on client and signaled completion by calling done()
    } catch (e) {
      if (this.isArceClientToServerErrorMessage(e)) return command; // rejected by messageHandler
      else if (e === 'timeout') return {...command, status: 408, error: 'No client connected in time.'};
      else return {...command, status: 500, error: e instanceof Error ? e.message : JSON.stringify(e)};
    }
  }

  start(): Promise<ArceServer> {
    return new Promise(res => this.server.listen(this.port, () => {
      process.on('SIGTERM', async () => await this.stop());
      process.on('SIGINT', async () => await this.stop());
      console.log(`ARCE Server started on ${this.sslEnabled ? 'https' : 'http'}://localhost:${this.port}`);
      res(this);
    }));
  }

  stop(): Promise<ArceServer> {
    return new Promise(res => {
      console.log('Trying to shut down and close connections gracefully.');
      this.server.close(() => {
        console.log('Closed all connections.');
        res(this);
      });
    });
  }

  getClientScript(url: string) {
    return `${ArceClient.toString()}\n\nnew ${ArceClient.name}('${url}');`;
  }

  protected openSocketHandler(ws: WebSocket): void {
    if (!this.client.socket) {
      console.log('Client connected');
      this.client.socket = ws;
    } else {
      console.warn('Attempt to open a second WebSocket not allowed');
      ws.close();
    }
  }

  protected closeSocketHandler(ws: WebSocket): void {
    if (ws === this.client.socket) {
      console.log('Client disconnected');
      this.client.socket = null;
    }
  }

  protected messageHandler(ws: WebSocket, message: ArrayBuffer) {
    const arceResult: ArceClientToServerMessage = JSON.parse(Buffer.from(message).toString());
    const command = this.client.commands.get(arceResult.awaitId);
    if (command) {
      switch (arceResult.type) {
        case "capture":
          command.captures.push(arceResult.data);
          break;
        case "done":
          command.status = 200;
          command.resolve();
          break;
        case "error":
          // TODO handle errors for long running commands that continue to do things after done() was called
          command.status = 400;
          command.error = arceResult.error;
          command.reject(arceResult);
          break;
      }
    }
  }

  protected createArceCommand(script: ArceCommand['script'], scriptContext: ArceCommand['scriptContext']): ArceCommand {
    let resolve: ArceCommand['resolve'];
    let reject: ArceCommand['reject'];
    let status = 102;
    let error: string;
    const promise: ArceCommand['promise'] = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });

    try {
      esprima.parseScript(script);
    } catch (e) {
      // @ts-ignore
      error = `Script has syntax error: ${e.description}`;
      status = 400;
    }

    if (!script.trim()) {
      status = 400;
      error = 'Script cannot be empty.';
    }

    // @ts-ignore - promise executor fn is synchronous, so resolve and reject fns are already assigned.
    const command: ArceCommand = {script, scriptContext, awaitId: randomUUID(), captures: [], status, error, promise, resolve, reject};
    this.client.commands.set(command.awaitId, command);
    return command;
  }

  protected parseBodyString(res: Request): Promise<string> {
    // TODO should try to use this.app.use(express.json()); or .text() but returns empty object with req.body when sending javascript in body. Why?
    return new Promise((resolve) => {
      let acc = '';
      res.on('data', chunk => acc += chunk);
      res.on('end', () => resolve(acc));
    });
  }

  protected jsonRes(res: Response, command: ArceCommand, statusOverride?: number): void {
    const baseCommand = this.toBaseCommand(command);
    const status = statusOverride || baseCommand.status;
    res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(baseCommand));
  }

  protected toBaseCommand({status, awaitId, captures, error, script, scriptContext}: ArceCommand): ArceBaseCommand {
    return {status, awaitId, captures, error, script, scriptContext};
  }

  protected isArceClientToServerErrorMessage(e: unknown): e is ArceClientToServerMessage {
    return Boolean(e && typeof e === 'object' && (e as ArceClientToServerMessage).type === 'error');
  }
}
