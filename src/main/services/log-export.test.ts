import { describe, expect, it } from "vitest";
import { DEFAULT_COPILOT_OPTIONS, DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTask } from "../../shared/tasks";
import { diagnosticsFiles, formatLogEntries, stampForFile, type DiagnosticsSnapshot } from "./log-export";

const snapshot: DiagnosticsSnapshot = {
  appVersion: "0.1.2",
  generatedAt: Date.parse("2024-01-02T03:04:05.678Z"),
  runtime: {
    app: { name: "Maax", version: "0.1.2", packaged: true, locale: "zh-CN" },
    versions: { electron: "45.0.0", chromium: "1", node: "26", v8: "1" },
    system: {
      platform: "linux",
      arch: "x64",
      release: "6.0",
      cpuCount: 8,
      totalMemoryBytes: 1024,
      timezone: "Asia/Shanghai",
    },
    security: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  },
  settings: DEFAULT_SETTINGS,
  engine: { phase: "ready", sessionCount: 1 },
  cores: [],
  devices: [],
  plans: [
    { id: "plan-1", deviceId: "device-1", name: "计划", tasks: [createTask("Fight")], createdAt: 1, updatedAt: 2 },
  ],
  schedules: [
    {
      deviceId: "device-1",
      enabled: true,
      time: "04:00",
      weekdays: [1, 2, 3, 4, 5, 6, 0],
    },
  ],
  history: {
    entries: [],
    stats: { total: 3, completed: 2, failed: 1, stopped: 0, today: 1, totalDurationMs: 1000, byDay: [], byTask: [] },
  },
  tools: {},
  copilot: { items: [], options: DEFAULT_COPILOT_OPTIONS },
  logs: [{ at: 0, level: "warn", message: "设备离线" }],
};

describe("log formatting", () => {
  it("writes one ISO-timestamped line per entry", () => {
    expect(formatLogEntries([{ at: 0, level: "info", message: "hello" }])).toBe(
      "1970-01-01T00:00:00.000Z [INFO] hello\n",
    );
  });

  it("still ends with a newline when there is nothing to write", () => {
    expect(formatLogEntries([])).toBe("\n");
  });
});

describe("stampForFile", () => {
  it("is stable and safe for a file name", () => {
    expect(stampForFile(Date.parse("2024-01-02T03:04:05.678Z"))).toBe("2024-01-02T03-04-05");
  });
});

describe("diagnostics bundle", () => {
  it("lists the bundle files in a stable order", () => {
    expect(diagnosticsFiles(snapshot).map(([name]) => name)).toEqual([
      "summary.json",
      "workspace.json",
      "schedules.json",
      "history.json",
      "tools.json",
      "copilot.json",
      "logs.txt",
      "README.txt",
    ]);
  });

  it("counts plans, schedules and runs into the summary", () => {
    const [name, text] = diagnosticsFiles(snapshot)[0]!;
    expect(name).toBe("summary.json");
    const summary = JSON.parse(text) as { generatedAt: string; counts: Record<string, number> };
    expect(summary.generatedAt).toBe("2024-01-02T03:04:05.678Z");
    expect(summary.counts).toEqual({ plans: 1, schedules: 1, runs: 3 });
  });

  it("warns that the bundle contains local configuration and addresses", () => {
    const readme = diagnosticsFiles(snapshot).at(-1)![1];
    expect(readme).toContain("device addresses");
    expect(readme).toContain("Maax 0.1.2 diagnostics bundle");
  });
});
