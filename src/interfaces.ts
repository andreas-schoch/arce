import {WebSocket} from "uWebSockets.js";

export interface ArceCommand {
  awaitId: string;
  script: string;
  promise?: Promise<void>;
  resolve?: (value: (void | PromiseLike<void>)) => void;
  reject?: (value: (ArceClientToServerMessage | PromiseLike<ArceClientToServerMessage>)) => void;
  captures: unknown[];
}

export interface ArceClientToServerMessage {
  type: 'capture' | 'done' | 'error';
  awaitId: string;
  data: unknown;
}

export interface ArceServerToClientMessage {
  awaitId: string;
  script: string;
}

export interface ConnectedClient {
  socket: WebSocket | null;
  commands: Map<string, ArceCommand>
}
