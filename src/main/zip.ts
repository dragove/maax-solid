import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";

/**
 * Zip extraction for downloaded archives (MaaCore packages, MaaResource
 * archives).
 *
 * Archives come from the network, so the extractor treats every entry as
 * hostile: names may not escape the destination, only regular files and
 * directories are written, and both the entry count and the total uncompressed
 * size are bounded. `yauzl` already rejects absolute paths, backslashes and
 * ".." segments while parsing the central directory; the checks here are the
 * second line of defence and produce action hints instead of parser errors.
 */

export interface ZipProgress {
  readonly entries: number;
  readonly totalEntries: number;
  readonly bytes: number;
}

export interface ExtractZipOptions {
  readonly onProgress?: (progress: ZipProgress) => void;
  readonly maxEntries?: number;
  readonly maxUncompressedBytes?: number;
}

export interface ExtractZipResult {
  readonly entries: number;
  readonly bytes: number;
}

const DEFAULT_MAX_ENTRIES = 200_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 100;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;

const insideOf = (root: string, target: string): boolean => target === root || target.startsWith(root + sep);

const unixFileType = (externalFileAttributes: number): number => (externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;

/**
 * Extract `archivePath` into `destination`.
 *
 * The destination is created and, on any failure, removed again, so callers can
 * treat it as a staging directory and rename it into place once this resolves.
 * Rejects symlink and device entries, duplicate entries, and archives that
 * exceed the entry or size budgets.
 */
export const extractZip = async (
  archivePath: string,
  destination: string,
  options: ExtractZipOptions = {},
): Promise<ExtractZipResult> => {
  const root = resolve(destination);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  await mkdir(root, { recursive: true });

  const zip = await openPromise(archivePath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  let entries = 0;
  let bytes = 0;
  let lastReport = 0;

  const report = (force: boolean): void => {
    if (!options.onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    options.onProgress({ entries, totalEntries: zip.entryCount, bytes });
  };

  try {
    report(true);
    for await (const entry of zip.eachEntry()) {
      entries += 1;
      if (entries > maxEntries) throw new Error(`压缩包条目过多：超过 ${maxEntries} 个文件`);

      const name = entry.fileName;
      const type = unixFileType(entry.externalFileAttributes);
      const isDirectory = name.endsWith("/") || type === UNIX_DIRECTORY;
      const target = resolve(root, isDirectory && name.endsWith("/") ? name.slice(0, -1) : name);
      if (!insideOf(root, target) || target === root) throw new Error(`压缩包条目越界：${name}`);
      if (!isDirectory && type !== 0 && type !== UNIX_REGULAR_FILE) {
        throw new Error(`压缩包包含非普通文件（符号链接或设备节点）：${name}`);
      }
      if (isDirectory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      if (entry.isEncrypted()) throw new Error(`压缩包条目已加密：${name}`);

      bytes += entry.uncompressedSize;
      if (bytes > maxBytes) {
        throw new Error(`压缩包解压后超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 上限`);
      }

      await mkdir(dirname(target), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      // "wx" refuses to overwrite: a duplicate entry cannot silently replace an
      // earlier file, which is how several extractors have been exploited.
      await pipeline(stream, createWriteStream(target, { flags: "wx", mode: 0o644 }));
      report(false);
    }
    report(true);
    return { entries, bytes };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (zip.isOpen) zip.close();
  }
};
