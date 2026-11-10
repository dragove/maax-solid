import { Context, Effect, Layer } from "effect";
import { nativeImage } from "electron";
import { join } from "node:path";
import type { OperatorAvatar, OperatorEntry, RoguelikeOperator } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import { CoreRegistry } from "./core-registry";
import { OperatorCatalogue } from "./operator-catalog";
import {
  AVATAR_LIMIT,
  avatarPath,
  isAvatarId,
  mergeRoguelikeOperators,
  readStartingOperators,
} from "./roguelike-catalog";
import { Settings } from "./settings";

/**
 * Operator data for the pickers, read from the active core's resource tree.
 *
 * Everything here is best-effort: a missing core, a missing file or malformed
 * JSON must leave the form usable, so searches return a typed failure while the
 * suggestion lists degrade to empty.
 */
export interface OperatorLibraryApi {
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<OperatorEntry>, MaaxError>;
  readonly roguelike: (theme: string) => Effect.Effect<ReadonlyArray<RoguelikeOperator>>;
  readonly avatars: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<OperatorAvatar>>;
  /**
   * Names the active core knows, used only to decide whether a downloaded
   * assignment needs the elite-requirement repair: MaaCore skips its check for
   * operators missing from the core's own battle data.
   */
  readonly knownNames: Effect.Effect<ReadonlySet<string> | undefined>;
}

export class OperatorLibrary extends Context.Service<OperatorLibrary, OperatorLibraryApi>()("maax/OperatorLibrary") {}

export const OperatorLibraryLive: Layer.Layer<OperatorLibrary, never, Settings | CoreRegistry> = Layer.effect(
  OperatorLibrary,
  Effect.gen(function* () {
    const settings = yield* Settings;
    const registry = yield* CoreRegistry;
    const catalogue = new OperatorCatalogue();
    const avatarCache = new Map<string, string>();

    /**
     * Operators come from the active core's `resource/battle_data.json`, so the
     * list always matches the installed game data and costs no request.
     */
    const activeResourceRoot = Effect.gen(function* () {
      const currentSettings = yield* settings.get;
      const ready = (yield* registry.list).filter((core) => core.status === "ready");
      const active = currentSettings.activeCoreId
        ? ready.find((core) => core.id === currentSettings.activeCoreId)
        : ready[0];
      return active === undefined ? undefined : join(active.root, "resource");
    });

    const search = (query: string) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return yield* maaxError("没有可用的核心，无法读取干员数据");
        return yield* Effect.tryPromise({
          try: () => catalogue.search(root, query),
          catch: (cause) => maaxError("无法读取干员数据", cause),
        });
      });

    const roguelike = (theme: string) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return [] as ReadonlyArray<RoguelikeOperator>;
        const data = yield* Effect.tryPromise({
          try: () => catalogue.load(root),
          catch: (cause) => maaxError("无法读取干员数据", cause),
        }).pipe(Effect.orElseSucceed(() => undefined));
        if (data === undefined) return [] as ReadonlyArray<RoguelikeOperator>;
        const recommended = yield* Effect.tryPromise({
          try: () => readStartingOperators(root, theme),
          catch: () => maaxError("无法读取肉鸽开局干员推荐"),
        }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
        return mergeRoguelikeOperators(data, recommended);
      });

    /**
     * Downscaled avatars for the picker. `resource/template/avatar/<id>.png`
     * ships with the resource tree but only covers part of the catalogue, and a
     * hand-written custom name has no id at all, so the caller must render a
     * fallback badge for anything missing from the answer.
     */
    const avatars = (ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return [] as ReadonlyArray<OperatorAvatar>;
        const unique = [...new Set(ids.filter(isAvatarId))].slice(0, AVATAR_LIMIT);
        return yield* Effect.sync(() =>
          unique.flatMap((id) => {
            const key = `${root}|${id}`;
            const cached = avatarCache.get(key);
            if (cached !== undefined) return [{ id, dataUrl: cached }];
            const image = nativeImage.createFromPath(avatarPath(root, id));
            if (image.isEmpty()) return [];
            // 40 px matches the row; the source PNGs are several hundred pixels
            // wide and would dominate the IPC payload at full size.
            const dataUrl = image.resize({ width: 40, height: 40 }).toDataURL();
            avatarCache.set(key, dataUrl);
            return [{ id, dataUrl }];
          }),
        );
      });

    const knownNames = Effect.gen(function* () {
      const root = yield* activeResourceRoot;
      if (root === undefined) return undefined;
      const data = yield* Effect.tryPromise({
        try: () => catalogue.load(root),
        catch: (cause) => maaxError("无法读取干员数据", cause),
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (data === undefined) return undefined;
      const names = new Set<string>();
      for (const entry of data.entries) {
        names.add(entry.name);
        if (entry.nameEn !== "") names.add(entry.nameEn);
      }
      return names;
    });

    return { search, roguelike, avatars, knownNames } satisfies OperatorLibraryApi;
  }),
);
