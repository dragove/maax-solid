import { Context, Effect, Layer } from "effect";
import type { StageCatalog as StageCatalogData } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import {
  activityStageEntries,
  clientKeyFor,
  decodeStageActivity,
  permanentStageEntries,
  STAGE_ACTIVITY_URL,
  type StageActivityResult,
} from "./stage-catalog";
import { Settings } from "./settings";

/** The activity list changes on maintenance days, not per request. */
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;

export interface StageCatalogApi {
  /** Permanent recommendations plus whatever activity windows are open now. */
  readonly catalog: Effect.Effect<StageCatalogData>;
}

export class StageCatalog extends Context.Service<StageCatalog, StageCatalogApi>()("maax/StageCatalog") {}

interface StageCache {
  readonly key: string;
  readonly at: number;
  readonly catalog: StageCatalogData;
}

export const StageCatalogLive: Layer.Layer<StageCatalog, never, Settings> = Layer.effect(
  StageCatalog,
  Effect.gen(function* () {
    const settings = yield* Settings;
    let cache: StageCache | undefined;

    const fetchActivity = (
      client: string,
      locale: string,
      now: number,
    ): Effect.Effect<StageActivityResult, MaaxError> =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async (): Promise<unknown> => {
            const response = await fetch(STAGE_ACTIVITY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          },
          catch: (cause) => maaxError("活动关卡获取失败", cause),
        });
        const data = yield* decodeStageActivity(raw);
        return { entries: activityStageEntries(data, client, locale, now) };
      });

    const catalog = Effect.gen(function* () {
      const current = yield* settings.get;
      const locale = current.locale;
      const client = clientKeyFor(current.clientType);
      const key = `${client}:${locale}`;
      const at = Date.now();
      if (cache !== undefined && cache.key === key && at - cache.at < CACHE_TTL_MS) return cache.catalog;

      const permanent = permanentStageEntries(locale);
      const fallback: StageActivityResult = {
        entries: [],
        warning: locale === "zh-CN" ? "已显示常驻推荐关卡。" : "Showing permanent stage recommendations only.",
      };
      const activity = yield* fetchActivity(client, locale, at).pipe(Effect.orElseSucceed(() => fallback));
      const next: StageCatalogData = {
        entries: [permanent[0]!, ...activity.entries, ...permanent.slice(1)],
        updatedAt: Date.now(),
        ...(activity.warning === undefined ? {} : { warning: activity.warning }),
      };
      cache = { key, at: Date.now(), catalog: next };
      return next;
    });

    return { catalog } satisfies StageCatalogApi;
  }),
);
