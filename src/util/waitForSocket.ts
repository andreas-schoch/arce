import {ConnectedClient} from "../interfaces";

export const waitForOpenSocket = (client: ConnectedClient, timeout: number): Promise<void> => new Promise((res, rej) => {
  const start = Date.now();
  const intervalHandler = setInterval(() => {
    console.log('awaiting client socket connection...');
    if (client.socket) {
      clearInterval(intervalHandler);
      res();
    } else if (Date.now() - start > timeout) {
      clearInterval(intervalHandler);
      rej('timeout');
    }
  }, 1000);
})
