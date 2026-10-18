import { Context, Effect, Layer } from "effect";
import type { MaaxEvent } from "../shared/schemas";

export type EventListener = (event: MaaxEvent) => void;

/**
 * Small synchronous bus between the Effect services and the Electron window.
 * Event delivery is a hot path and never performs I/O, so it deliberately stays
 * outside Effect; services publish with `Effect.sync`.
 */
export class EventBus extends Context.Service<
  EventBus,
  {
    readonly emit: (event: MaaxEvent) => void;
    readonly on: (listener: EventListener) => () => void;
  }
>()("maax/EventBus") {}

export const EventBusLive = Layer.succeed(
  EventBus,
  (() => {
    const listeners = new Set<EventListener>();
    return {
      emit: (event: MaaxEvent) => {
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            console.error("Event listener failed", error);
          }
        }
      },
      on: (listener: EventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  })(),
);

export const emit = (event: MaaxEvent): Effect.Effect<void, never, EventBus> =>
  Effect.gen(function* () {
    const bus = yield* EventBus;
    return yield* Effect.sync(() => bus.emit(event));
  });
