import { Context, Effect, Layer, Schema } from "effect";
import { app, BrowserWindow, dialog } from "electron";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { CoreInfo, CoreReleaseCheck } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import { EventBus } from "../events";
import { coreArchiveKind, coreLibraryName, coreLibraryPath, coreResourceConfigPath } from "../platform";
import { extractZip } from "../zip";
import { CoreRegistry } from "./core-registry";
import { CoreReleaseSchema, isNewerCoreVersion, pickCoreAsset, platformSuffixFor, publishedAtOf } from "./core-release";
import { Downloader } from "./download";
import { AppPaths } from "./paths";
import { Settings } from "./settings";

const RELEASE_URL = "https://api.maa.plus/MaaAssistantArknights/api/version/stable.json";

const extractTarGz = (archive: string, destination: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", destination], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });

/**
 * Extract a downloaded core archive. Windows releases are zip files and have
 * no `tar` dependency; Linux keeps the smaller `.tar.gz` path. `extractZip`
 * already removes the destination on failure, so the caller can still use the
 * staging directory contract of `findExtractedRoot`.
 */
const extractCoreArchive = async (archive: string, destination: string): Promise<void> => {
  const kind = coreArchiveKind(archive);
  if (kind === "zip") {
    await extractZip(archive, destination);
    return;
  }
  if (kind === "tar.gz") {
    await extractTarGz(archive, destination);
    return;
  }
  throw new Error(`不支持的 MaaCore 压缩包格式：${archive}`);
};

const findExtractedRoot = async (directory: string): Promise<string> => {
  const entries = await readdir(directory);
  if (entries.length === 1) {
    const candidate = join(directory, entries[0]!);
    const info = await stat(candidate);
    if (info.isDirectory() && (await hasCoreFiles(candidate))) return candidate;
  }
  if (await hasCoreFiles(directory)) return directory;
  for (const entry of entries) {
    const candidate = join(directory, entry);
    const info = await stat(candidate).catch(() => undefined);
    if (info?.isDirectory() && (await hasCoreFiles(candidate))) return candidate;
  }
  throw new Error(`MaaCore archive did not contain ${coreLibraryName()} and resource/`);
};

const hasCoreFiles = async (directory: string): Promise<boolean> => {
  try {
    await stat(coreLibraryPath(directory));
    await stat(coreResourceConfigPath(directory));
    return true;
  } catch {
    return false;
  }
};

/**
 * Remove staging directories left behind by a failed or interrupted install.
 * Windows keeps a downloaded archive open until its stream is disposed, so the
 * `finally` cleanup can legitimately fail with EBUSY; without this sweep the
 * next attempt would keep piling up multi-hundred-megabyte workspaces.
 */
const clearWorkspaces = async (parent: string, prefix: string): Promise<void> => {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => rm(join(parent, entry.name), { recursive: true, force: true }).catch(() => undefined)),
  );
};

export interface CoreInstallerApi {
  readonly downloadStable: Effect.Effect<CoreInfo | null, MaaxError>;
  readonly checkUpdate: Effect.Effect<CoreReleaseCheck, MaaxError>;
  readonly repair: (core: CoreInfo) => Effect.Effect<CoreInfo, MaaxError>;
}

export class CoreInstaller extends Context.Service<CoreInstaller, CoreInstallerApi>()("maax/CoreInstaller") {}

/** The file system and HTTP client are supplied to `Downloader`, so the installer only depends on the service. */
type CoreInstallerEnv = AppPaths | CoreRegistry | EventBus | Settings | Downloader;

