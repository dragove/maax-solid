import { Context, Effect, Layer, Schema } from "effect";
import type { MaaxBridge } from "../../../shared/ipc";
import {
  PingResultSchema,
  RuntimeInfoSchema,
  type PingResult,
  type RuntimeInfo,
} from "../../../shared/schemas";

/**
 * Typed, schema-validated access to the sandboxed preload bridge.
 *
 * The service is exposed as Effect values rather than Promise methods so
 * consumers can compose calls, retries, timeouts, and interruption without
 * leaving the Effect runtime.
 */
export class DesktopBridge extends Context.Service<
  DesktopBridge,
  {
    readonly runtimeInfo: Effect.Effect<RuntimeInfo, DesktopBridgeError>;
    readonly ping: Effect.Effect<PingResult, DesktopBridgeError>;
  }
>()("maax/DesktopBridge") {}

export class DesktopBridgeError extends Schema.TaggedError<
  DesktopBridgeError,
  { readonly brand: unique symbol }
>()("DesktopBridgeError", {
  operation: Schema.String,
  reason: Schema.String,
}) {}

const errorReason = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const bridgeError = (operation: string, cause: unknown): DesktopBridgeError =>
  new DesktopBridgeError({ operation, reason: errorReason(cause) });

function getBridge(): MaaxBridge {
  if (!window.maax) {
    throw new Error("The secure preload bridge is unavailable.");
  }
  return window.maax;
}

const loadBridge = <A>(
  operation: string,
  invoke: () => Promise<unknown>,
  decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, DesktopBridgeError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: invoke,
      catch: (cause) => bridgeError(operation, cause),
    });

    return yield* decode(response).pipe(
      Effect.mapError((cause) => bridgeError(`invalid ${operation} response`, cause)),
    );
  });

export const DesktopBridgeLive = Layer.succeed(DesktopBridge, {
  runtimeInfo: loadBridge(
    "runtime-info",
    () => getBridge().getRuntimeInfo(),
    Schema.decodeUnknownEffect(RuntimeInfoSchema),
  ),
  ping: loadBridge("ping", () => getBridge().ping(), Schema.decodeUnknownEffect(PingResultSchema)),
});

export const runtimeInfoEffect = Effect.gen(function* () {
  const bridge = yield* DesktopBridge;
  return yield* bridge.runtimeInfo;
});

export const pingEffect = Effect.gen(function* () {
  const bridge = yield* DesktopBridge;
  return yield* bridge.ping;
});
