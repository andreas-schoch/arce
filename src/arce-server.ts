import * as uWS from 'uWebSockets.js';
import {nanoid} from "nanoid";

export interface ArceCommand {
  id?: string;
  code: string;
}

export interface ArceResult {
  id: string;
  result: unknown;
  hasError?: boolean;
}

const sslCert = '';
const sslKey = '';

let socket: uWS.WebSocket | null;
let commandResult: Promise<ArceResult>;
let commandResolve: (value: (ArceResult | PromiseLike<ArceResult>)) => void;
let commandReject: (value: (ArceResult | PromiseLike<ArceResult>)) => void;

// TODO refactor into CLI utility so users can do something like: npx arce start-server -p 9001 -ssl-cert 'example.crt' -ssl-key 'example.key'
const app: uWS.TemplatedApp = (sslCert && sslKey) ? uWS.SSLApp({cert_file_name: sslCert, key_file_name: sslKey}) : uWS.App();

app.ws('/*', {
  idleTimeout: 0,
  open: openSocketHandler,
  close: closeSocketHandler,
  message: messageHandler
} as uWS.WebSocketBehavior);

app.get('/*', async (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
  res.writeStatus('200 OK').end('Hello there!');
});

app.post('/command', (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
  parseBody(res, async (body: ArceCommand) => {
    console.log('command body', body);
    commandResult = new Promise(function (resolve, reject) {
      commandResolve = resolve;
      commandReject = reject;
    });

    if (socket) {
      socket.send(JSON.stringify({id: nanoid(8), code: body.code} as ArceCommand));
    } else {
      console.log('no client is currently connected');
      res.writeStatus('404 Not Found').end('no client is currently connected');
    }

    try {
      const result: ArceResult = await commandResult;
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').end(JSON.stringify(result));
    } catch (e) {
      res.onAborted(() => console.error('Error occurred on the client', e));
      res.writeStatus('400 Bad Request').close(); // res.close calls onAborted
    }


  }, () => console.error('Error occurred on this server parsing the request body'));
});

app.listen(9001, _ => console.log(`Listening to port 9001`));

function openSocketHandler(ws: uWS.WebSocket): void {
  if (!socket) {
    console.log('Client connected');
    socket = ws;
  } else {
    console.warn('Attempt to open a second WebSocket not allowed');
    ws.close();
  }
}

function closeSocketHandler(ws: uWS.WebSocket): void {
  if (ws === socket) {
    console.log('Client disconnected');
    socket = null;
  }
}

function messageHandler(ws: uWS.WebSocket, message: ArrayBuffer) {
  const result: ArceResult = JSON.parse(Buffer.from(message).toString());
  console.log('websocket message received from client listener', result);
  !result.hasError ? commandResolve(result) : commandReject(result);

  // TODO implement some sort of retry mechanism on the client until server lets client know that it received the ArceResult
  // const ok = ws.send(message, false);
}

// https://github.com/uNetworking/uWebSockets.js/blob/master/examples/JsonPost.js
function parseBody(res: uWS.HttpResponse, successCB: (body: ArceCommand) => void, errorCB: () => void) {
  let buffer: Buffer;
  res.onData((ab: ArrayBuffer, isLast: boolean) => {
    const chunk: Buffer = Buffer.from(ab);
    if (isLast) {
      let json;
      try {
        json = JSON.parse((buffer ? Buffer.concat([buffer, chunk]) : chunk).toString());
      } catch (e) {
        res.writeStatus('400 Bad Request').close(); // res.close calls onAborted
        return;
      }
      successCB(json);
    } else {
      buffer = Buffer.concat(buffer ? [buffer, chunk] : [chunk]);
    }
  });
  res.onAborted(errorCB); // register error callback
}
