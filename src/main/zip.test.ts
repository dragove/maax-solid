import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractZip } from "./zip";

/* -------------------------------------------------------------------------- */
/* Minimal STORED-only zip writer, so tests build archives byte by byte        */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

interface TestEntry {
  readonly name: string;
  readonly data?: string;
  readonly unixMode?: number;
}

const buildZip = (entries: ReadonlyArray<TestEntry>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "", "utf8");
    const directory = entry.name.endsWith("/");
    const mode = entry.unixMode ?? (directory ? 0o040755 : 0o100644);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
};

const workspaces: string[] = [];

const workspace = async (entries: ReadonlyArray<TestEntry>): Promise<{ archive: string; target: string }> => {
  const base = await mkdtemp(join(tmpdir(), "maax-zip-"));
  workspaces.push(base);
  const archive = join(base, "archive.zip");
  await import("node:fs/promises").then((fs) => fs.writeFile(archive, buildZip(entries)));
  return { archive, target: join(base, "out") };
};

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("zip extraction", () => {
  it("restores nested files and ignores explicit directory entries", async () => {
    const { archive, target } = await workspace([
      { name: "MaaResource-main/" },
      { name: "MaaResource-main/resource/" },
      { name: "MaaResource-main/resource/config.json", data: '{"ok":true}' },
      { name: "MaaResource-main/resource/tasks.json", data: "[]" },
    ]);

    const result = await extractZip(archive, target);

    expect(result.entries).toBe(4);
    expect(result.bytes).toBe(11 + 2);
    expect(await readFile(join(target, "MaaResource-main/resource/config.json"), "utf8")).toBe('{"ok":true}');
    expect((await stat(join(target, "MaaResource-main/resource"))).isDirectory()).toBe(true);
  });

  it("reports progress from the central directory", async () => {
    const { archive, target } = await workspace([
      { name: "a.txt", data: "a" },
      { name: "b.txt", data: "b" },
    ]);
    const seen: number[] = [];
    await extractZip(archive, target, { onProgress: (progress) => seen.push(progress.totalEntries) });
    expect(seen[0]).toBe(2);
    expect(seen.at(-1)).toBe(2);
  });

  it("refuses a path traversal entry and cleans the destination", async () => {
    const { archive, target } = await workspace([{ name: "../escape.txt", data: "nope" }]);
    await expect(extractZip(archive, target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(target, "..", "escape.txt"))).toBe(false);
  });

  it("refuses absolute names", async () => {
    const { archive, target } = await workspace([{ name: "/etc/passwd", data: "nope" }]);
    await expect(extractZip(archive, target)).rejects.toThrow();
  });

  it("refuses symlink entries", async () => {
    const { archive, target } = await workspace([{ name: "link", data: "/etc/passwd", unixMode: 0o120777 }]);
    await expect(extractZip(archive, target)).rejects.toThrow(/非普通文件/);
  });

  it("refuses duplicate entry names", async () => {
    const { archive, target } = await workspace([
      { name: "same.txt", data: "first" },
      { name: "same.txt", data: "second" },
    ]);
    await expect(extractZip(archive, target)).rejects.toThrow(/EEXIST/);
  });

  it("enforces the entry budget", async () => {
    const { archive, target } = await workspace([
      { name: "a.txt", data: "a" },
      { name: "b.txt", data: "b" },
    ]);
    await expect(extractZip(archive, target, { maxEntries: 1 })).rejects.toThrow(/条目过多/);
  });

  it("enforces the uncompressed size budget", async () => {
    const { archive, target } = await workspace([{ name: "big.txt", data: "x".repeat(64) }]);
    await expect(extractZip(archive, target, { maxUncompressedBytes: 32 })).rejects.toThrow(/上限/);
  });
});
