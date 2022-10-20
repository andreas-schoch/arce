import {WebSocket} from "uWebSockets.js";


export interface ArceBaseCommand {
  status: 102 | 200 | 400 | 404 | 408 | 500; // corresponds to http status codes
  awaitId: string;
  script: string;
  captures: unknown[];
  error?: string;
}

export interface ArceCommand extends ArceBaseCommand {
  promise: Promise<void>;
  resolve: (value: (void | PromiseLike<void>)) => void;
  reject: (value: (ArceClientToServerMessage | PromiseLike<ArceClientToServerMessage>)) => void;
}

export interface ArceClientToServerMessage {
  type: 'capture' | 'done' | 'error';
  awaitId: string;
  data: unknown;
  error?: string;
}

export interface ArceServerToClientMessage {
  awaitId: string;
  script: string;
}

export interface ConnectedClient {
  socket: WebSocket | null;
  commands: Map<string, ArceCommand>
}

export type ScriptFn = (waitUntil: () => Promise<void>, capture: (value: unknown) => void, done: () => void, window: Window & {[key: string]: unknown}) => void | Promise<void>;
