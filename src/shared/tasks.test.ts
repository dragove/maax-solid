import { describe, expect, it } from "vitest";
import type { AppSettings } from "./schemas";
import { buildMaaTaskParams, createTask, getTaskDefaults } from "./tasks";

const settings: AppSettings = {
  theme: "dark",
  locale: "zh-CN",
  adbPath: "",
  clientType: "Official",
  touchMode: "maatouch",
  connectionConfig: "General",
  confirmBeforeDownload: true,
  notifyOnComplete: true,
  minimizeToTray: false,
  developerMode: false,
};

describe("task parameter builder", () => {
  it("omits empty fight limits while keeping explicit settings", () => {
    const task = {
      ...createTask("Fight"),
      params: { ...getTaskDefaults("Fight"), stage: "1-7", medicine: 2, series: 3 },
    };
    expect(buildMaaTaskParams(task, settings)).toMatchObject({
      enable: true,
      client_type: "Official",
      server: "CN",
      stage: "1-7",
      medicine: 2,
      series: 3,
    });
    expect(buildMaaTaskParams(task, settings)).not.toHaveProperty("times");
  });

  it("passes AUTO series through as zero", () => {
    const task = createTask("Fight");
    expect(task.params.series).toBe(0);
    expect(buildMaaTaskParams(task, settings).series).toBe(0);
  });

  it("creates every default task with valid params", () => {
    const task = createTask("StartUp");
    expect(task.enabled).toBe(true);
    expect(buildMaaTaskParams(task, settings).client_type).toBe("Official");
  });
});
