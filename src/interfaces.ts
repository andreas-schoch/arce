import {WebSocket} from "uWebSockets.js";

export interface ArceCommand {
  awaitId: string;
  script: string;
  commandResult?: Promise<ArceResult> | null;
  resolve?: (value: (ArceResult | PromiseLike<ArceResult>)) => void;
  reject?: (value: (ArceResult | PromiseLike<ArceResult>)) => void;
}

export interface ArceResult {
  awaitId: string;
  result: unknown;
  hasError?: boolean;
}

export interface ConnectedClient {
  socket: WebSocket | null;
  pendingCommands: Map<string, ArceCommand>
}
