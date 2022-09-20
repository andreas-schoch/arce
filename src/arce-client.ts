import {ArceCommand, ArceResult} from "./interfaces";

export const arceInjector = (url: string) => {
  console.warn('ATTENTION: (A)RBITRARY (R)EMOTE (C)ODE (E)XECUTION ENABLED!', url);

  const socket: WebSocket = new WebSocket(url);
  socket.onopen = () => console.log('socket now open');
  socket.onmessage = (evt: MessageEvent<string>) => {
    const command: ArceCommand = JSON.parse(evt.data);
    console.log('Received command from websocket server', command);
    try {
      const result: unknown = new Function(command.script)(); // TODO add support for async scripts
      const arceResult: ArceResult = {awaitId: command.awaitId, result};
      console.log('arceResult:', result);
      socket?.send(JSON.stringify(arceResult));
    } catch (err) {
      console.log('There was an error executing the command', err);
      const result: ArceResult = {awaitId: command.awaitId, result: JSON.stringify(err), hasError: true};
      socket?.send(JSON.stringify(result));
    }
  }
}
