import {ArceServerToClientMessage, ArceClientToServerMessage} from "./interfaces";

const arceInjector = (url: string) => {
  console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTOR ENABLED!', url);
  let socket: WebSocket | null = new WebSocket(url);

  const isPromise = (p: unknown | Promise<unknown>): p is Promise<unknown> => {
    return p !== null &&
      typeof p === 'object' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.then === 'function' &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      typeof p.catch === 'function';
  };

  const send = (message: ArceClientToServerMessage) => {
    console.log('sending message to server', message);
    socket?.send(JSON.stringify(message));
  };

  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message
    else if (typeof e === 'string') return e
    else return JSON.stringify(e)
  }

  // TODO deduplicate
  const waitUntil = <T>(fn: () => T, timeout = 5000, interval = 100): Promise<T> => new Promise((res, rej) => {
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

  socket.onclose = () => socket = null;
  socket.onopen = () => console.log('socket now open');
  socket.onmessage = (evt: MessageEvent<string>) => {
    const serverMessage: ArceServerToClientMessage = JSON.parse(evt.data);
    const capture = (data: unknown) => send({awaitId: serverMessage.awaitId, data, type: 'capture'});
    const done = () => setTimeout(() => send({awaitId: serverMessage.awaitId, data: null, type: 'done'}));

    console.log('Received message from websocket server', serverMessage);
    try {
      const res = new Function(`return ${serverMessage.script}`)()(waitUntil, capture, done);
      isPromise(res) && res.catch(e => send({awaitId: serverMessage.awaitId, data: getErrorMessage(e), type: 'error'}));
    } catch (error) {
      const errorMessage: string = error instanceof Error ? error.message : JSON.stringify(error);
      console.log('There was an error executing the script', errorMessage);
      send({awaitId: serverMessage.awaitId, data: getErrorMessage(error), type: 'error'});
    }
  }
}

export const getClientScript = (url: string) => `(${arceInjector.toString()})('${url}')`;
