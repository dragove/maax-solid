import { Context, Effect, Layer } from "effect";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CoreInfo,
  ResourceApplyResult,
  ResourceBackup,
  ResourceCheck,
  ResourceStatus,
} from "../../shared/schemas";
import type { DownloadProgress } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import { extractZip } from "../zip";
import { Downloader } from "./download";
import { AppPaths } from "./paths";
import { applyOverlay, listOverlayBackups, pruneOverlayBackups, restoreOverlay } from "./resource-overlay";
import { RESOURCE_VERSION_FILE, isNewerResourceStamp } from "../../shared/resource-version";

/**
 * Resource updates come from the MaaResource repository on GitHub.
 *
 * The branch archive only carries the JSON part of a resource tree (task,
 * stage and pipeline data); templates, OCR models and `config.json` stay in the
 * complete tree that ships with the installed MaaCore release. The update is
 * therefore an overlay applied on top of that tree, and the previous files are
 * kept so a bad update can be rolled back.
 */
const RESOURCE_VERSION_URL =
  "https://raw.githubusercontent.com/MaaAssistantArknights/MaaResource/main/resource/version.json";
const RESOURCE_ARCHIVE_URL = "https://codeload.github.com/MaaAssistantArknights/MaaResource/zip/refs/heads/main";
const ARCHIVE_ROOT = "MaaResource-main";
const KEEP_BACKUPS = 3;
const BACKUP_ID_PATTERN = /^[0-9A-Za-z._-]+$/u;

/** Development harness override; a packaged build always uses the defaults. */
const overriddenUrl = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value.trim() : fallback;
};

const backupIdFor = (stamp: string): string => stamp.replace(/[^0-9A-Za-z]+/gu, "-").replace(/^-+|-+$/gu, "");

export type ResourcePhase = DownloadProgress["phase"];
export type ResourceProgress = (phase: ResourcePhase, received: number, total: number, message?: string) => void;

export interface ResourceUpdaterApi {
  readonly status: (core: CoreInfo) => Effect.Effect<ResourceStatus>;
  readonly check: (core: CoreInfo) => Effect.Effect<ResourceCheck, MaaxError>;
  readonly apply: (core: CoreInfo, onProgress: ResourceProgress) => Effect.Effect<ResourceApplyResult, MaaxError>;
  readonly rollback: (
    core: CoreInfo,
    backupId: string,
    onProgress: ResourceProgress,
  ) => Effect.Effect<ResourceApplyResult, MaaxError>;
}

export class ResourceUpdater extends Context.Service<ResourceUpdater, ResourceUpdaterApi>()("maax/ResourceUpdater") {}

