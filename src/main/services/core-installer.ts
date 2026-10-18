import { Context, Effect, Layer, Schema } from "effect";
import { BrowserWindow, dialog } from "electron";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { CoreInfo } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";
import { EventBus } from "../events";
import { CoreRegistry } from "./core-registry";
import { AppPaths } from "./paths";
import { Settings } from "./settings";

const RELEASE_URL = "https://api.maa.plus/MaaAssistantArknights/api/version/stable.json";

const ReleaseSchema = Schema.Struct({
  version: Schema.String,
  details: Schema.Struct({
    assets: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        size: Schema.Number,
        browser_download_url: Schema.String,
      }),
    ),
  }),
});

const platformSuffix = (): string | undefined => {
  if (process.platform === "linux" && process.arch === "x64") return "linux-x86_64";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-aarch64";
  return undefined;
};

const downloadFile = async (
  url: string,
  destination: string,
  total: number,
  onProgress: (received: number, total: number) => void,
): Promise<void> => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} while downloading MaaCore`);
  }
  const declared = Number(response.headers.get("content-length")) || total;
  const output = createWriteStream(destination);
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = chunk as Uint8Array;
      received += bytes.byteLength;
      if (!output.write(bytes)) {
        await new Promise<void>((resolve) => output.once("drain", () => resolve()));
      }
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        onProgress(received, declared);
      }
    }
    await new Promise<void>((resolve) => {
      output.end(() => resolve());
    });
    onProgress(received, declared || received);
  } catch (error) {
    output.destroy();
    throw error;
  }
};

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
  throw new Error("MaaCore archive did not contain libMaaCore.so and resource/");
};

const hasCoreFiles = async (directory: string): Promise<boolean> => {
  try {
    await stat(join(directory, "libMaaCore.so"));
    await stat(join(directory, "resource", "config.json"));
    return true;
  } catch {
    return false;
  }
};

export interface CoreInstallerApi {
  readonly downloadStable: Effect.Effect<CoreInfo | null, MaaxError>;
}

export class CoreInstaller extends Context.Service<CoreInstaller, CoreInstallerApi>()(
  "maax/CoreInstaller",
) {}

export const CoreInstallerLive: Layer.Layer<
  CoreInstaller,
  never,
  AppPaths | CoreRegistry | EventBus | Settings
> = Layer.effect(
  CoreInstaller,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const registry = yield* CoreRegistry;
    const bus = yield* EventBus;
    const settings = yield* Settings;

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
        ...(message ? { message } : {}),
      });
    };

    const downloadStable: Effect.Effect<CoreInfo | null, MaaxError> = Effect.gen(function* () {
      const suffix = platformSuffix();
      if (!suffix) {
        return yield* Effect.fail(
          maaxError("当前平台暂不支持一键下载 MaaCore", `${process.platform}/${process.arch}`),
        );
      }

      progress("metadata", 0, 0);
      const release = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(RELEASE_URL, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok)
            throw new Error(`HTTP ${response.status} while reading release metadata`);
          return Schema.decodeUnknownSync(ReleaseSchema)(await response.json());
        },
        catch: (cause) => maaxError("无法获取 MaaCore 版本信息", cause),
      });

      const asset = release.details.assets.find(
        (item) => item.name.endsWith(`-${suffix}.tar.gz`) && !item.name.includes("Component"),
      );
      if (!asset) return yield* Effect.fail(maaxError(`这个版本没有 ${suffix} 的 tar.gz 包`));

      const window = BrowserWindow.getFocusedWindow();
      const sizeMegabytes = Math.ceil(asset.size / 1024 / 1024);
      const options = {
        type: "question" as const,
        buttons: ["下载并安装", "取消"],
        defaultId: 0,
        cancelId: 1,
        title: "下载 MaaCore",
        message: `下载 MaaCore ${release.version}？`,
        detail: `将下载 ${asset.name}（约 ${sizeMegabytes} MB）并解压到 MaaX 的用户数据目录。\n\n来源：${asset.browser_download_url}`,
      };
      const confirmation = window
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
            await stat(join(target, "libMaaCore.so"));
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
      const workspace = join(paths.coresDir, `.install-${safeVersion}-${process.pid}`);
      const archive = join(workspace, asset.name);
      const extracted = join(workspace, "extracted");
      yield* Effect.tryPromise({
        try: () => mkdir(extracted, { recursive: true }),
        catch: (cause) => maaxError("创建临时目录失败", cause),
      });

      try {
        progress("downloading", 0, asset.size);
        yield* Effect.tryPromise({
          try: () =>
            downloadFile(asset.browser_download_url, archive, asset.size, (received, total) => {
              progress("downloading", received, total);
            }),
          catch: (cause) => maaxError("下载 MaaCore 失败", cause),
        });

        progress("extracting", asset.size, asset.size);
        yield* Effect.tryPromise({
          try: () => extractTarGz(archive, extracted),
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

        const core = yield* registry.addLocal(target, "download", true);
        const currentSettings = yield* settings.get;
        if (!currentSettings.activeCoreId) {
          yield* settings.update({ activeCoreId: core.id });
        }
        progress("done", asset.size, asset.size);
        return core;
      } finally {
        yield* Effect.promise(() =>
          rm(workspace, { recursive: true, force: true }).catch(() => undefined),
        );
      }
    });

    return { downloadStable };
  }),
);
