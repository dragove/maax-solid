import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyOverlay, listOverlayBackups, pruneOverlayBackups, restoreOverlay } from "./resource-overlay";

const roots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "maax-overlay-"));
  roots.push(root);
  return root;
};

interface Fixture {
  readonly staged: string;
  readonly target: string;
  readonly backup: string;
}

const fixture = async (staged: Record<string, string>, target: Record<string, string>): Promise<Fixture> => {
  const root = await temporaryRoot();
  const stagedRoot = join(root, "staged");
  const targetRoot = join(root, "resource");
  await mkdir(stagedRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  for (const [path, body] of Object.entries(staged)) {
    await mkdir(join(stagedRoot, path, ".."), { recursive: true });
    await writeFile(join(stagedRoot, path), body, "utf8");
  }
  for (const [path, body] of Object.entries(target)) {
    await mkdir(join(targetRoot, path, ".."), { recursive: true });
    await writeFile(join(targetRoot, path), body, "utf8");
  }
  return { staged: stagedRoot, target: targetRoot, backup: join(root, "backups", "2026-10-20") };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resource overlay", () => {
  it("replaces changed files, adds new ones and skips identical ones", async () => {
    const { staged, target, backup } = await fixture(
      {
        "tasks/tasks.json": "new tasks",
        "stages.json": "same",
        "roguelike/new.json": "brand new",
      },
      {
        "tasks/tasks.json": "old tasks",
        "stages.json": "same",
      },
    );

    const manifest = await applyOverlay({
      stagedRoot: staged,
      targetRoot: target,
      backupRoot: backup,
      stamp: "2026-10-19 00:00:00.000",
      appliedStamp: "2026-10-20 09:00:00.000",
    });

    expect(manifest.stamp).toBe("2026-10-19 00:00:00.000");
    expect(manifest.appliedStamp).toBe("2026-10-20 09:00:00.000");
    expect(
      manifest.entries.map((entry) => [entry.path, entry.action]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([
      ["roguelike/new.json", "added"],
      ["tasks/tasks.json", "replaced"],
    ]);
    expect(await readFile(join(target, "tasks/tasks.json"), "utf8")).toBe("new tasks");
    expect(await readFile(join(target, "roguelike/new.json"), "utf8")).toBe("brand new");
    expect(await readFile(join(backup, "files", "tasks/tasks.json"), "utf8")).toBe("old tasks");
    expect(existsSync(join(backup, "files", "stages.json"))).toBe(false);
    expect(existsSync(join(staged, "tasks/tasks.json"))).toBe(false);
  });

  it("restores replaced files, deletes added files and drops the backup", async () => {
    const { staged, target, backup } = await fixture(
      {
        "tasks/tasks.json": "new tasks",
        "roguelike/new.json": "brand new",
      },
      { "tasks/tasks.json": "old tasks" },
    );

    await applyOverlay({
      stagedRoot: staged,
      targetRoot: target,
      backupRoot: backup,
      stamp: "2026-10-19 00:00:00.000",
      appliedStamp: "2026-10-20 09:00:00.000",
    });
    const restored = await restoreOverlay(backup, target);

    expect(restored).toEqual({ stamp: "2026-10-19 00:00:00.000", restored: 2 });
    expect(await readFile(join(target, "tasks/tasks.json"), "utf8")).toBe("old tasks");
    expect(existsSync(join(target, "roguelike/new.json"))).toBe(false);
    expect(existsSync(backup)).toBe(false);
  });

  it("leaves no partial backup behind when applying fails", async () => {
    const root = await temporaryRoot();
    const staged = join(root, "staged");
    const target = join(root, "resource");
    const backup = join(root, "backups", "2026-10-20");
    await mkdir(staged, { recursive: true });
    await mkdir(join(target, "conflict"), { recursive: true });
    await writeFile(join(target, "conflict", "inner.json"), "{}", "utf8");
    await writeFile(join(staged, "conflict"), "file where a directory already exists", "utf8");

    await expect(
      applyOverlay({
        stagedRoot: staged,
        targetRoot: target,
        backupRoot: backup,
        stamp: "2026-10-19 00:00:00.000",
        appliedStamp: "2026-10-20 09:00:00.000",
      }),
    ).rejects.toThrow();
    expect(existsSync(backup)).toBe(false);
    expect(existsSync(`${backup}.partial`)).toBe(false);
    expect(await readFile(join(target, "conflict", "inner.json"), "utf8")).toBe("{}");
  });

  it("lists backups newest first and prunes everything past the limit", async () => {
    const root = await temporaryRoot();
    const backupsRoot = join(root, "backups");
    const targetRoot = join(root, "resource");
    await mkdir(targetRoot, { recursive: true });

    for (const [index, stamp] of [
      "2026-10-17 00:00:00.000",
      "2026-10-18 00:00:00.000",
      "2026-10-19 00:00:00.000",
      "2026-10-20 00:00:00.000",
    ].entries()) {
      const staged = join(root, `staged-${index}`);
      await mkdir(staged, { recursive: true });
      await writeFile(join(staged, "version.json"), JSON.stringify({ last_updated: stamp }), "utf8");
      await applyOverlay({
        stagedRoot: staged,
        targetRoot,
        backupRoot: join(backupsRoot, `backup-${index}`),
        stamp,
        appliedStamp: stamp,
      });
      // createdAt is Date.now() for all four; make the order explicit.
      await writeFile(
        join(backupsRoot, `backup-${index}`, "manifest.json"),
        JSON.stringify({ stamp, appliedStamp: stamp, createdAt: 1_000 + index, entries: [], bytes: 0 }),
        "utf8",
      );
    }

    expect((await listOverlayBackups(backupsRoot)).map((backup) => backup.id)).toEqual([
      "backup-3",
      "backup-2",
      "backup-1",
      "backup-0",
    ]);

    const removed = await pruneOverlayBackups(backupsRoot, 3);
    expect(removed).toEqual(["backup-0"]);
    expect((await listOverlayBackups(backupsRoot)).map((backup) => backup.id)).toEqual([
      "backup-3",
      "backup-2",
      "backup-1",
    ]);
  });

  it("ignores symlinks in the staged tree", async () => {
    const root = await temporaryRoot();
    const staged = join(root, "staged");
    const target = join(root, "resource");
    await mkdir(staged, { recursive: true });
    await mkdir(target, { recursive: true });
    const outside = join(root, "outside.json");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, join(staged, "leak.json"));

    const manifest = await applyOverlay({
      stagedRoot: staged,
      targetRoot: target,
      backupRoot: join(root, "backup"),
      stamp: "x",
      appliedStamp: "y",
    });

    expect(manifest.entries).toEqual([]);
    expect(existsSync(join(target, "leak.json"))).toBe(false);
    expect(await readFile(outside, "utf8")).toBe("secret");
  });
});
