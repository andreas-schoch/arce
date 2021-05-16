import {ArceCommand, ArceResult} from "./arce-server";

// TODO combine into single ARCE class with a startServer() and a startClient() method (Check what is better for treeshaking first).
export class ARCE {
  url: string;
  socket: WebSocket | undefined

  constructor(url: string) {
    this.url = url;
  }

  startClient(): void {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => console.log('socket now open');
    this.socket.onmessage = (evt: MessageEvent<string>) => {
      const {id, code}: ArceCommand = JSON.parse(evt.data);
      console.log('Received command from websocket server', id, code);
      try {
        const result: unknown = new Function(code)();
        this.socket?.send(JSON.stringify({id, result}))
      } catch (err) {
        console.log('There was an error executing the command', err.message);
        this.socket?.send(JSON.stringify({id: id, result: err.message, hasError: true} as ArceResult));
      }
    }
  }
}
