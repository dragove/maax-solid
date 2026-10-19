import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Resource overlay engine.
 *
 * A resource update is a set of files applied on top of an existing, complete
 * `resource/` tree. Every file that differs is copied to a backup directory
 * first, so the previous state can be restored byte for byte; files that are
 * identical are left alone, which keeps both the write volume and the backup
 * small. Nothing here touches MaaCore — callers stop the host first.
 */

export const OVERLAY_MANIFEST_FILE = "manifest.json";
export const OVERLAY_FILES_DIR = "files";

export interface OverlayEntry {
  readonly path: string;
  /** `added`: did not exist before; `replaced`: backed up and overwritten. */
  readonly action: "added" | "replaced";
  readonly bytes: number;
}

export interface OverlayManifest {
  /** Stamp this backup restores to (the state before the overlay). */
  readonly stamp: string;
  /** Stamp that was applied on top of that state. */
  readonly appliedStamp: string;
  readonly createdAt: number;
  readonly entries: ReadonlyArray<OverlayEntry>;
  readonly bytes: number;
}

export interface OverlayBackup {
  readonly id: string;
  readonly manifest: OverlayManifest;
}

const insideOf = (root: string, target: string): boolean => {
  const rootPath = resolve(root);
  return target === rootPath || target.startsWith(rootPath + sep);
};

const toManifestPath = (path: string): string => path.split(sep).join("/");

const readManifestFile = async (backupDirectory: string): Promise<OverlayManifest | undefined> => {
  const text = await readFile(join(backupDirectory, OVERLAY_MANIFEST_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const raw = JSON.parse(text) as Partial<OverlayManifest>;
    if (typeof raw.stamp !== "string" || typeof raw.createdAt !== "number" || !Array.isArray(raw.entries)) {
      return undefined;
    }
    return {
      stamp: raw.stamp,
      appliedStamp: typeof raw.appliedStamp === "string" ? raw.appliedStamp : raw.stamp,
      createdAt: raw.createdAt,
      bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
      entries: raw.entries.filter(
        (entry): entry is OverlayEntry =>
          typeof entry?.path === "string" &&
          (entry.action === "added" || entry.action === "replaced") &&
          typeof entry.bytes === "number",
      ),
    };
  } catch {
    return undefined;
  }
};

export const readOverlayManifest = readManifestFile;

/** Every regular file under `root`, as POSIX-style relative paths. */
export const listFiles = async (root: string, prefix = ""): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
};

/**
 * Move a staged file into the target tree.
 *
 * The staging directory lives under the app cache while an imported core can be
 * on another filesystem, so `rename` may fail with EXDEV. The fallback copies
 * beside the target and renames there, which stays atomic on the target device.
 */
const moveIntoPlace = async (source: string, target: string): Promise<void> => {
  try {
    await rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  const temporary = `${target}.maax-part`;
  await copyFile(source, temporary);
  await rename(temporary, target);
  await rm(source, { force: true });
};

const sameContent = async (left: string, right: string): Promise<boolean> => {
  const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)]);
  if (leftInfo.size !== rightInfo.size) return false;
  const [a, b] = await Promise.all([readFile(left), readFile(right)]);
  return a.equals(b);
};

export interface ApplyOverlayOptions {
  readonly stagedRoot: string;
  readonly targetRoot: string;
  readonly backupRoot: string;
  /** Stamp the previous state carried; shown as the rollback target. */
  readonly stamp: string;
  /** Stamp of the tree this overlay produces. */
  readonly appliedStamp: string;
  readonly onProgress?: (applied: number, total: number) => void;
}

/**
 * Apply the staged tree onto the target tree and record how to undo it.
 *
 * Files are moved into place with `rename`, so a failure leaves whole files
 * behind rather than truncated ones; re-running the same overlay is safe.
 */
export const applyOverlay = async (options: ApplyOverlayOptions): Promise<OverlayManifest> => {
  const files = await listFiles(options.stagedRoot);
  // Build the backup beside its final name so an interrupted apply never looks
  // like a usable restore point.
  const partialRoot = `${options.backupRoot}.partial`;
  await rm(partialRoot, { recursive: true, force: true });
  await mkdir(options.targetRoot, { recursive: true });
  await mkdir(join(partialRoot, OVERLAY_FILES_DIR), { recursive: true });

  const entries: OverlayEntry[] = [];
  let bytes = 0;

  try {
    for (const [index, relative] of files.entries()) {
      const source = resolve(options.stagedRoot, relative);
      const target = resolve(options.targetRoot, relative);
      if (!insideOf(options.targetRoot, target)) throw new Error(`资源归档条目越界：${relative}`);

      const existing = await stat(target).catch(() => undefined);
      if (existing?.isFile() && (await sameContent(source, target))) {
        options.onProgress?.(index + 1, files.length);
        continue;
      }

      const size = (await stat(source)).size;
      if (existing?.isFile()) {
        const backup = join(partialRoot, OVERLAY_FILES_DIR, relative);
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(target, backup);
        entries.push({ path: toManifestPath(relative), action: "replaced", bytes: size });
      } else {
        entries.push({ path: toManifestPath(relative), action: "added", bytes: size });
      }

      await mkdir(dirname(target), { recursive: true });
      await moveIntoPlace(source, target);
      bytes += size;
      options.onProgress?.(index + 1, files.length);
    }

    const manifest: OverlayManifest = {
      stamp: options.stamp,
      appliedStamp: options.appliedStamp,
      createdAt: Date.now(),
      entries,
      bytes,
    };
    await writeFile(join(partialRoot, OVERLAY_MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
    await rm(options.backupRoot, { recursive: true, force: true });
    await rename(partialRoot, options.backupRoot);
    return manifest;
  } catch (error) {
    await rm(partialRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

export interface RestoreOverlayResult {
  readonly stamp: string;
  readonly restored: number;
}

/** Undo a backup and remove it. Added files are deleted, replaced ones restored. */
export const restoreOverlay = async (backupDirectory: string, targetRoot: string): Promise<RestoreOverlayResult> => {
  const manifest = await readManifestFile(backupDirectory);
  if (!manifest) throw new Error("资源备份清单缺失或已损坏");
  let restored = 0;
  for (const entry of manifest.entries) {
    const target = resolve(targetRoot, entry.path);
    if (!insideOf(targetRoot, target)) throw new Error(`资源备份条目越界：${entry.path}`);
    if (entry.action === "replaced") {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(backupDirectory, OVERLAY_FILES_DIR, entry.path), target);
    } else {
      await rm(target, { force: true });
    }
    restored += 1;
  }
  await rm(backupDirectory, { recursive: true, force: true });
  return { stamp: manifest.stamp, restored };
};

/** Newest first. */
export const listOverlayBackups = async (backupsRoot: string): Promise<ReadonlyArray<OverlayBackup>> => {
  const entries = await readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  const backups: OverlayBackup[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifestFile(join(backupsRoot, entry.name));
    if (manifest) backups.push({ id: entry.name, manifest });
  }
  return backups.sort((a, b) => b.manifest.createdAt - a.manifest.createdAt);
};

export const pruneOverlayBackups = async (backupsRoot: string, keep: number): Promise<ReadonlyArray<string>> => {
  const stale = (await listOverlayBackups(backupsRoot)).slice(Math.max(0, keep));
  await Promise.all(stale.map((backup) => rm(join(backupsRoot, backup.id), { recursive: true, force: true })));
  return stale.map((backup) => backup.id);
};
