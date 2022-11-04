import {ArceServerToClientMessage, ArceClientToServerMessage, ScriptFnParams, WindowExtendable} from "./interfaces";
import {WaitUntilFn} from "./util/waitUntil";

export class ArceClient {
  socket: WebSocket | undefined;

  constructor(url: string, socket?: WebSocket) {
    console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTOR ENABLED!', url);
    this.socket = this.openSocket(url, socket);
  }

  protected openSocket(url: string, socketOverride?: WebSocket): WebSocket {
    this.socket = socketOverride || new WebSocket(url);
    this.socket.onopen = () => console.log('socket now open');
    this.socket.onclose = () => setTimeout(() => this.openSocket(url, socketOverride), 3000);
    this.socket.onmessage = (evt: MessageEvent<string>) => {
      const serverMessage: ArceServerToClientMessage = JSON.parse(evt.data);
      console.log('Received message from websocket server', serverMessage);
      try {
        const fnParams: ScriptFnParams = {
          capture: (data: unknown) => this.send({awaitId: serverMessage.awaitId, data, type: 'capture'}),
          done: () => setTimeout(() => this.send({awaitId: serverMessage.awaitId, data: null, type: 'done'})),
          global: typeof window !== 'undefined' ? window as unknown as WindowExtendable : {} as WindowExtendable, // in case client isn't a browser
          waitUntil: this.waitUntil,
          scriptContext: serverMessage.scriptContext
        };
        const res = new Function(`return ${serverMessage.script}`)()(fnParams);
        this.isPromise(res) && res.catch(err => this.handleError(err, serverMessage));
      } catch (err) {
        this.handleError(err, serverMessage);
      }
    };
    return this.socket;
  }

  send(message: ArceClientToServerMessage): void {
    console.log('sending message to server', message);
    if (this.socket) this.socket.send(JSON.stringify(message));
  }

  protected handleError(err: unknown, serverMessage: ArceServerToClientMessage): void {
    console.log('There was an error executing the script', err);
    this.send({awaitId: serverMessage.awaitId, data: null, error: this.getErrorMessage(err), type: 'error'});
  }

  protected isPromise(p: unknown | Promise<unknown>): p is Promise<unknown> {
    return p !== null
      && typeof p === 'object'
      && typeof (p as Promise<unknown>).then === 'function'
      && typeof (p as Promise<unknown>).catch === 'function';
  }

  protected getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    else if (typeof e === 'string') return e;
    else return JSON.stringify(e);
  }

  // TODO deduplicate. Cannot import external functionality into this class as it gets stringified "as-is".
  //  Need a way to inline imports after ts compilation or load them lazily (e.g. serve utils like waitUntil and load on client via JSONP)
  protected waitUntil: WaitUntilFn = (fn, timeout = 5000, interval = 100) => new Promise((res, rej) => {
    const start = Date.now();
    const intervalHandle = setInterval(() => {
      const result = fn();
      if (result) {
        clearInterval(intervalHandle);
        res(result);
      } else if (Date.now() - start > timeout) {
        clearInterval(intervalHandle);
        rej('timeout');
      }
    }, interval);
  });
}
