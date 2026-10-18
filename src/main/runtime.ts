import { app } from "electron";
import { cpus, release, totalmem } from "node:os";
import { Effect, Schema } from "effect";
import {
  PingResultSchema,
  RuntimeInfoSchema,
  type PingResult,
  type RuntimeInfo,
} from "../shared/schemas";

/**
 * Every IPC response is an Effect that both captures host state and validates
 * its own shape with Effect Schema before it reaches the contextBridge.
 */
export const readRuntimeInfo: Effect.Effect<RuntimeInfo, Schema.SchemaError> = Effect.gen(
  function* () {
    const payload = yield* Effect.sync(() => ({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        locale: app.getLocale(),
      },
      versions: {
        electron: process.versions.electron ?? "unknown",
        chromium: process.versions.chrome ?? "unknown",
        node: process.versions.node,
        v8: process.versions.v8,
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        release: release(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      security: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    }));

    return yield* Schema.decodeEffect(RuntimeInfoSchema)(payload);
  },
);

export const pingMainProcess: Effect.Effect<PingResult, Schema.SchemaError> = Effect.gen(
  function* () {
    const payload = yield* Effect.sync(() => ({
      receivedAt: Date.now(),
      processId: process.pid,
      uptimeSeconds: process.uptime(),
    }));

    return yield* Schema.decodeEffect(PingResultSchema)(payload);
  },
);
