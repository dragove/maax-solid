import { Context, Effect, Layer } from "effect";
import { copilotKindFromStageId } from "../../shared/copilot-kind";
import type {
  CopilotDetail,
  CopilotLevel,
  CopilotResolveResult,
  CopilotSearchItem,
  CopilotSearchResult,
  CopilotSetSearchResult,
} from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import {
  readCopilotDetail,
  resolveCopilot,
  searchCopilot,
  searchCopilotByIds,
  searchCopilotSets,
  type CopilotSearchParams,
  type CopilotSetSearchParams,
} from "./copilot";
import { findLevel, levelCachePath, LevelCatalogue } from "./level-catalog";
import { AppPaths } from "./paths";
import { PrtsClient } from "./prts";

/**
 * Copilot browser backend: one shared, rate-limited client plus a disk-cached
 * stage catalogue. Every lookup the UI performs funnels through here, so the
 * community API sees at most one request per gap no matter how the panel is used.
 */
export interface PrtsLibraryApi {
  readonly search: (params: CopilotSearchParams) => Effect.Effect<CopilotSearchResult, MaaxError>;
  /** Copilot sets ("作业集"): a curated list of assignment ids. */
  readonly setSearch: (params: CopilotSetSearchParams) => Effect.Effect<CopilotSetSearchResult, MaaxError>;
  /** Assignment summaries behind the ids one set lists, in the set's order. */
  readonly setItems: (ids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<CopilotSearchItem>, MaaxError>;
  readonly levels: (query: string) => Effect.Effect<ReadonlyArray<CopilotLevel>, MaaxError>;
  readonly resolve: (input: string) => Effect.Effect<CopilotResolveResult, MaaxError>;
  /** Read the downloaded JSON of a batch entry; `null` when it is gone or unreadable. */
  readonly detail: (filename: string) => Effect.Effect<CopilotDetail | null>;
  /** Like a PRTS assignment; a local file (id 0) is a no-op. */
  readonly like: (copilotId: number) => Effect.Effect<void, MaaxError>;
}

export class PrtsLibrary extends Context.Service<PrtsLibrary, PrtsLibraryApi>()("maax/PrtsLibrary") {}

export const PrtsLibraryLive: Layer.Layer<PrtsLibrary, never, AppPaths> = Layer.effect(
  PrtsLibrary,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const client = new PrtsClient();
    const catalogue = new LevelCatalogue(client, levelCachePath(paths.cacheDir));

    const search = (params: CopilotSearchParams) =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => catalogue.load(),
          catch: (cause) => maaxError("无法获取 PRTS 关卡数据", cause),
        });
        const codes = new Map(entries.map((entry) => [entry.stageId, entry.code]));

        // A user types `1-7` or `YW-EX-3`; the API filters on `main_01-07`.
        let stage = params.stage?.trim();
        if (stage !== undefined && stage !== "") {
          const resolved = findLevel(entries, stage);
          if (resolved) stage = resolved.stageId;
        }
        const result = yield* Effect.tryPromise({
          try: () => searchCopilot(client, { ...params, ...(stage ? { stage } : { stage: undefined }) }, codes),
          catch: (cause) => maaxError("作业搜索失败", cause),
        });
        return result;
      });

    const levels = (query: string) =>
      Effect.gen(function* () {
        const matches = yield* Effect.tryPromise({
          try: () => catalogue.search(query),
          catch: (cause) => maaxError("无法获取 PRTS 关卡数据", cause),
        });
        return matches;
      });

    // The path comes from saved batch entries, so the folder check lives in the
    // reader itself; a missing file is a normal "no detail" answer, not an error.
    const detail = (filename: string) => Effect.promise(() => readCopilotDetail(filename, paths.copilotDir));

    const like = (copilotId: number) =>
      Effect.gen(function* () {
        if (!Number.isSafeInteger(copilotId) || copilotId <= 0) return;
        yield* Effect.tryPromise({
          try: () => client.postJson("/copilot/rating", { id: copilotId, rating: "Like" }),
          catch: (cause) => maaxError("点赞失败", cause),
        });
      });

    const setSearch = (params: CopilotSetSearchParams) =>
      Effect.tryPromise({
        try: () => searchCopilotSets(client, params),
        catch: (cause) => maaxError("作业集搜索失败", cause),
      });

    // A set only stores ids; expanding it fetches the summaries behind them.
    const setItems = (ids: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => catalogue.load(),
          catch: (cause) => maaxError("无法获取 PRTS 关卡数据", cause),
        });
        const codes = new Map(entries.map((entry) => [entry.stageId, entry.code]));
        return yield* Effect.tryPromise({
          try: () => searchCopilotByIds(client, ids, codes),
          catch: (cause) => maaxError("读取作业集内容失败", cause),
        });
      });

    const resolve = (input: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => resolveCopilot(input, paths.copilotDir, client),
          catch: (cause) => maaxError(cause instanceof Error ? cause.message : String(cause)),
        });
        // Assignments carry the internal stage id; show the familiar code.
        const entries = yield* Effect.promise(() => catalogue.load().catch(() => []));
        return {
          ...result,
          items: result.items.map((item) => {
            const level = findLevel(entries, item.stage);
            // The SSS protocol marks itself; Paradox and SSS maps are recognised
            // by the catalogue's stage-id prefix. The marker wins when a brand
            // new map is not in the cached catalogue yet.
            const kind =
              item.kind === "sss" || item.kind === "paradox" ? item.kind : copilotKindFromStageId(level?.stageId);
            return { ...item, kind, stage: level?.code || item.stage };
          }),
        };
      });

    return { search, levels, resolve, detail, like, setSearch, setItems } satisfies PrtsLibraryApi;
  }),
);
