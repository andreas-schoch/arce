import {App, HttpRequest, HttpResponse, SSLApp, TemplatedApp, WebSocket} from "uWebSockets.js";
import * as fs from "fs";
import {parseBodyString} from "./util/parseBodyString";
import {ArceCommand, ArceResult, ConnectedClient} from "./interfaces";
import {waitForOpenSocket} from "./util/waitForSocket";
import {arceInjector} from "./arce-client";
import {randomUUID} from "crypto";
import {hasError} from "./util/isValidJavaScript";


export class ArceServer {
  private connectedClient: ConnectedClient;
  private app: TemplatedApp;
  private sslEnabled: boolean;

  constructor() {
    this.connectedClient = {
      socket: null,
      pendingCommands: new Map()
    };

    const cert_file_name = process.env.npm_config_ssl_cert || '';
    const key_file_name = process.env.npm_config_ssl_key || '';
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

    this.app.post('/inject', async (res: HttpResponse, req: HttpRequest) => {
      const script = await parseBodyString(res);
      if (!script || hasError(script)) return res.writeStatus('400 Bad Request').end();
      await this.commandHandler(res, script);
    });
  }

  start() {
    this.app.listen(12000, () => console.log(`ARCE Server running on localhost:12000`));
  }

  private async commandHandler(res: HttpResponse, script: ArceCommand['script']) {
    const command: ArceCommand = {script, awaitId: randomUUID()};
    this.connectedClient.pendingCommands.set(command.awaitId, command);
    command.commandResult = new Promise((resolve, reject) => {
      command.resolve = resolve;
      command.reject = reject;
    });

    if (!this.connectedClient.socket) await waitForOpenSocket(this.connectedClient, 30000);

    const clientCommand: ArceCommand = {script: command.script, awaitId: command.awaitId};
    this.connectedClient.socket?.send(JSON.stringify(clientCommand));

    try {
      const result: ArceResult = await command.commandResult;
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').end(JSON.stringify(result));
    } catch (e) {
      res.onAborted(() => console.error('Error occurred on the client', e));
      res.writeStatus('400 Bad Request').close(); // res.close calls onAborted
    }
  }

  private openSocketHandler(ws: WebSocket): void {
    if (!this.connectedClient.socket) {
      console.log('Client connected');
      this.connectedClient.socket = ws;
    } else {
      console.warn('Attempt to open a second WebSocket not allowed');
      ws.close();
    }
  }

  private closeSocketHandler(ws: WebSocket): void {
    if (ws === this.connectedClient.socket) {
      console.log('Client disconnected');
      this.connectedClient.socket = null;
    }
  }

  private messageHandler(ws: WebSocket, message: ArrayBuffer) {
    const result: ArceResult = JSON.parse(Buffer.from(message).toString());
    const pendingCommand = this.connectedClient.pendingCommands.get(result.awaitId);
    console.log('websocket message received from client listener', JSON.stringify(result));
    if (!pendingCommand?.resolve || !pendingCommand?.reject) return;
    !result.hasError ? pendingCommand.resolve(result) : pendingCommand.reject(result);
  }
}
