import { Context, Effect, Layer, Ref } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  CopilotSetupSchema,
  DEFAULT_COPILOT_SETUP,
  type CopilotOptions,
  type CopilotSetup,
} from "../../shared/schemas";
import type { MaaxError } from "../errors";
import { AppPaths } from "./paths";
import { readJson, writeJson } from "./json-store";

/**
 * The copilot tab's saved state: the assignment batch and its options.
 *
 * It lives in its own file rather than in a task plan, because clearing a stage
 * with a copilot is a one-off action, not part of the daily queue.
 */
export interface CopilotSetupApi {
  readonly get: Effect.Effect<CopilotSetup>;
  readonly updateOptions: (patch: Partial<CopilotOptions>) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly setItems: (items: CopilotSetup["items"]) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly reset: Effect.Effect<CopilotSetup>;
}

export class CopilotSetupStore extends Context.Service<CopilotSetupStore, CopilotSetupApi>()(
  "maax/CopilotSetupStore",
) {}

export const CopilotSetupLive: Layer.Layer<CopilotSetupStore, never, AppPaths | FileSystem> = Layer.effect(
  CopilotSetupStore,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(paths.configDir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));

    const loaded = yield* readJson(paths.copilotSetupFile, CopilotSetupSchema, DEFAULT_COPILOT_SETUP).pipe(
      Effect.orElseSucceed(() => DEFAULT_COPILOT_SETUP),
    );
    const ref = yield* Ref.make<CopilotSetup>({
      items: [...loaded.items],
      options: { ...DEFAULT_COPILOT_SETUP.options, ...loaded.options },
    });

    const persist = (value: CopilotSetup) =>
      writeJson(paths.copilotSetupFile, value).pipe(Effect.asVoid, Effect.provideService(FileSystem, fs));

    const write = (next: CopilotSetup) =>
      Effect.gen(function* () {
        yield* Ref.set(ref, next);
        yield* persist(next);
        return next;
      });

    const updateOptions = (patch: Partial<CopilotOptions>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const options = { ...current.options, ...patch };
        if (!Number.isFinite(options.loopTimes) || options.loopTimes < 1) options.loopTimes = 1;
        if (!Number.isFinite(options.formationIndex) || options.formationIndex < 0) options.formationIndex = 0;
        if (![0, 1, 2, 3].includes(options.supportUnitUsage)) options.supportUnitUsage = 0;
        return yield* write({ ...current, options });
      });

    const setItems = (items: CopilotSetup["items"]) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        return yield* write({ ...current, items: [...items] });
      });

    const reset = write({ items: [], options: { ...DEFAULT_COPILOT_SETUP.options } });

    return {
      get: Ref.get(ref),
      updateOptions,
      setItems,
      reset,
    } satisfies CopilotSetupApi;
  }),
);
