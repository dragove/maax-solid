import { Context, Effect, Layer, Ref, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  AppSettingsSchema,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
} from "../../shared/schemas";
import { EventBus } from "../events";
import { maaxError } from "../errors";
import { AppPaths } from "./paths";
import { readJson, writeJson } from "./json-store";

export interface SettingsApi {
  readonly get: Effect.Effect<AppSettings>;
  readonly update: (
    patch: AppSettingsPatch,
  ) => Effect.Effect<AppSettings, import("../errors").MaaxError>;
}

export class Settings extends Context.Service<Settings, SettingsApi>()("maax/Settings") {}

export const SettingsLive: Layer.Layer<Settings, never, AppPaths | FileSystem | EventBus> =
  Layer.effect(
    Settings,
    Effect.gen(function* () {
      const paths = yield* AppPaths;
      const fs = yield* FileSystem;
      yield* fs
        .makeDirectory(paths.configDir, { recursive: true })
        .pipe(Effect.orElseSucceed(() => undefined));

      const bus = yield* EventBus;
      const loaded = yield* readJson(paths.settingsFile, AppSettingsSchema, DEFAULT_SETTINGS).pipe(
        Effect.map((value) => ({ ...DEFAULT_SETTINGS, ...value })),
      );
      const settingsRef = yield* Ref.make<AppSettings>(loaded);

      const persist = (value: AppSettings) =>
        writeJson(paths.settingsFile, value).pipe(
          Effect.asVoid,
          Effect.provideService(FileSystem, fs),
        );

      const update = (patch: AppSettingsPatch) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(settingsRef);
          const next: Record<string, unknown> = { ...current, ...patch };
          if (patch.activeCoreId === null) delete next.activeCoreId;
          const decoded = yield* Schema.decodeUnknownEffect(AppSettingsSchema)(next).pipe(
            Effect.mapError((cause) => maaxError("设置内容无效", cause)),
          );
          yield* Ref.set(settingsRef, decoded);
          yield* persist(decoded);
          bus.emit({ _tag: "settings-updated", settings: decoded });
          return decoded;
        });

      const api: SettingsApi = {
        get: Ref.get(settingsRef),
        update,
      };
      return api;
    }),
  );
