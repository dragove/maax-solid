#!/usr/bin/env node
/**
 * Pick the next release version for a master build.
 *
 * The latest reachable v* tag wins unless package.json has moved ahead, so a
 * manual minor/major bump takes precedence; otherwise the patch version is
 * incremented. Without a tag, package.json's version is the first release.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version: packageVersion } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let latestTag = "";
try {
  const tags = execFileSync("git", ["tag", "--list", "v[0-9]*", "--sort=-v:refname"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  latestTag = tags.split("\n")[0] ?? "";
} catch {
  // Not a git checkout: the first release uses package.json as-is.
}

const released = latestTag.replace(/^v/, "");
const version =
  released && semver.valid(released) && semver.gte(released, packageVersion)
    ? semver.inc(released, "patch")
    : packageVersion;

process.stdout.write(`${version}\n`);
