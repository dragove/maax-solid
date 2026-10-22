import { Context, Effect, Layer, Ref, Schema } from "effect";
import { summarizeRuns } from "../../shared/history";
import { RunHistoryEntrySchema, type RunHistory as RunHistoryData, type RunHistoryEntry } from "../../shared/schemas";
import { readJsonFile, writeJsonFile } from "./json-file";
import { AppPaths } from "./paths";

const FileSchema = Schema.Array(RunHistoryEntrySchema);
const KEEP = 500;
const SHOWN = 100;

export interface RunHistoryApi {
  readonly result: Effect.Effect<RunHistoryData>;
  readonly add: (entry: RunHistoryEntry) => Effect.Effect<RunHistoryData>;
  readonly clear: Effect.Effect<RunHistoryData>;
}

export class RunHistory extends Context.Service<RunHistory, RunHistoryApi>()("maax/RunHistory") {}

const decode = (raw: unknown): ReadonlyArray<RunHistoryEntry> => {
  if (raw === undefined) return [];
  try {
    return Schema.decodeUnknownSync(FileSchema)(raw);
  } catch {
    return [];
  }
};

export const RunHistoryLive: Layer.Layer<RunHistory, never, AppPaths> = Layer.effect(
  RunHistory,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const loaded = decode(yield* Effect.promise(() => readJsonFile(paths.historyFile)));
    const ref = yield* Ref.make<ReadonlyArray<RunHistoryEntry>>(loaded);
    // Every write is serialized so two quick completions cannot interleave.
    let chain: Promise<void> = Promise.resolve();

    const persist = (entries: ReadonlyArray<RunHistoryEntry>): Effect.Effect<void> =>
      Effect.promise(() => {
        chain = chain
          .then(() => writeJsonFile(paths.historyFile, [...entries]))
          .catch((error: unknown) => console.warn("Failed to persist run history", error));
        return chain;
      });

    const result = Ref.get(ref).pipe(
      Effect.map((entries): RunHistoryData => ({
        entries: entries.slice(0, SHOWN),
        stats: summarizeRuns(entries),
      })),
    );

    const add = (entry: RunHistoryEntry) =>
      Effect.gen(function* () {
        // Two devices can finish at the same time; a read outside Ref.modify
        // would let one entry overwrite the other.
        const next = yield* Ref.modify(ref, (current) => {
          const updated = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, KEEP);
          return [updated, updated] as const;
        });
        yield* persist(next);
        return yield* result;
      });

    const clear = Effect.gen(function* () {
      yield* Ref.set(ref, []);
      yield* persist([]);
      return yield* result;
    });

    return { result, add, clear } satisfies RunHistoryApi;
  }),
);
