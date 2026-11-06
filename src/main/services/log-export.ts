import { Effect } from "effect";
import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppSettings,
  CopilotSetup,
  CoreInfo,
  DeviceProfile,
  EngineInfo,
  LogEntry,
  RunHistory,
  RuntimeInfo,
  Schedule,
  TaskPlan,
  ToolsState,
} from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";

/** Timestamp safe for a file name on every platform. */
export const stampForFile = (now: number = Date.now()): string =>
  new Date(now).toISOString().replace(/[:.]/gu, "-").slice(0, 19);

export const formatLogEntries = (entries: ReadonlyArray<LogEntry>): string =>
  entries
    .map((entry) => `${new Date(entry.at).toISOString()} [${entry.level.toUpperCase()}] ${entry.message}`)
    .join("\n") + "\n";

/**
 * Everything a diagnostics bundle needs, captured by the caller while it still
 * holds the live state. Keeping it a plain value is what lets the file layout
 * below stay testable.
 */
export interface DiagnosticsSnapshot {
  readonly appVersion: string;
  readonly generatedAt: number;
  readonly runtime: RuntimeInfo;
  readonly settings: AppSettings | undefined;
  readonly engine: EngineInfo;
  readonly cores: ReadonlyArray<CoreInfo>;
  readonly devices: ReadonlyArray<DeviceProfile>;
  readonly plans: ReadonlyArray<TaskPlan>;
  readonly schedules: ReadonlyArray<Schedule>;
  readonly history: RunHistory;
  readonly tools: ToolsState;
  readonly copilot: CopilotSetup;
  readonly logs: ReadonlyArray<LogEntry>;
}

export const diagnosticsFiles = (snapshot: DiagnosticsSnapshot): ReadonlyArray<readonly [string, string]> => {
  const generatedAt = new Date(snapshot.generatedAt).toISOString();
  const summary = {
    generatedAt,
    runtime: snapshot.runtime,
    settings: snapshot.settings,
    engine: snapshot.engine,
    cores: snapshot.cores,
    devices: snapshot.devices,
    counts: {
      plans: snapshot.plans.length,
      schedules: snapshot.schedules.length,
      runs: snapshot.history.stats.total,
    },
  };
  return [
    ["summary.json", JSON.stringify(summary, null, 2)],
    ["workspace.json", JSON.stringify({ plans: snapshot.plans }, null, 2)],
    ["schedules.json", JSON.stringify(snapshot.schedules, null, 2)],
    ["history.json", JSON.stringify(snapshot.history, null, 2)],
    ["tools.json", JSON.stringify(snapshot.tools, null, 2)],
    ["copilot.json", JSON.stringify(snapshot.copilot, null, 2)],
    ["logs.txt", formatLogEntries(snapshot.logs)],
    [
      "README.txt",
      [
        `Maax ${snapshot.appVersion} diagnostics bundle`,
        `Generated ${generatedAt}`,
        "",
        "This bundle contains local configuration, device addresses, installed",
        "core paths and recent run logs. Review it before sharing publicly.",
      ].join("\n") + "\n",
    ],
  ];
};

const saveDialog = (options: SaveDialogOptions, failure: string): Effect.Effect<string | null, MaaxError> =>
  Effect.gen(function* () {
    const window = BrowserWindow.getFocusedWindow();
    const picked = yield* Effect.tryPromise({
      try: () => (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)),
      catch: (cause) => maaxError(failure, cause),
    });
    return picked.canceled || picked.filePath === undefined ? null : picked.filePath;
  });

const openDirectoryDialog = (
  title: string,
  buttonLabel: string,
  failure: string,
): Effect.Effect<string | null, MaaxError> =>
  Effect.gen(function* () {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title,
      buttonLabel,
      properties: ["openDirectory", "createDirectory"],
    };
    const picked = yield* Effect.tryPromise({
      try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
      catch: (cause) => maaxError(failure, cause),
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

/** Write the bundle into a fresh sibling directory so an existing export is never overwritten. */
const writeDiagnosticsBundle = (
  parent: string,
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, MaaxError> =>
  Effect.tryPromise({
    try: async () => {
      const base = join(parent, `maax-diagnostics-${stampForFile()}`);
      let target = base;
      for (let index = 2; index < 100; index += 1) {
        const exists = await stat(target).then(
          () => true,
          () => false,
        );
        if (!exists) break;
        target = `${base}-${index}`;
      }
      await mkdir(target, { recursive: false });
      await Promise.all(files.map(([name, text]) => writeFile(join(target, name), text, "utf8")));
      return target;
    },
    catch: (cause) => maaxError("写入诊断包失败", cause),
  });

export const exportLogs = (
  entries: ReadonlyArray<LogEntry>,
  appVersion: string,
): Effect.Effect<string | null, MaaxError> =>
  Effect.gen(function* () {
    const path = yield* saveDialog(
      {
        title: "导出运行日志",
        defaultPath: `maax-logs-${stampForFile()}.log`,
        filters: [{ name: "Log", extensions: ["log", "txt"] }],
      },
      "打开保存对话框失败",
    );
    if (path === null) return null;
    const header = `# Maax ${appVersion} logs\n# Exported ${new Date().toISOString()}\n\n`;
    yield* Effect.tryPromise({
      try: () => writeFile(path, header + formatLogEntries(entries), "utf8"),
      catch: (cause) => maaxError("写入日志文件失败", cause),
    });
    return path;
  });

export const exportDiagnostics = (snapshot: DiagnosticsSnapshot): Effect.Effect<string | null, MaaxError> =>
  Effect.gen(function* () {
    const parent = yield* openDirectoryDialog("选择诊断包存放目录", "导出到这里", "打开目录对话框失败");
    if (parent === null) return null;
    return yield* writeDiagnosticsBundle(parent, diagnosticsFiles(snapshot));
  });
