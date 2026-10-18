import type { PingResult, RuntimeInfo } from "./schemas";

/**
 * The complete contract between the renderer and the Electron main process.
 * Keep this file free of Node.js, Electron, and Effect runtime imports so the
 * sandboxed preload can import it without pulling in extra dependencies.
 */
export const IPC_CHANNELS = {
  runtimeInfo: "maax:runtime-info",
  ping: "maax:ping",
} as const;

export interface MaaxBridge {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  ping(): Promise<PingResult>;
}
