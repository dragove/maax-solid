/**
 * Private protocol between the Electron main process and the MaaCore utility
 * process. The utility process is the only place that touches koffi/native
 * code; this file stays dependency-free so it can be bundled into both sides.
 */

export interface InitRequest {
  readonly id: number;
  readonly op: "init";
  readonly coreRoot: string;
  readonly userDir: string;
  readonly resourceServer?: string;
}

export interface CreateSessionRequest {
  readonly id: number;
  readonly op: "create-session";
  readonly sessionId: string;
  readonly touchMode: string;
  readonly clientType: string;
}

export interface ConnectRequest {
  readonly id: number;
  readonly op: "connect";
  readonly sessionId: string;
  readonly adbPath: string;
  readonly address: string;
  readonly config: string;
}

export interface AppendTaskRequest {
  readonly id: number;
  readonly op: "append-task";
  readonly sessionId: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
}

export interface SessionRequest {
  readonly id: number;
  readonly op: "start" | "stop" | "disconnect" | "screenshot" | "destroy-session";
  readonly sessionId: string;
}

export interface SetTaskParamsRequest {
  readonly id: number;
  readonly op: "set-task-params";
  readonly sessionId: string;
  readonly taskId: number;
  readonly params: Record<string, unknown>;
}

export interface ShutdownRequest {
  readonly id: number;
  readonly op: "shutdown";
}

export type EngineRequest =
  | InitRequest
  | CreateSessionRequest
  | ConnectRequest
  | AppendTaskRequest
  | SessionRequest
  | SetTaskParamsRequest
  | ShutdownRequest;

export interface EngineError {
  readonly message: string;
  readonly stack?: string;
}

export interface EngineResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: EngineError;
}

export interface EngineCallback {
  readonly sessionId: string;
  readonly msg: number;
  readonly details: string;
}

export type EngineMessage =
  | EngineResponse
  | { readonly type: "callbacks"; readonly items: ReadonlyArray<EngineCallback> }
  | { readonly type: "log"; readonly level: string; readonly message: string }
  | { readonly type: "fatal"; readonly message: string };

export interface InitResult {
  readonly version: string;
}

export interface ConnectResult {
  readonly callId: number;
}

export interface AppendTaskResult {
  readonly taskId: number;
}

export interface ScreenshotResult {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface OkResult {
  readonly ok: boolean;
}
