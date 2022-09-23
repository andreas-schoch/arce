import {ArceCommand, ArceResult} from "./interfaces";

export const arceInjector = (url: string) => {
  console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTION ENABLED!', url);

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

  const send = (arceResult: ArceResult) => {
    console.log('arceResult:', arceResult);
    return socket?.send(JSON.stringify(arceResult));
  };

  const socket: WebSocket = new WebSocket(url);
  socket.onopen = () => console.log('socket now open');
  socket.onmessage = (evt: MessageEvent<string>) => {
    const command: ArceCommand = JSON.parse(evt.data);
    console.log('Received command from websocket server', command);
    try {
      const result: unknown | Promise<unknown> = new Function(command.script)();
      isPromise(result)
        ? result.then((result: unknown) => send({awaitId: command.awaitId, result}))
        : send({awaitId: command.awaitId, result})
    } catch (error) {
      const message: string = error instanceof Error ? error.message : JSON.stringify(error);
      console.log('There was an error executing the command', message);
      const arceResult: ArceResult = {awaitId: command.awaitId, result: message, hasError: true};
      socket?.send(JSON.stringify(arceResult));
    }
  }
}
