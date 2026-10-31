import { Context, Effect, Layer, Ref, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import semver from "semver";
import { coreLibraryPath, coreResourceConfigPath } from "../platform";
import { CoreInfoSchema, type CoreInfo, type CoreSource } from "../../shared/schemas";
import { maaxError } from "../errors";
import { AppPaths } from "./paths";
import { readJson, writeJson } from "./json-store";
import { RESOURCE_VERSION_FILE } from "../../shared/resource-version";

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
  /** Point an existing registry entry at a moved directory and revalidate it. */
  readonly relocate: (id: string, root: string) => Effect.Effect<CoreInfo, import("../errors").MaaxError>;
  readonly remove: (id: string) => Effect.Effect<ReadonlyArray<CoreInfo>>;
  readonly markVersion: (id: string, version: string) => Effect.Effect<void>;
}

export class CoreRegistry extends Context.Service<CoreRegistry, CoreRegistryApi>()("maax/CoreRegistry") {}

const versionFromRoot = (root: string): string => {
  const name = basename(root);
  const match = /MAA-v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?)-/u.exec(name);
  if (match?.[1]) return `v${match[1]}`;
  const loose = semver.coerce(name);
  return loose ? `v${loose.version}` : name;
};

const coreIdFor = (root: string): string => `local:${createHash("sha1").update(root).digest("hex").slice(0, 10)}`;

const sortCores = (cores: ReadonlyArray<CoreInfo>): ReadonlyArray<CoreInfo> =>
  [...cores].sort((a, b) => {
    const left = semver.coerce(a.version);
    const right = semver.coerce(b.version);
    if (left && right) return semver.rcompare(left, right);
    return b.version.localeCompare(a.version);
  });

interface CoreInspection {
  readonly status: CoreInfo["status"];
  readonly libPath: string;
  readonly resourcePath: string;
  readonly resourceStamp?: string;
}

/** `resource/version.json` stamps the resource tree; a missing file is not an error. */
const readResourceStamp = (fs: FileSystem, resourcePath: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const text = yield* fs
      .readFileString(join(resourcePath, RESOURCE_VERSION_FILE))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (text === undefined) return undefined;
    const parsed = yield* Effect.try(() => JSON.parse(text) as unknown).pipe(Effect.orElseSucceed(() => undefined));
    const stamp = (parsed as { last_updated?: unknown } | undefined)?.last_updated;
    return typeof stamp === "string" ? stamp : undefined;
  });

const inspectCore = (fs: FileSystem, root: string): Effect.Effect<CoreInspection> =>
  Effect.gen(function* () {
    const libPath = coreLibraryPath(root);
    const resourcePath = join(root, "resource");
    const libExists = yield* fs.exists(libPath).pipe(Effect.orElseSucceed(() => false));
    const resourceExists = yield* fs.exists(coreResourceConfigPath(root)).pipe(Effect.orElseSucceed(() => false));
    const status = libExists && resourceExists ? "ready" : libExists ? "broken" : "missing";
    if (status !== "ready") return { status, libPath, resourcePath };
    const resourceStamp = yield* readResourceStamp(fs, resourcePath);
    return { status, libPath, resourcePath, ...(resourceStamp === undefined ? {} : { resourceStamp }) };
  });

export const CoreRegistryLive: Layer.Layer<CoreRegistry, never, AppPaths | FileSystem> = Layer.effect(
  CoreRegistry,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(paths.configDir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));

    const stored = yield* readJson(paths.coresFile, CoresFileSchema, []);
    const coreRef = yield* Ref.make<ReadonlyArray<CoreInfo>>(stored);

    const persist = (cores: ReadonlyArray<CoreInfo>) =>
      writeJson(paths.coresFile, [...cores]).pipe(Effect.asVoid, Effect.provideService(FileSystem, fs));

    const revalidate = (core: CoreInfo) =>
      Effect.gen(function* () {
        const info = yield* inspectCore(fs, core.root);
        // Drop the stored stamp first: an unreadable resource must not keep
        // advertising the previous version.
        return { ...core, ...info, resourceStamp: info.resourceStamp } satisfies CoreInfo;
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
        if (trimmed === "") return yield* maaxError("目录为空");
        // `resolve` handles both `/path` on Linux and `C:\path`/UNC paths on
        // Windows, including relative input typed into the import field.
        const absolute = resolve(trimmed);
        const current = yield* Ref.get(coreRef);
        const existing = current.find((core) => core.root === absolute);

        const info = yield* inspectCore(fs, absolute);
        if (info.status !== "ready") {
          return yield* maaxError(
            "这个目录不是有效的 MaaCore 安装",
            `需要 ${coreLibraryPath(absolute)} 与 ${coreResourceConfigPath(absolute)}`,
          );
        }
        const version = versionFromRoot(absolute);
        const core: CoreInfo = {
          id: existing?.id ?? coreIdFor(absolute),
          label: existing?.label ?? basename(absolute),
          version: existing?.version ?? version,
          channel: existing?.channel ?? "local",
          source: existing?.source ?? source,
          root: absolute,
          libPath: info.libPath,
          resourcePath: info.resourcePath,
          managed: existing?.managed ?? managed,
          status: "ready",
          ...(info.resourceStamp === undefined ? {} : { resourceStamp: info.resourceStamp }),
        };
        // Re-adding a path must refresh a stale/broken entry instead of
        // returning it unchanged after a repaired or re-downloaded install.
        const next = sortCores(
          existing ? current.map((item) => (item.id === core.id ? core : item)) : [...current, core],
        );
        yield* Ref.set(coreRef, next);
        yield* persist(next);
        return core;
      });

    const relocate = (id: string, root: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(coreRef);
        const existing = current.find((core) => core.id === id);
        if (!existing) return yield* maaxError("核心不存在");
        const absolute = resolve(root.trim());
        const info = yield* inspectCore(fs, absolute);
        if (info.status !== "ready") {
          return yield* maaxError(
            "移动后的目录不是有效的 MaaCore 安装",
            `需要 ${coreLibraryPath(absolute)} 与 ${coreResourceConfigPath(absolute)}`,
          );
        }
        const nextCore: CoreInfo = {
          ...existing,
          root: absolute,
          libPath: info.libPath,
          resourcePath: info.resourcePath,
          status: info.status,
          resourceStamp: info.resourceStamp,
        };
        const next = sortCores(current.map((core) => (core.id === id ? nextCore : core)));
        yield* Ref.set(coreRef, next);
        yield* persist(next);
        return nextCore;
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

    const get = (id: string) => Ref.get(coreRef).pipe(Effect.map((cores) => cores.find((core) => core.id === id)));

    // Expose the prebuilt bundle for local development without copying it.
    if (!process.env.MAAX_DEV_CORE?.trim()) {
      const api: CoreRegistryApi = {
        list: Ref.get(coreRef),
        get,
        refresh,
        addLocal,
        relocate,
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
          ...(devInfo.resourceStamp === undefined ? {} : { resourceStamp: devInfo.resourceStamp }),
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
      relocate,
      remove,
      markVersion,
    };
    return api;
  }),
);
