import { Schema } from "effect";

/**
 * Runtime contracts shared by the Electron main process and the renderer.
 *
 * These are Effect Schemas rather than TypeScript-only interfaces, so every
 * value crossing the contextBridge boundary can be validated at runtime.
 */
export const RuntimeInfoSchema = Schema.Struct({
  app: Schema.Struct({
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
    packaged: Schema.Boolean,
    locale: Schema.NonEmptyString,
  }),
  versions: Schema.Struct({
    electron: Schema.NonEmptyString,
    chromium: Schema.NonEmptyString,
    node: Schema.NonEmptyString,
    v8: Schema.NonEmptyString,
  }),
  system: Schema.Struct({
    platform: Schema.NonEmptyString,
    arch: Schema.NonEmptyString,
    release: Schema.NonEmptyString,
    cpuCount: Schema.Int.check(Schema.isGreaterThan(0)),
    totalMemoryBytes: Schema.Int.check(Schema.isGreaterThan(0)),
    timezone: Schema.NonEmptyString,
  }),
  security: Schema.Struct({
    sandbox: Schema.Boolean,
    contextIsolation: Schema.Boolean,
    nodeIntegration: Schema.Boolean,
  }),
});

export type RuntimeInfo = Schema.Schema.Type<typeof RuntimeInfoSchema>;

export const PingResultSchema = Schema.Struct({
  receivedAt: Schema.Int.check(Schema.isGreaterThan(0)),
  processId: Schema.Int.check(Schema.isGreaterThan(0)),
  uptimeSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type PingResult = Schema.Schema.Type<typeof PingResultSchema>;

export const ThemeSchema = Schema.Literals(["dark", "light"]);

export type Theme = Schema.Schema.Type<typeof ThemeSchema>;
