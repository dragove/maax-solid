import { Context, Effect, Layer, Ref, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import semver from "semver";
import { CoreInfoSchema, type CoreInfo, type CoreSource } from "../../shared/schemas";
import { maaxError } from "../errors";
import { AppPaths } from "./paths";
import { readJson, writeJson } from "./json-store";

const CoresFileSchema = Schema.Array(CoreInfoSchema);

export interface CoreRegistryApi {
  readonly list: Effect.Effect<ReadonlyArray<CoreInfo>>;
  readonly get: (id: string) => Effect.Effect<CoreInfo | undefined>;
  readonly refresh: Effect.Effect<ReadonlyArray<CoreInfo>>;
  readonly addLocal: (
    root: string,
    source?: CoreSource,
    managed?: boolean,
  ) => Effect.Effect<CoreInfo, import("../errors").MaaxError>;
  readonly remove: (id: string) => Effect.Effect<ReadonlyArray<CoreInfo>>;
  readonly markVersion: (id: string, version: string) => Effect.Effect<void>;
}

export class CoreRegistry extends Context.Service<CoreRegistry, CoreRegistryApi>()(
  "maax/CoreRegistry",
) {}

const versionFromRoot = (root: string): string => {
  const name = basename(root);
  const match = /MAA-v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?)-/u.exec(name);
  if (match?.[1]) return `v${match[1]}`;
  const loose = semver.coerce(name);
  return loose ? `v${loose.version}` : name;
};

const coreIdFor = (root: string): string =>
  `local:${createHash("sha1").update(root).digest("hex").slice(0, 10)}`;

const sortCores = (cores: ReadonlyArray<CoreInfo>): ReadonlyArray<CoreInfo> =>
  [...cores].sort((a, b) => {
    const left = semver.coerce(a.version);
    const right = semver.coerce(b.version);
    if (left && right) return semver.rcompare(left, right);
    return b.version.localeCompare(a.version);
  });

const inspectCore = (
  fs: FileSystem,
  root: string,
): Effect.Effect<{ status: CoreInfo["status"]; libPath: string; resourcePath: string }> =>
  Effect.gen(function* () {
    const libPath = join(root, "libMaaCore.so");
    const resourcePath = join(root, "resource");
    const libExists = yield* fs.exists(libPath).pipe(Effect.orElseSucceed(() => false));
    const resourceExists = yield* fs
      .exists(join(resourcePath, "config.json"))
      .pipe(Effect.orElseSucceed(() => false));
    return {
      status: libExists && resourceExists ? "ready" : libExists ? "broken" : "missing",
      libPath,
      resourcePath,
    };
  });

export const CoreRegistryLive: Layer.Layer<CoreRegistry, never, AppPaths | FileSystem> =
  Layer.effect(
    CoreRegistry,
    Effect.gen(function* () {
      const paths = yield* AppPaths;
      const fs = yield* FileSystem;
      yield* fs
        .makeDirectory(paths.configDir, { recursive: true })
        .pipe(Effect.orElseSucceed(() => undefined));

      const stored = yield* readJson(paths.coresFile, CoresFileSchema, []);
      const coreRef = yield* Ref.make<ReadonlyArray<CoreInfo>>(stored);

      const persist = (cores: ReadonlyArray<CoreInfo>) =>
        writeJson(paths.coresFile, [...cores]).pipe(
          Effect.asVoid,
          Effect.provideService(FileSystem, fs),
        );

      const revalidate = (core: CoreInfo) =>
        Effect.gen(function* () {
          const info = yield* inspectCore(fs, core.root);
          return { ...core, ...info } satisfies CoreInfo;
        });

      const refresh = Effect.gen(function* () {
        const current = yield* Ref.get(coreRef);
        const next = yield* Effect.forEach(current, revalidate, { concurrency: 4 });
        yield* Ref.set(coreRef, next);
        yield* persist(next);
        return next;
      });

      const addLocal = (root: string, source: CoreSource = "import", managed = false) =>
        Effect.gen(function* () {
          const trimmed = root.trim();
          if (trimmed === "") return yield* Effect.fail(maaxError("目录为空"));
          const absolute = trimmed.startsWith("/") ? trimmed : join(process.cwd(), trimmed);
          const current = yield* Ref.get(coreRef);
          const existing = current.find((core) => core.root === absolute);
          if (existing) return existing;

          const info = yield* inspectCore(fs, absolute);
          if (info.status !== "ready") {
            return yield* Effect.fail(
              maaxError(
                "这个目录不是有效的 MaaCore 安装",
                `需要 ${join(absolute, "libMaaCore.so")} 与 ${join(absolute, "resource/config.json")}`,
              ),
            );
          }
          const version = versionFromRoot(absolute);
          const core: CoreInfo = {
            id: coreIdFor(absolute),
            label: basename(absolute),
            version,
            channel: "local",
            source,
            root: absolute,
            libPath: info.libPath,
            resourcePath: info.resourcePath,
            managed,
            status: "ready",
          };
          const next = sortCores([...current, core]);
          yield* Ref.set(coreRef, next);
          yield* persist(next);
          return core;
        });

      const remove = (id: string) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(coreRef);
          const next = current.filter((core) => core.id !== id);
          yield* Ref.set(coreRef, next);
          yield* persist(next);
          return next;
        });

      const markVersion = (id: string, version: string) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(coreRef);
          const next = current.map((core) => (core.id === id ? { ...core, version } : core));
          yield* Ref.set(coreRef, next);
          yield* persist(next);
        });

      const get = (id: string) =>
        Ref.get(coreRef).pipe(Effect.map((cores) => cores.find((core) => core.id === id)));

      // Expose the prebuilt bundle for local development without copying it.
      if (!process.env.MAAX_DEV_CORE?.trim()) {
        const api: CoreRegistryApi = {
          list: Ref.get(coreRef),
          get,
          refresh,
          addLocal,
          remove,
          markVersion,
        };
        return api;
      }

      const devRoot = process.env.MAAX_DEV_CORE.trim();
      const devInfo = yield* inspectCore(fs, devRoot);
      if (devInfo.status === "ready") {
        const current = yield* Ref.get(coreRef);
        if (!current.some((core) => core.root === devRoot)) {
          const version = versionFromRoot(devRoot);
          const core: CoreInfo = {
            id: coreIdFor(devRoot),
            label: `${basename(devRoot)} (dev)`,
            version,
            channel: "local",
            source: "development",
            root: devRoot,
            libPath: devInfo.libPath,
            resourcePath: devInfo.resourcePath,
            managed: false,
            status: "ready",
          };
          const next = sortCores([...current, core]);
          yield* Ref.set(coreRef, next);
          yield* persist(next);
        }
      }

      const api: CoreRegistryApi = {
        list: Ref.get(coreRef),
        get,
        refresh,
        addLocal,
        remove,
        markVersion,
      };
      return api;
    }),
  );
