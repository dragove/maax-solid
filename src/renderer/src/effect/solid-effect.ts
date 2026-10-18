import { Cause, Effect, Exit, Fiber, ManagedRuntime, type Layer } from "effect";
import { createContext, onCleanup, useContext } from "solid-js";
import type { DesktopBridge } from "./desktop";

/**
 * Solid 2 × Effect bridge, following the official Solid 2 Effect example.
 *
 * Reads are exposed as AsyncIterables because Solid 2 consumes async
 * computations natively: pending state flows into <Loading>, failures flow into
 * <Errored>, and closing a superseded iterator interrupts the underlying
 * Effect fiber.
 */
export type AppRuntime = ManagedRuntime.ManagedRuntime<DesktopBridge, never>;

export const RuntimeContext = createContext<AppRuntime | null>(null);

/** Build a ManagedRuntime owned by the current Solid subtree. */
export function createRuntime(layer: Layer.Layer<DesktopBridge, never, never>): AppRuntime {
  const parent = useContext(RuntimeContext);
  const runtime = ManagedRuntime.make(layer, parent ? { memoMap: parent.memoMap } : undefined);

  onCleanup(() => {
    void runtime.dispose();
  });

  return runtime;
}

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);

  if (!runtime) {
    throw new Error("Effect runtime is unavailable. Wrap this subtree in RuntimeContext.");
  }

  return runtime;
}

/**
 * Run an Effect as a single-value AsyncIterable.
 *
 * Solid closes the iterator when its computation is superseded or disposed;
 * that calls Effect's structured interruption, tearing down pending retries,
 * timeouts, and finalizers.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, DesktopBridge>): AsyncIterable<A> {
  const runtime = useAppRuntime();

  return {
    [Symbol.asyncIterator]() {
      const fiber = runtime.runFork(effect);
      let yielded = false;
      let closed = false;
      const done = { done: true, value: undefined } as const;

      return {
        async next(): Promise<IteratorResult<A>> {
          if (yielded || closed) return done;

          const exit = await Effect.runPromise(Fiber.await(fiber));
          if (closed) return done;

          if (Exit.isFailure(exit)) {
            closed = true;

            if (Cause.hasInterrupts(exit.cause)) return done;

            throw Cause.squash(exit.cause);
          }

          yielded = true;
          return { done: false, value: exit.value };
        },

        async return(): Promise<IteratorResult<A>> {
          if (!yielded && !closed) {
            closed = true;
            void Effect.runFork(Fiber.interrupt(fiber));
          }

          closed = true;
          return done;
        },
      };
    },
  };
}
