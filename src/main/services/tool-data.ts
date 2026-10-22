import { Context, Effect, Layer, Ref, Schema } from "effect";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CoreInfo,
  DepotSnapshot,
  OperBoxSnapshot,
  RecruitmentData,
  RecruitmentOperator,
  ToolSnapshot,
  ToolsState,
} from "../../shared/schemas";
import { ToolsStateSchema } from "../../shared/schemas";
import { RECRUITMENT_TAG_EN } from "../../shared/recruitment";
import { parseDepotDetails, parseOperBoxDetails, type DepotItemIndex } from "../../shared/tools";
import { maaxError, type MaaxError } from "../errors";
import { CoreRegistry } from "./core-registry";
import { readJsonFile, writeJsonFile } from "./json-file";
import { AppPaths } from "./paths";
import { Settings } from "./settings";

interface RecruitmentFile {
  readonly operators?: ReadonlyArray<{ id?: unknown; name?: unknown; rarity?: unknown; tags?: unknown }>;
  readonly tags?: Readonly<Record<string, unknown>>;
}

interface BattleFile {
  readonly chars?: Readonly<Record<string, { name_en?: unknown }>>;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asTags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];

export interface ToolDataApi {
  readonly state: Effect.Effect<ToolsState>;
  readonly recruitment: (core: CoreInfo) => Effect.Effect<RecruitmentData, MaaxError>;
  /** Parse and persist one recognition callback frame for a device. */
  readonly apply: (
    deviceId: string,
    what: string,
    details: Record<string, unknown>,
  ) => Effect.Effect<ToolSnapshot | undefined>;
  readonly clear: (deviceId: string) => Effect.Effect<void>;
}

export class ToolData extends Context.Service<ToolData, ToolDataApi>()("maax/ToolData") {}

const decodeState = (raw: unknown): ToolsState => {
  if (raw === undefined) return {};
  try {
    return Schema.decodeUnknownSync(ToolsStateSchema)(raw);
  } catch {
    return {};
  }
};

