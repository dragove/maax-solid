import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import solid from "@solidjs/vite-plugin";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

interface PackageManifest {
  version: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as PackageManifest;

const versionOf = (version: string | undefined): string => version?.replace(/^[~^]/, "") ?? "unknown";

const buildMetadata = {
  hostNode: process.version,
  pnpm: manifest.packageManager?.split("@").at(-1) ?? "unknown",
  vite: versionOf(manifest.devDependencies?.vite),
  electron: versionOf(manifest.devDependencies?.electron),
  solid: versionOf(manifest.dependencies?.["solid-js"] ?? manifest.devDependencies?.["solid-js"]),
  effect: versionOf(manifest.devDependencies?.effect),
  typescript: versionOf(manifest.devDependencies?.typescript),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "core-host": resolve("src/main/core-host/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define: {
      __MAAX_BUILD__: JSON.stringify(buildMetadata),
    },
    plugins: [solid({ performanceTracks: false })],
  },
});
