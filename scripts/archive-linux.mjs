#!/usr/bin/env node
/**
 * Build the single release tarball from `dist/linux-unpacked`.
 *
 * electron-builder only knows zip / 7z / tar.gz / tar.bz2 / tar.xz / tar.lz for
 * archive targets, and every tar one re-archives the whole tree with
 * single-threaded 7-Zip: -mx=9 costs ~146 s for our 272 MB tree and -mx=5 ~47 s.
 * `tar | zstd -T0` archives the same tree in about a second, so the tarball is
 * produced here and `dist` keeps only what electron-builder is good at
 * (AppImage, deb).
 *
 * Usage:
 *   node scripts/archive-linux.mjs              # zstd -9, ~1 s
 *   node scripts/archive-linux.mjs --level 19   # ~22 s, 10 MB smaller
 *
 * Measured on the 272 MB tree: -4 -> 117 MB in 1 s, -9 -> 108 MB in 1 s,
 * -19 -> 97 MB in 22 s (multi-threaded xz -T0 would be 93 MB in 16 s).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = join(root, "dist", "linux-unpacked");

const levelIndex = process.argv.indexOf("--level");
const level = levelIndex === -1 ? 9 : Number(process.argv[levelIndex + 1]);
if (!Number.isInteger(level) || level < 1 || level > 22) {
  console.error("--level takes an integer between 1 and 22");
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`${source} is missing; run \`pnpm package\` first`);
  process.exit(1);
}

const name = `${manifest.productName ?? "Maax"}-${manifest.version}-linux-${process.arch}.tar.zst`;
const out = join(root, "dist", name);
mkdirSync(dirname(out), { recursive: true });

const settled = (label, proc) =>
  new Promise((resolve, reject) => {
    proc.on("error", (error) => reject(new Error(`${label}: ${error.message}`)));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))));
  });

const startedAt = Date.now();
const tar = spawn("tar", ["-C", source, "-cf", "-", "."], { stdio: ["ignore", "pipe", "inherit"] });
const zstd = spawn("zstd", ["-q", "-f", "-T0", `-${level}`, "-o", out], { stdio: ["pipe", "inherit", "inherit"] });
// A tar that dies would otherwise leave zstd waiting on stdin forever.
tar.on("error", () => zstd.kill());
tar.stdout.pipe(zstd.stdin);

try {
  await Promise.all([settled("tar", tar), settled("zstd", zstd)]);
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)} (is zstd installed?)`);
  process.exit(1);
}

const megabytes = (statSync(out).size / 1_000_000).toFixed(1);
console.log(`${name} — ${megabytes} MB in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
