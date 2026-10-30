import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require.resolve("@effect/tsgo/package.json");
const bin = join(dirname(packageJson), "dist", "effect-tsgo.cjs");

const args = ["patch", "--no-typescript", "--oxlint"];
// @effect/tsgo 0.59 only knows darwin/linux tsrs targets. Patching tsrs on
// Windows aborts the whole install, so patch only the Oxlint integration there;
// `pnpm typecheck` still runs @tsrs/win32-x64 directly.
if (process.platform !== "win32") args.push("--tsrs");

const result = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