export const CoreInstallerLive: Layer.Layer<CoreInstaller, never, CoreInstallerEnv> = Layer.effect(
  CoreInstaller,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const registry = yield* CoreRegistry;
    const bus = yield* EventBus;
    const settings = yield* Settings;
    const downloader = yield* Downloader;

    const progress = (
      phase: "metadata" | "downloading" | "extracting" | "installing" | "done" | "failed",
      received: number,
      total: number,
      message?: string,
    ): void => {
      bus.emit({
        _tag: "download-progress",
        phase,
        received,
        total,
        source: "core",
        ...(message ? { message } : {}),
      });
    };

    const releaseUrl = (): string =>
      !app.isPackaged && process.env.MAAX_CORE_RELEASE_URL ? process.env.MAAX_CORE_RELEASE_URL : RELEASE_URL;

    const fetchRelease = Effect.gen(function* () {
      const releaseJson = yield* Effect.tryPromise({
        try: async (): Promise<unknown> => {
          const response = await fetch(releaseUrl(), { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(`HTTP ${response.status} while reading release metadata`);
          return await response.json();
        },
        catch: (cause) => maaxError("无法获取 MaaCore 版本信息", cause),
      });
      return yield* Schema.decodeUnknownEffect(CoreReleaseSchema)(releaseJson).pipe(
        Effect.mapError((cause) => maaxError("MaaCore 版本信息格式无效", cause)),
      );
    });

    const activeCoreVersion = Effect.gen(function* () {
      const currentSettings = yield* settings.get;
      const ready = (yield* registry.list).filter((core) => core.status === "ready");
      const active = currentSettings.activeCoreId
        ? ready.find((core) => core.id === currentSettings.activeCoreId)
        : ready[0];
      return active?.version;
    });

    const checkUpdate: Effect.Effect<CoreReleaseCheck, MaaxError> = Effect.gen(function* () {
      const current = yield* activeCoreVersion;
      const suffix = platformSuffixFor(process.platform, process.arch);
      if (!suffix) {
        return { ...(current === undefined ? {} : { current }), available: false };
      }
      const release = yield* fetchRelease;
      const asset = pickCoreAsset(release, suffix);
      const publishedAt = publishedAtOf(release);
      return {
        ...(current === undefined ? {} : { current }),
        latest: release.version,
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(asset === undefined ? {} : { sizeBytes: asset.size }),
        available: asset !== undefined && isNewerCoreVersion(current, release.version),
      };
    });

    const downloadStable: Effect.Effect<CoreInfo | null, MaaxError> = Effect.gen(function* () {
      const suffix = platformSuffixFor(process.platform, process.arch);
      if (!suffix) {
        return yield* maaxError("当前平台暂不支持一键下载 MaaCore", `${process.platform}/${process.arch}`);
      }

      progress("metadata", 0, 0);
      const release = yield* fetchRelease;
      const asset = pickCoreAsset(release, suffix);
      if (!asset) return yield* maaxError(`这个版本没有 ${suffix} 的压缩包`);

      const window = BrowserWindow.getFocusedWindow();
      const sizeMegabytes = Math.ceil(asset.size / 1024 / 1024);
      const autoConfirm = !app.isPackaged && process.env.MAAX_AUTO_CONFIRM_DOWNLOAD === "1";
      const options = {
        type: "question" as const,
        buttons: ["下载并安装", "取消"],
        defaultId: 0,
        cancelId: 1,
        title: "下载 MaaCore",
        message: `下载 MaaCore ${release.version}？`,
        detail: `将下载 ${asset.name}（约 ${sizeMegabytes} MB）并解压到 MaaX 的用户数据目录。\n\n来源：${asset.url}`,
      };
      const confirmation = autoConfirm
        ? { response: 0 }
        : window
          ? yield* Effect.tryPromise({
              try: () => dialog.showMessageBox(window, options),
              catch: (cause) => maaxError("确认对话框失败", cause),
            })
          : yield* Effect.tryPromise({
              try: () => dialog.showMessageBox(options),
              catch: (cause) => maaxError("确认对话框失败", cause),
            });
      if (confirmation.response !== 0) return null;

      const safeVersion = release.version.replace(/[^a-zA-Z0-9._-]+/gu, "-");
      const target = join(paths.coresDir, safeVersion);
      const alreadyInstalled = yield* Effect.tryPromise({
        try: async () => {
          try {
            await stat(coreLibraryPath(target));
            await stat(coreResourceConfigPath(target));
            return true;
          } catch {
            return false;
          }
        },
        catch: () => maaxError("检查核心目录失败"),
      });
      if (alreadyInstalled) {
        progress("done", asset.size, asset.size);
        return yield* registry.addLocal(target, "download", true);
      }

      yield* Effect.tryPromise({
        try: () => mkdir(paths.coresDir, { recursive: true }),
        catch: (cause) => maaxError("创建核心目录失败", cause),
      });
      yield* Effect.promise(() => clearWorkspaces(paths.coresDir, ".install-"));
      // A previous attempt may have left a partial directory at the target;
      // `cp`/`rename` refuse to land on it, so clear it before staging.
      yield* Effect.promise(() => rm(target, { recursive: true, force: true }).catch(() => undefined));
      const workspace = join(paths.coresDir, `.install-${safeVersion}-${process.pid}`);
      const archive = join(workspace, asset.name);
      const extracted = join(workspace, "extracted");
      yield* Effect.tryPromise({
        try: () => mkdir(extracted, { recursive: true }),
        catch: (cause) => maaxError("创建临时目录失败", cause),
      });

      try {
        progress("downloading", 0, asset.size);
        yield* downloader
          .download(asset.url, archive, {
            total: asset.size,
            label: "MaaCore",
            onProgress: (received, total) => progress("downloading", received, total),
          })
          .pipe(Effect.mapError((cause) => maaxError("下载 MaaCore 失败", cause)));

        progress("extracting", asset.size, asset.size);
        yield* Effect.tryPromise({
          try: () => extractCoreArchive(archive, extracted),
          catch: (cause) => maaxError("解压 MaaCore 失败", cause),
        });

        const root = yield* Effect.tryPromise({
          try: () => findExtractedRoot(extracted),
          catch: (cause) => maaxError("找不到解压后的 MaaCore", cause),
        });

        progress("installing", asset.size, asset.size);
        yield* Effect.tryPromise({
          try: async () => {
            if (root === extracted) {
              await cp(root, target, { recursive: true, force: false, errorOnExist: true });
            } else {
              await rename(root, target);
            }
          },
          catch: (cause) => maaxError("安装 MaaCore 失败", cause),
        });

        // Activation is the application's decision: it is skipped while a
        // device still holds a session on the previous core.
        const core = yield* registry.addLocal(target, "download", true);
        progress("done", asset.size, asset.size);
        return core;
      } finally {
        yield* Effect.promise(() => rm(workspace, { recursive: true, force: true }).catch(() => undefined));
      }
    });

    /**
     * Reinstall a managed core in place. The old directory is renamed aside
     * first, so a failed archive or extraction restores the exact previous
     * tree instead of leaving a half-written core the host cannot load.
     */
    const repair = (core: CoreInfo): Effect.Effect<CoreInfo, MaaxError> =>
      Effect.gen(function* () {
        if (!core.managed) {
          return yield* maaxError("只能修复由 MaaX 下载安装的核心", "导入的核心请重新选择目录");
        }
        if (!resolve(core.root).startsWith(resolve(paths.coresDir))) {
          return yield* maaxError("核心目录不在 MaaX 的管理范围内", core.root);
        }
        const suffix = platformSuffixFor(process.platform, process.arch);
        if (!suffix) return yield* maaxError("当前平台暂不支持自动修复 MaaCore");

        progress("metadata", 0, 0);
        const release = yield* fetchRelease;
        if (release.version !== core.version) {
          return yield* maaxError(
            "这个核心版本不是当前稳定版，无法自动修复",
            `当前稳定版为 ${release.version}，请使用「下载核心」更新`,
          );
        }
        const asset = pickCoreAsset(release, suffix);
        if (!asset) return yield* maaxError(`这个版本没有 ${suffix} 的压缩包`);

        yield* Effect.promise(() => clearWorkspaces(paths.cacheDir, "core-repair-"));
        const workspace = join(paths.cacheDir, `core-repair-${process.pid}-${Date.now()}`);
        const archive = join(workspace, asset.name);
        const extracted = join(workspace, "extracted");
        yield* Effect.tryPromise({
          try: () => mkdir(extracted, { recursive: true }),
          catch: (cause) => maaxError("创建修复临时目录失败", cause),
        });

        try {
          progress("downloading", 0, asset.size);
          yield* downloader
            .download(asset.url, archive, {
              total: asset.size,
              label: "MaaCore",
              onProgress: (received, total) => progress("downloading", received, total),
            })
            .pipe(Effect.mapError((cause) => maaxError("下载 MaaCore 失败", cause)));
          progress("extracting", asset.size, asset.size);
          yield* Effect.tryPromise({
            try: () => extractCoreArchive(archive, extracted),
            catch: (cause) => maaxError("解压 MaaCore 失败", cause),
          });
          const root = yield* Effect.tryPromise({
            try: () => findExtractedRoot(extracted),
            catch: (cause) => maaxError("找不到解压后的 MaaCore", cause),
          });

          progress("installing", asset.size, asset.size);
          const backup = `${core.root}.repair-${process.pid}`;
          yield* Effect.tryPromise({
            try: async () => {
              await rename(core.root, backup);
              try {
                if (root === extracted) {
                  await cp(root, core.root, { recursive: true, force: false, errorOnExist: true });
                } else {
                  await rename(root, core.root);
                }
              } catch (error) {
                await rm(core.root, { recursive: true, force: true }).catch(() => undefined);
                await rename(backup, core.root).catch(() => undefined);
                throw error;
              }
              await rm(backup, { recursive: true, force: true }).catch(() => undefined);
            },
            catch: (cause) => maaxError("修复 MaaCore 失败", cause),
          });

          const cores = yield* registry.refresh;
          const refreshed = cores.find((item) => item.root === core.root);
          if (!refreshed) return yield* maaxError("修复后找不到核心登记");
          progress("done", asset.size, asset.size);
          return refreshed;
        } finally {
          yield* Effect.promise(() => rm(workspace, { recursive: true, force: true }).catch(() => undefined));
        }
      });

    return { downloadStable, checkUpdate, repair };
  }),
);
