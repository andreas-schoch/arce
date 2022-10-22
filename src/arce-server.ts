import {App, HttpResponse, SSLApp, TemplatedApp, us_listen_socket_close, WebSocket} from "uWebSockets.js";
import * as fs from "fs";
import {ArceServerToClientMessage, ArceCommand, ArceClientToServerMessage, ConnectedClient, ArceBaseCommand, ScriptFn} from "./interfaces";
import {ArceClient} from "./arce-client";
import {randomUUID} from "crypto";
import {waitUntil} from "./util/waitUntil";
import path from "path";
import * as http from "http";
// TODO find better way. esprima doesn't seem to work with es6 imports
const esprima = require('esprima');


export class ArceServer {
  listenSocket: unknown = null;
  readonly client: ConnectedClient;
  readonly sslEnabled: boolean;
  protected readonly app: TemplatedApp;
  protected readonly port: number;

  constructor(cert_file_name = '', key_file_name = '', port = 12000) {
    this.client = {
      socket: null,
      commands: new Map(),
    };

    this.port = port;

    const filepathCert = path.resolve(__dirname, cert_file_name);
    const filepathKey = path.resolve(__dirname, key_file_name);

    this.sslEnabled = Boolean(cert_file_name && key_file_name && fs.existsSync(filepathCert) && fs.existsSync(filepathKey));
    cert_file_name && key_file_name && !this.sslEnabled && console.warn('ssl cert or key not found');
    this.app = this.sslEnabled ? SSLApp({cert_file_name: filepathCert, key_file_name: filepathKey}) : App();

    this.app.ws('/*', {
      maxPayloadLength: 2048 * 2048,
      idleTimeout: 0,
      open: this.openSocketHandler.bind(this),
      close: this.closeSocketHandler.bind(this),
      message: this.messageHandler.bind(this)
    });

    this.app.get('/*', async res => {
      res.writeHeader('Content-Type', 'application/json').writeStatus('200 OK').end(JSON.stringify({
        version: process.env.npm_package_version,
        // TODO eventually allow multiple clients and identify them by some kind of id. E.g. via localhost:12000/client?id="some-id".
        clientConnected: Boolean(this.client.socket)
      }));
    });

    this.app.get('/public/*', async res => {
      // TODO This temporary. Allow serving of all files in public folder. Useful for prefab helper scripts which client can load lazily on demand
      try {
        const filepath = path.resolve(__dirname, `./public/example-client.html`);
        let content = fs.readFileSync(filepath).toString();
        if (this.sslEnabled) content = content.split(`http://localhost:`).join(`https://localhost:`);
        if (this.port !== 12000) content = content.split(`:12000`).join(`:${port}`);
        res.writeHeader('Content-Type', 'text/html').writeStatus('200 OK').end(content);
      } catch (e) {
        res.writeStatus('404 Not Found').end();
      }
    });

    this.app.get('/client', async (res, req) => {
      const url = this.sslEnabled ? `wss://${req.getHeader('host')}` : `ws://${req.getHeader('host')}`;
      res.writeHeader('Content-Type', 'application/javascript').writeStatus('200 OK').end(this.getClientScript(url));
    });

    this.app.get('/command/:id', async (res, req) => {
      try {
        const command = this.client.commands.get(req.getParameter(0));
        if (!command) return res.writeStatus('404 Not Found').end();
        return this.jsonRes(res, command, 200);
      } catch (e) {
        res.writeStatus('500 Internal server error').end();
      }
    });

    this.app.post('/command', async (res, req) => {
      const query: Record<string, string> = Object.fromEntries(new URLSearchParams(req.getQuery()).entries());
      const {timeout, ...scriptContext} = query;
      const script = await this.parseBodyString(res);
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
    return new Promise(res => this.app.listen(this.port, (listenSocket: unknown) => {
      console.log(`ARCE Server started on ${this.sslEnabled ? 'https' : 'http'}://localhost:${this.port}, listenSocket:`, listenSocket);
      this.listenSocket = listenSocket;
      res(this);
    }));
  }

  stop(): ArceServer {
    if (this.listenSocket) {
      us_listen_socket_close(this.listenSocket);
      console.log(`ARCE Server stopped on ${this.sslEnabled ? 'https' : 'http'}://localhost:${this.port}, listenSocket:`, this.listenSocket);
      this.listenSocket = null;
    }
    return this;
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

  protected parseBodyString(res: HttpResponse): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer: Buffer;
      res.onData((ab, isLast) => {
        const chunk = Buffer.from(ab);
        isLast
          ? resolve((buffer ? Buffer.concat([buffer, chunk]) : chunk).toString())
          : buffer = Buffer.concat(buffer ? [buffer, chunk] : [chunk]);
      });
      res.onAborted(() => reject(null));
    });
  }

  protected jsonRes(res: HttpResponse, command: ArceCommand, statusOverride?: number): void {
    const baseCommand = this.toBaseCommand(command);
    const status = statusOverride || baseCommand.status;
    const statusCodeString = `${status} ${http.STATUS_CODES[status]}`;
    res.writeStatus(statusCodeString).writeHeader('Content-Type', 'application/json').end(JSON.stringify(baseCommand));
  }

  protected toBaseCommand({status, awaitId, captures, error, script, scriptContext}: ArceCommand): ArceBaseCommand {
    return {status, awaitId, captures, error, script, scriptContext};
  }

  protected isArceClientToServerErrorMessage(e: unknown): e is ArceClientToServerMessage {
    return Boolean(e && typeof e === 'object' && (e as ArceClientToServerMessage).type === 'error');
  }
}