const readStampIn = async (resourceDirectory: string): Promise<string | undefined> => {
  const text = await readFile(join(resourceDirectory, RESOURCE_VERSION_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const raw = JSON.parse(text) as { last_updated?: unknown };
    return typeof raw.last_updated === "string" ? raw.last_updated : undefined;
  } catch {
    return undefined;
  }
};

export const ResourceUpdaterLive: Layer.Layer<ResourceUpdater, never, AppPaths | Downloader> = Layer.effect(
  ResourceUpdater,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const downloader = yield* Downloader;
    const backupsDirFor = (coreId: string): string => join(paths.resourceBackupsDir, coreId);
    const resourceDirFor = (core: CoreInfo): string => join(core.root, "resource");

    /**
     * The registry keeps a stamp for display, but the file on disk is the only
     * authority: it can change outside the app and a stale registry would make
     * an update look unnecessary.
     */
    const readLocalStamp = (core: CoreInfo): Effect.Effect<string | undefined> =>
      Effect.promise(() => readStampIn(resourceDirFor(core)));

    const fetchRemoteStamp = Effect.tryPromise({
      try: async (): Promise<string> => {
        const response = await fetch(overriddenUrl("MAAX_RESOURCE_VERSION_URL", RESOURCE_VERSION_URL), {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} while reading the resource version`);
        const raw = (await response.json()) as { last_updated?: unknown };
        if (typeof raw.last_updated !== "string" || raw.last_updated.trim() === "") {
          throw new Error("资源版本文件格式无效");
        }
        return raw.last_updated;
      },
      catch: (cause) => maaxError("无法获取远程资源版本", cause),
    });

    const status = (core: CoreInfo): Effect.Effect<ResourceStatus> =>
      Effect.gen(function* () {
        const stamp = yield* readLocalStamp(core);
        const backups = yield* Effect.promise(() => listOverlayBackups(backupsDirFor(core.id)));
        const mapped: ReadonlyArray<ResourceBackup> = backups.map((backup) => ({
          id: backup.id,
          stamp: backup.manifest.stamp,
          createdAt: backup.manifest.createdAt,
          files: backup.manifest.entries.length,
          bytes: backup.manifest.bytes,
        }));
        return {
          coreId: core.id,
          ...(stamp === undefined ? {} : { stamp }),
          backups: [...mapped],
        };
      });

    const check = (core: CoreInfo): Effect.Effect<ResourceCheck, MaaxError> =>
      Effect.gen(function* () {
        const remote = yield* fetchRemoteStamp;
        const local = yield* readLocalStamp(core);
        const available = local === undefined || isNewerResourceStamp(remote, local);
        return {
          coreId: core.id,
          ...(local === undefined ? {} : { local }),
          remote,
          available,
        };
      });

    const apply = (core: CoreInfo, onProgress: ResourceProgress): Effect.Effect<ResourceApplyResult, MaaxError> =>
      Effect.gen(function* () {
        onProgress("metadata", 0, 0);
        const remote = yield* fetchRemoteStamp;
        const localStamp = yield* readLocalStamp(core);
        if (localStamp !== undefined && !isNewerResourceStamp(remote, localStamp)) {
          return { coreId: core.id, stamp: localStamp, files: 0, bytes: 0 };
        }

        const backupId = backupIdFor(remote);
        const workspace = join(paths.cacheDir, "resource-update", backupId);
        const archive = join(workspace, "resource.zip");
        const extracted = join(workspace, "extracted");

        const work = Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => rm(workspace, { recursive: true, force: true }),
            catch: (cause) => maaxError("清理资源更新临时目录失败", cause),
          });
          yield* Effect.tryPromise({
            try: () => mkdir(workspace, { recursive: true }),
            catch: (cause) => maaxError("创建资源更新临时目录失败", cause),
          });

          onProgress("downloading", 0, 0);
          yield* downloader
            .download(overriddenUrl("MAAX_RESOURCE_ARCHIVE_URL", RESOURCE_ARCHIVE_URL), archive, {
              label: "MaaResource",
              timeoutMs: 10 * 60 * 1000,
              onProgress: (received, total) => onProgress("downloading", received, total),
            })
            .pipe(Effect.mapError((cause) => maaxError("下载资源归档失败", cause)));

          onProgress("extracting", 0, 0);
          yield* Effect.tryPromise({
            try: () =>
              extractZip(archive, extracted, {
                onProgress: (progress) => onProgress("extracting", progress.entries, progress.totalEntries),
              }),
            catch: (cause) => maaxError("解压资源归档失败", cause),
          });

          const stagedRoot = join(extracted, ARCHIVE_ROOT, "resource");
          const stagedStamp = yield* Effect.promise(() => readStampIn(stagedRoot));
          if (stagedStamp === undefined) {
            return yield* maaxError("资源归档缺少 resource/version.json，可能不是有效的资源包");
          }
          if (!isNewerResourceStamp(stagedStamp, remote) && stagedStamp !== remote) {
            return yield* maaxError("归档内的资源版本比检查结果旧，请稍后重试", `${stagedStamp} < ${remote}`);
          }

          onProgress("installing", 0, 0);
          const manifest = yield* Effect.tryPromise({
            try: () =>
              applyOverlay({
                stagedRoot,
                targetRoot: resourceDirFor(core),
                backupRoot: join(backupsDirFor(core.id), backupId),
                // The backup is labelled with the state it restores to.
                stamp: localStamp ?? stagedStamp,
                appliedStamp: stagedStamp,
                onProgress: (applied, total) => onProgress("installing", applied, total),
              }),
            catch: (cause) => maaxError("写入资源文件失败", cause),
          });
          yield* Effect.promise(() => pruneOverlayBackups(backupsDirFor(core.id), KEEP_BACKUPS));
          return {
            coreId: core.id,
            stamp: stagedStamp,
            files: manifest.entries.length,
            bytes: manifest.bytes,
            backupId,
          };
        });

        return yield* work.pipe(
          Effect.ensuring(Effect.promise(() => rm(workspace, { recursive: true, force: true }).catch(() => undefined))),
        );
      });

    const rollback = (
      core: CoreInfo,
      backupId: string,
      onProgress: ResourceProgress,
    ): Effect.Effect<ResourceApplyResult, MaaxError> =>
      Effect.gen(function* () {
        if (!BACKUP_ID_PATTERN.test(backupId)) return yield* maaxError("资源备份标识无效");
        const backupDirectory = join(backupsDirFor(core.id), backupId);
        if (!resolve(backupDirectory).startsWith(resolve(backupsDirFor(core.id)))) {
          return yield* maaxError("资源备份路径无效");
        }
        onProgress("installing", 0, 0);
        const result = yield* Effect.tryPromise({
          try: () => restoreOverlay(backupDirectory, resourceDirFor(core)),
          catch: (cause) => maaxError("回滚资源失败", cause),
        });
        onProgress("done", result.restored, result.restored);
        return { coreId: core.id, stamp: result.stamp, files: result.restored, bytes: 0, backupId };
      });

    return { status, check, apply, rollback } satisfies ResourceUpdaterApi;
  }),
);
