import {App, HttpRequest, HttpResponse, SSLApp, TemplatedApp, us_listen_socket_close, WebSocket} from "uWebSockets.js";
import * as fs from "fs";
import {ArceServerToClientMessage, ArceCommand, ArceClientToServerMessage, ConnectedClient} from "./interfaces";
import {getClientScript} from "./arce-client";
import {randomUUID} from "crypto";
import {waitUntil} from "./util/waitUntil";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esprima = require('esprima'); // TODO find better way. esprima doesn't seem to work with es6 imports


export class ArceServer {
  listenSocket: unknown = null;
  readonly client: ConnectedClient;
  readonly sslEnabled: boolean;
  private readonly app: TemplatedApp;
  private readonly port: number;

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

    this.app.get('/*', async (res: HttpResponse, req: HttpRequest) => {
      res.writeHeader('Content-Type', 'application/json').writeStatus('200 OK').end(JSON.stringify({hello: 'there!'}));
    });

    this.app.get('/public/*', async (res: HttpResponse, req: HttpRequest) => {
      // TODO This temporary. Allow serving of all files in public folder. Useful for prefab helper scripts which client can load lazily on demand
      try {
        const filepath = path.resolve(__dirname, `./public/example-client.html`);
        let content = fs.readFileSync(filepath).toString()
        if (this.sslEnabled) content = content.split(`http://localhost:`).join(`https://localhost:`);
        if (this.port !== 12000) content = content.split(`:12000`).join(`:${port}`);
        res.writeHeader('Content-Type', 'text/html').writeStatus('200 OK').end(content);
      } catch (e) {
        res.writeStatus('404 Not Found').end();
      }
    });

    this.app.get('/client', async (res: HttpResponse, req: HttpRequest) => {
      const url = this.sslEnabled ? `wss://${req.getHeader('host')}` : `ws://${req.getHeader('host')}`;
      res.writeHeader('Content-Type', 'application/javascript').writeStatus('200 OK').end(getClientScript(url));
    });

    this.app.get('/command/:id', async (res: HttpResponse, req: HttpRequest) => {
      try {
        const command = this.client.commands.get(req.getParameter(0));
        if (!command) return res.writeStatus('404 Not Found').end();
        return res.writeHeader('Content-Type', 'application/json').writeStatus('200 OK').end(JSON.stringify(command));
      } catch (e) {
        res.writeStatus('500 Internal server error').end();
      }
    });

    this.app.post('/command', async (res: HttpResponse, req: HttpRequest) => {
      const query = new URLSearchParams(req.getQuery());
      const script = await this.parseBodyString(res);
      if (!script.trim()) return res.writeStatus('400 Bad Request').end();
      const syntaxError: string = this.checkSyntaxErrors(script);
      if (syntaxError) return res.writeStatus('400 Bad Request').writeHeader('Content-Type', 'application/json').end(JSON.stringify({syntaxError}));
      const timeout = Number(query.get('timeout') || 2500);
      await this.commandHandler(res, script, timeout);
    });
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

  private async commandHandler(res: HttpResponse, script: ArceCommand['script'], timeout: number) {
    try {
      if (!this.client.socket) await waitUntil(() => this.client.socket, timeout);
      const command: ArceCommand = this.createArceCommand(script);
      const message: ArceServerToClientMessage = {script: command.script, awaitId: command.awaitId};
      this.client.socket?.send(JSON.stringify(message));
      await command.promise;
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').end(JSON.stringify(command));
    } catch (e) {
      if (e === 'timeout') res.writeStatus('408 Request Timeout').end();
      else if (e && typeof e === 'object' && 'type' in e) res.writeStatus('400 Bad Request').writeHeader('Content-Type', 'application/json').end(JSON.stringify(e));
      else res.writeStatus('500 Internal server error').end();
    }
  }

  private openSocketHandler(ws: WebSocket): void {
    if (!this.client.socket) {
      console.log('Client connected');
      this.client.socket = ws;
    } else {
      console.warn('Attempt to open a second WebSocket not allowed');
      ws.close();
    }
  }

  private closeSocketHandler(ws: WebSocket): void {
    if (ws === this.client.socket) {
      console.log('Client disconnected');
      this.client.socket = null;
    }
  }

  private messageHandler(ws: WebSocket, message: ArrayBuffer) {
    const arceResult: ArceClientToServerMessage = JSON.parse(Buffer.from(message).toString());
    const command = this.client.commands.get(arceResult.awaitId);
    if (!command || !command.resolve || !command.reject) return;

    if (arceResult.type === 'capture') command.captures.push(arceResult.data);
    else if (arceResult.type === 'done') command.resolve();
    else if (arceResult.type === 'error') command.reject(arceResult);
  }

  private createArceCommand(script: string): ArceCommand {
    const command: ArceCommand = {script, awaitId: randomUUID(), captures: []};
    this.client.commands.set(command.awaitId, command);
    command.promise = new Promise((resolve, reject) => {
      command.resolve = resolve;
      command.reject = reject;
    });
    return command;
  }

  private parseBodyString(res: HttpResponse): Promise<string> {
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

  private checkSyntaxErrors(script: ArceCommand['script']): string {
    try {
      esprima.parseScript(script);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return e.description;
    }
    return '';
  }
}
