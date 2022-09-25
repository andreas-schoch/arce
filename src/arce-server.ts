import {App, HttpRequest, HttpResponse, SSLApp, TemplatedApp, WebSocket} from "uWebSockets.js";
import * as fs from "fs";
import {ArceServerToClientMessage, ArceCommand, ArceClientToServerMessage, ConnectedClient} from "./interfaces";
import {arceInjector} from "./arce-client";
import {randomUUID} from "crypto";
import {waitUntil} from "./util/waitUntil";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esprima = require('esprima'); // TODO find better way. esprima doesn't seem to work with es6 imports


export class ArceServer {
  private readonly app: TemplatedApp;
  private readonly client: ConnectedClient;
  private readonly sslEnabled: boolean;

  constructor(cert_file_name: string, key_file_name: string) {
    this.client = {
      socket: null,
      commands: new Map(),
    };

    this.sslEnabled = Boolean(cert_file_name && key_file_name && fs.existsSync(cert_file_name) && fs.existsSync(key_file_name));
    cert_file_name && key_file_name && !this.sslEnabled && console.warn('ssl cert or key not found');
    this.app = this.sslEnabled ? SSLApp({cert_file_name, key_file_name}) : App();

    this.app.ws('/*', {
      idleTimeout: 0,
      open: this.openSocketHandler.bind(this),
      close: this.closeSocketHandler.bind(this),
      message: this.messageHandler.bind(this)
    });

    this.app.get('/*', async (res: HttpResponse, req: HttpRequest) => {
      res.writeStatus('200 OK').end('Hello there!');
    });

    this.app.get('/client', async (res: HttpResponse, req: HttpRequest) => {
      const url = this.sslEnabled ? `wss://${req.getHeader('host')}` : `ws://${req.getHeader('host')}`;
      const injectorIIFE = `(${arceInjector.toString()})('${url}')`;
      res.writeHeader('Content-Type', 'application/javascript').writeStatus('200 OK').end(injectorIIFE);
    });

    this.app.get('/command/:id', async (res: HttpResponse, req: HttpRequest) => {
      try {
        const query = new URLSearchParams(req.getQuery());
        const command = this.client.commands.get(req.getParameter(0));
        if (!command) return res.writeStatus('404 Not Found').end();
        const numCaptures = Number(query.get('num_captures') || 0);
        const timeout = Number(query.get('timeout') || 5000);
        await waitUntil(() => command.captures.length >= numCaptures, timeout);
        return res.writeHeader('Content-Type', 'application/json').writeStatus('200 OK').end(JSON.stringify(command));
      } catch (e) {
        if (e === 'timeout') res.writeStatus('408 Request Timeout').end();
        else res.writeStatus('500 Internal server error').end();
      }
    });

    this.app.post('/command', async (res: HttpResponse, req: HttpRequest) => {
      const script = await this.parseBodyString(res);
      if (!script) return res.writeStatus('400 Bad Request').end();
      const syntaxErrors: string = this.checkSyntaxErrors(script);
      if (syntaxErrors) return res.writeStatus('400 Bad Request').end(syntaxErrors);
      await this.commandHandler(res, script);
    });
  }

  start() {
    this.app.listen(12000, () => console.log(`ARCE Server running on localhost:12000`));
  }

  private async commandHandler(res: HttpResponse, script: ArceCommand['script']) {
    try {
      if (!this.client.socket) await waitUntil(() => this.client.socket);
      const command: ArceCommand = this.createArceCommand(script);
      const message: ArceServerToClientMessage = {script: command.script, awaitId: command.awaitId};
      this.client.socket?.send(JSON.stringify(message));
      await command.promise;
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').end(JSON.stringify(command));
    } catch (e) {
      if (e === 'timeout') res.writeStatus('408 Request Timeout').end();
      else if (e && typeof e === 'object' && 'type' in e) res.writeStatus('400 Bad Request').end(JSON.stringify(e));
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
      console.log('parseScript error', e);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return e.description;
    }
    return '';
  }
}
