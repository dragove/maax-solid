import { Context, Effect, Layer } from "effect";
import type { CopilotLevel, CopilotResolveResult, CopilotSearchResult } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import { resolveCopilot, searchCopilot, type CopilotSearchParams } from "./copilot";
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
  readonly levels: (query: string) => Effect.Effect<ReadonlyArray<CopilotLevel>, MaaxError>;
  readonly resolve: (input: string) => Effect.Effect<CopilotResolveResult, MaaxError>;
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
          items: result.items.map((item) => ({
            ...item,
            stage: findLevel(entries, item.stage)?.code || item.stage,
          })),
        };
      });

    return { search, levels, resolve } satisfies PrtsLibraryApi;
  }),
);
