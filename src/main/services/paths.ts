import { Context, Layer } from "effect";
import { app } from "electron";
import { join } from "node:path";

export interface AppPathInfo {
  readonly userData: string;
  readonly configDir: string;
  readonly coresDir: string;
  readonly coresFile: string;
  readonly settingsFile: string;
  readonly workspaceFile: string;
  readonly logsDir: string;
  readonly maaDir: string;
  readonly cacheDir: string;
  readonly resourceBackupsDir: string;
  readonly copilotDir: string;
  readonly copilotSetupFile: string;
}

export class AppPaths extends Context.Service<AppPaths, AppPathInfo>()("maax/AppPaths") {}

export const AppPathsLive = Layer.succeed(
  AppPaths,
  (() => {
    const userData = app.getPath("userData");
    const maaDir = join(userData, "maa");
    return {
      userData,
      configDir: join(userData, "config"),
      coresDir: join(userData, "cores"),
      coresFile: join(userData, "config", "cores.json"),
      settingsFile: join(userData, "config", "settings.json"),
      workspaceFile: join(userData, "config", "workspace.json"),
      logsDir: join(userData, "logs"),
      maaDir,
      cacheDir: join(userData, "cache"),
      resourceBackupsDir: join(userData, "resource-backups"),
      copilotDir: join(userData, "copilot"),
      copilotSetupFile: join(userData, "config", "copilot.json"),
    };
  })(),
);
