import {ArceServerToClientMessage, ArceClientToServerMessage} from "./interfaces";

export class ArceClient {
  socket: WebSocket | null;

  constructor(url: string, socket: WebSocket | null = null) {
    console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTOR ENABLED!', url);
    this.socket = socket || new WebSocket(url);

    this.socket.onclose = () => socket = null;
    this.socket.onopen = () => console.log('socket now open');
    this.socket.onmessage = (evt: MessageEvent<string>) => {
      const serverMessage: ArceServerToClientMessage = JSON.parse(evt.data);
      const capture = (data: unknown) => this.send({awaitId: serverMessage.awaitId, data, type: 'capture'});
      const done = () => setTimeout(() => this.send({awaitId: serverMessage.awaitId, data: null, type: 'done'}));

      console.log('Received message from websocket server', serverMessage);
      try {
        const res = new Function(`return ${serverMessage.script}`)()(this.waitUntil, capture, done);
        this.isPromise(res) && res.catch(e => this.send({awaitId: serverMessage.awaitId, data: this.getErrorMessage(e), type: 'error'}));
      } catch (error) {
        const errorMessage: string = this.getErrorMessage(error);
        console.log('There was an error executing the script', errorMessage);
        this.send({awaitId: serverMessage.awaitId, data: errorMessage, type: 'error'});
      }
    }
  }

  send(message: ArceClientToServerMessage): void {
    console.log('sending message to server', message);
    this.socket?.send(JSON.stringify(message));
  }

  private isPromise(p: unknown | Promise<unknown>): p is Promise<unknown> {
    return p !== null &&
      typeof p === 'object' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.then === 'function' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.catch === 'function';
  }

  private getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message
    else if (typeof e === 'string') return e
    else return JSON.stringify(e)
  }

  // TODO deduplicate
  private waitUntil = <T>(fn: () => T, timeout = 5000, interval = 100): Promise<T> => new Promise((res, rej) => {
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

export const getClientScript = (url: string) => `${ArceClient.toString()}\nnew ArceClient('${url}');`;
