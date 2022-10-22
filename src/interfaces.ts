import {WebSocket} from "uWebSockets.js";
import {WaitUntilFn} from "./util/waitUntil";

export type ScriptContextInternal = Record<string, unknown>;

export interface ArceBaseCommand<T = ScriptContextInternal> {
  status: 102 | 200 | 400 | 404 | 408 | 500; // corresponds to http status codes
  awaitId: string;
  script: string;
  scriptContext: T;
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
  scriptContext: ScriptContextInternal;
}

export interface ConnectedClient {
  socket: WebSocket | null;
  commands: Map<string, ArceCommand>
}

export type WindowExtendable = Window & { [key: string]: unknown };
export type ScriptFnParams<T = Record<string, unknown>> = {
  waitUntil: WaitUntilFn,
  capture: (data: unknown) => void,
  done: () => void,
  scriptContext: T,
  global: WindowExtendable
};

export type ScriptFn<T = Record<string, unknown>> = (util: ScriptFnParams<T>) => void | Promise<void>;