export const ToolDataLive: Layer.Layer<ToolData, never, AppPaths | CoreRegistry | Settings> = Layer.effect(
  ToolData,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const registry = yield* CoreRegistry;
    const settings = yield* Settings;

    const loaded = decodeState(yield* Effect.promise(() => readJsonFile(paths.toolsFile)));
    const ref = yield* Ref.make<ToolsState>(loaded);
    let chain: Promise<void> = Promise.resolve();
    let itemIndexCache: { readonly root: string; readonly mtimeMs: number; readonly index: DepotItemIndex } | undefined;
    let recruitmentCache: { readonly root: string; readonly stamp: string; readonly data: RecruitmentData } | undefined;

    const persist = (state: ToolsState): Effect.Effect<void> =>
      Effect.promise(() => {
        chain = chain
          .then(() => writeJsonFile(paths.toolsFile, state))
          .catch((error: unknown) => console.warn("Failed to persist tool snapshots", error));
        return chain;
      });

    const activeCore = Effect.gen(function* () {
      const current = yield* settings.get;
      const ready = (yield* registry.list).filter((core) => core.status === "ready");
      return current.activeCoreId ? ready.find((core) => core.id === current.activeCoreId) : ready[0];
    });

    const readItemIndex = (root: string): Effect.Effect<DepotItemIndex> =>
      Effect.gen(function* () {
        const path = join(root, "resource", "item_index.json");
        const info = yield* Effect.promise(() => stat(path).catch(() => undefined));
        if (!info) return {};
        if (itemIndexCache?.root === root && itemIndexCache.mtimeMs === info.mtimeMs) return itemIndexCache.index;
        const raw = yield* Effect.promise(() =>
          readFile(path, "utf8")
            .then((text) => JSON.parse(text) as unknown)
            .catch(() => undefined),
        );
        const index: DepotItemIndex = {};
        if (typeof raw === "object" && raw !== null) {
          for (const [itemId, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value !== "object" || value === null) continue;
            const entry = value as { name?: unknown; classifyType?: unknown };
            index[itemId] = {
              ...(asString(entry.name) === undefined ? {} : { name: asString(entry.name) }),
              ...(asString(entry.classifyType) === undefined ? {} : { classifyType: asString(entry.classifyType) }),
            };
          }
        }
        itemIndexCache = { root, mtimeMs: info.mtimeMs, index };
        return index;
      });

    const recruitment = (core: CoreInfo) =>
      Effect.gen(function* () {
        const recruitmentPath = join(core.resourcePath, "recruitment.json");
        const battlePath = join(core.resourcePath, "battle_data.json");
        const [recruitmentInfo, battleInfo] = yield* Effect.promise(() =>
          Promise.all([stat(recruitmentPath).catch(() => undefined), stat(battlePath).catch(() => undefined)]),
        );
        if (!recruitmentInfo) return yield* maaxError("当前核心缺少 recruitment.json，无法计算公开招募");
        const stamp = `${recruitmentInfo.mtimeMs}:${battleInfo?.mtimeMs ?? 0}`;
        if (recruitmentCache?.root === core.root && recruitmentCache.stamp === stamp) return recruitmentCache.data;

        const [recruitmentRaw, battleRaw] = yield* Effect.promise(() =>
          Promise.all([
            readFile(recruitmentPath, "utf8").then((text) => JSON.parse(text) as unknown),
            battleInfo
              ? readFile(battlePath, "utf8").then((text) => JSON.parse(text) as unknown)
              : Promise.resolve(undefined),
          ]),
        ).pipe(Effect.mapError((cause) => maaxError("无法读取公开招募数据", cause)));

        const recruitmentFile = (
          typeof recruitmentRaw === "object" && recruitmentRaw !== null ? recruitmentRaw : {}
        ) as RecruitmentFile;
        const battleFile = (typeof battleRaw === "object" && battleRaw !== null ? battleRaw : {}) as BattleFile;
        const nameEnById = battleFile.chars ?? {};

        const operators: RecruitmentOperator[] = (recruitmentFile.operators ?? []).flatMap((entry) => {
          const id = asString(entry.id);
          const name = asString(entry.name);
          if (!id || !name) return [];
          const rarity = Number(entry.rarity);
          const nameEn = asString(nameEnById[id]?.name_en) ?? name;
          return [
            {
              id,
              name,
              nameEn,
              rarity: Number.isFinite(rarity) ? Math.max(1, Math.round(rarity)) : 1,
              tags: asTags(entry.tags),
            },
          ];
        });
        // The file's tag map is the authoritative tag list; derive from
        // operators only if an older core omits it.
        const tagNames =
          recruitmentFile.tags && Object.keys(recruitmentFile.tags).length > 0
            ? Object.keys(recruitmentFile.tags)
            : [...new Set(operators.flatMap((operator) => operator.tags))];
        const data: RecruitmentData = {
          coreId: core.id,
          tags: tagNames.map((name) => ({ name, nameEn: RECRUITMENT_TAG_EN[name] ?? name })),
          operators,
          updatedAt: Date.now(),
        };
        recruitmentCache = { root: core.root, stamp, data };
        return data;
      });

    const apply = (deviceId: string, what: string, details: Record<string, unknown>) =>
      Effect.gen(function* () {
        let parsed: OperBoxSnapshot | DepotSnapshot | undefined;
        if (what === "OperBoxInfo") {
          parsed = parseOperBoxDetails(details);
        } else if (what === "DepotInfo") {
          const core = yield* activeCore;
          const index = core ? yield* readItemIndex(core.root) : {};
          parsed = parseDepotDetails(details, index);
        } else {
          return undefined;
        }
        if (!parsed) return undefined;

        // Merge into the current state inside the ref update: two callbacks
        // from different devices must not overwrite each other.
        const snapshot = yield* Ref.modify(ref, (current) => {
          const previous = current[deviceId] ?? {};
          const merged: ToolSnapshot =
            what === "OperBoxInfo"
              ? { ...previous, operbox: parsed as OperBoxSnapshot }
              : { ...previous, depot: parsed as DepotSnapshot };
          return [merged, { ...current, [deviceId]: merged }] as const;
        });
        yield* persist(yield* Ref.get(ref));
        return snapshot;
      });

    const clear = (deviceId: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        if (current[deviceId] === undefined) return;
        const next = { ...current };
        delete next[deviceId];
        yield* Ref.set(ref, next);
        yield* persist(next);
      });

    return { state: Ref.get(ref), recruitment, apply, clear } satisfies ToolDataApi;
  }),
);
