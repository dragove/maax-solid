import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require.resolve("@effect/tsgo/package.json");
const bin = join(dirname(packageJson), "dist", "effect-tsgo.cjs");

/** Patch one integration set; a nonzero status aborts the install. */
const patch = (extra) => {
  const result = spawnSync(process.execPath, [bin, "patch", "--no-typescript", "--oxlint", ...extra], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// The Oxlint integration is mandatory: an unsupported Oxlint/tsgolint version
// must fail loudly instead of silently dropping the Effect rules.
patch([]);

// The patched tsrs binary is not packaged for every target, so a missing
// replacement skips only this integration; `pnpm typecheck` runs tsrs directly.
patch(["--tsrs", "--skip-missing"]);
