import {ArceServerToClientMessage, ArceClientToServerMessage} from "./interfaces";

export class ArceClient {
  socket: WebSocket | null;

  constructor(url: string, socket: WebSocket | null = null) {
    console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTOR ENABLED!', url);
    this.socket = socket || new WebSocket(url); // passing socket to constructor makes it easier to mock and test ArceClient behaviour

    this.socket.onclose = () => this.socket = null;
    this.socket.onopen = () => console.log('socket now open');
    this.socket.onmessage = (evt: MessageEvent<string>) => {
      const serverMessage: ArceServerToClientMessage = JSON.parse(evt.data);
      const capture = (data: unknown) => this.send({awaitId: serverMessage.awaitId, data, type: 'capture'});
      const done = () => setTimeout(() => this.send({awaitId: serverMessage.awaitId, data: null, type: 'done'}));

      console.log('Received message from websocket server', serverMessage);
      try {
        const res = new Function(`return ${serverMessage.script}`)()(this.waitUntil, capture, done);
        this.isPromise(res) && res.catch(err => this.handleError(err, serverMessage));
      } catch (err) {
        this.handleError(err, serverMessage);
      }
    }
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
    return p !== null &&
      typeof p === 'object' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.then === 'function' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.catch === 'function';
  }

  protected getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message
    else if (typeof e === 'string') return e
    else return JSON.stringify(e)
  }

  // TODO deduplicate
  protected waitUntil = <T>(fn: () => T, timeout = 5000, interval = 100): Promise<T> => new Promise((res, rej) => {
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
  })
}
