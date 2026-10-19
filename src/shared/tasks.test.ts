import { describe, expect, it } from "vitest";
import { DEFAULT_COPILOT_OPTIONS, type AppSettings, type TaskType } from "./schemas";
import {
  TASK_DEFINITIONS,
  TASK_PALETTE_ORDER,
  buildMaaTaskParams,
  createCopilotTask,
  createTask,
  firstMissingField,
  getTaskDefaults,
} from "./tasks";

const settings: AppSettings = {
  theme: "dark",
  locale: "zh-CN",
  adbPath: "",
  clientType: "Official",
  touchMode: "maatouch",
  connectionConfig: "General",
  confirmBeforeDownload: true,
  notifyOnComplete: true,
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

describe("required task fields", () => {
  it("flags a copilot task without any assignment", () => {
    const task = createTask("Copilot");
    expect(firstMissingField(task)?.zh).toBe("本地作业文件");
    expect(firstMissingField({ ...task, params: { ...task.params, filename: "/tmp/a.json" } })).toBeUndefined();
    const batched = {
      ...task,
      params: {
        ...task.params,
        copilot_list: [
          { id: "a", copilotId: 7, filename: "/tmp/prts-7.json", stage: "1-7", title: "t", isRaid: false },
        ],
      },
    };
    expect(firstMissingField(batched)).toBeUndefined();
  });

  it("flags a custom task without task names", () => {
    const task = createTask("Custom");
    expect(firstMissingField(task)?.zh).toBe("任务名");
    expect(firstMissingField({ ...task, params: { task_names: ["x"] } })).toBeUndefined();
  });

  it("has no required fields for the daily tasks", () => {
    for (const task of [createTask("StartUp"), createTask("Fight"), createTask("Depot")]) {
      expect(firstMissingField(task)).toBeUndefined();
    }
  });
});

describe("task catalogue", () => {
  it("offers every queue task in the palette exactly once", () => {
    const queueTypes = (Object.keys(TASK_DEFINITIONS) as TaskType[]).filter((type) => type !== "Copilot");
    expect([...TASK_PALETTE_ORDER].sort((a, b) => a.localeCompare(b))).toEqual(
      [...queueTypes].sort((a, b) => a.localeCompare(b)),
    );
    expect(new Set(TASK_PALETTE_ORDER).size).toBe(TASK_PALETTE_ORDER.length);
  });

  it("keeps Copilot out of the queue but able to build a standalone task", () => {
    expect(TASK_PALETTE_ORDER).not.toContain("Copilot");
    const task = createCopilotTask({
      items: [
        { id: "a", copilotId: 7, filename: "/tmp/prts-7.json", stage: "1-7", title: "t", isRaid: false },
        { id: "b", copilotId: 7, filename: "/tmp/prts-7.json", stage: "1-7", title: "t", isRaid: true },
      ],
      options: { ...DEFAULT_COPILOT_OPTIONS, loopTimes: 3, formationIndex: 2, useSanityPotion: true },
    });
    expect(task).toMatchObject({ type: "Copilot", enabled: true });
    expect(buildMaaTaskParams(task, settings)).toMatchObject({
      client_type: "Official",
      loop_times: 3,
      formation_index: 2,
      use_sanity_potion: true,
      copilot_list: [
        { id: 0, filename: "/tmp/prts-7.json", is_raid: false },
        { id: 1, filename: "/tmp/prts-7.json", is_raid: true },
      ],
    });
  });

  it("gives every task a default payload", () => {
    for (const type of TASK_PALETTE_ORDER) {
      expect(getTaskDefaults(type)).toBeTypeOf("object");
      expect(buildMaaTaskParams(createTask(type), settings).client_type).toBe("Official");
    }
  });
});

describe("task parameter goldens", () => {
  it("sends only the client type for StartUp", () => {
    expect(buildMaaTaskParams(createTask("StartUp"), settings)).toEqual({
      enable: true,
      client_type: "Official",
      start_game_enabled: true,
      account_name: "",
    });
  });

  it("drops zero-valued fight limits instead of sending them", () => {
    expect(buildMaaTaskParams(createTask("Fight"), settings)).toEqual({
      enable: true,
      client_type: "Official",
      server: "CN",
      series: 0,
      DrGrandet: false,
    });
  });

  it("pins the recruit defaults", () => {
    expect(buildMaaTaskParams(createTask("Recruit"), settings)).toMatchObject({
      enable: true,
      client_type: "Official",
      server: "CN",
      select: [4, 5],
      confirm: [3, 4, 5],
      refresh: false,
      times: 0,
      set_time: true,
      expedite: false,
      level3_recruitment_permit_reserve: 0,
    });
  });

  it("adds fiammetta targets only in the default infrast mode", () => {
    const task = createTask("Infrast");
    expect(buildMaaTaskParams(task, settings).fiammetta_targets).toEqual(["清流", "可露希尔", "但书"]);

    const rotation = { ...task, params: { ...task.params, mode: 20000 } };
    expect(buildMaaTaskParams(rotation, settings)).not.toHaveProperty("fiammetta_targets");
  });

  it("carries the award toggles through untouched", () => {
    const task = createTask("Award");
    const params = buildMaaTaskParams({ ...task, params: { ...task.params, mail: true } }, settings);
    expect(params).toMatchObject({ award: true, mail: true, recruit: false });
  });

  it("builds a copilot payload and drops an unused formation slot", () => {
    const task = createTask("Copilot");
    const params = buildMaaTaskParams({ ...task, params: { ...task.params, filename: "/tmp/copilot.json" } }, settings);
    expect(params).toMatchObject({
      enable: true,
      client_type: "Official",
      filename: "/tmp/copilot.json",
      formation: true,
      add_trust: false,
      ignore_requirements: false,
      use_sanity_potion: false,
      support_unit_usage: 0,
      loop_times: 1,
    });
    expect(params).not.toHaveProperty("formation_index");
  });

  it("keeps an explicit copilot formation slot", () => {
    const task = createTask("Copilot");
    const params = buildMaaTaskParams(
      { ...task, params: { ...task.params, filename: "/tmp/copilot.json", formation_index: 3, loop_times: 4 } },
      settings,
    );
    expect(params).toMatchObject({ formation_index: 3, loop_times: 4 });
  });

  it("builds a copilot batch with stable indices and both difficulties", () => {
    const task = createTask("Copilot");
    const params = buildMaaTaskParams(
      {
        ...task,
        params: {
          ...task.params,
          copilot_list: [
            { id: "a", copilotId: 7, filename: "/tmp/prts-7.json", stage: "1-7", title: "t", isRaid: false },
            { id: "b", copilotId: 7, filename: "/tmp/prts-7.json", stage: "1-7", title: "t", isRaid: true },
          ],
        },
      },
      settings,
    );

    expect(params).toMatchObject({ enable: true, client_type: "Official", formation: true, loop_times: 1 });
    expect(params.copilot_list).toEqual([
      { id: 0, filename: "/tmp/prts-7.json", is_raid: false },
      { id: 1, filename: "/tmp/prts-7.json", is_raid: true },
    ]);
    expect(params).not.toHaveProperty("filename");
  });

  it("clamps a zero copilot loop count to one", () => {
    const task = createTask("SSSCopilot");
    const params = buildMaaTaskParams(
      { ...task, params: { ...task.params, filename: "/tmp/sss.json", loop_times: 0 } },
      settings,
    );
    expect(params).toMatchObject({ filename: "/tmp/sss.json", loop_times: 1 });
  });

  it("sends only the file for a paradox copilot", () => {
    const task = createTask("ParadoxCopilot");
    expect(
      buildMaaTaskParams({ ...task, params: { ...task.params, filename: "/tmp/paradox.json" } }, settings),
    ).toEqual({ enable: true, client_type: "Official", filename: "/tmp/paradox.json" });
  });

  it("sends recognition tasks with no extra parameters", () => {
    for (const type of ["Depot", "OperBox"] as const) {
      expect(buildMaaTaskParams(createTask(type), settings)).toEqual({ enable: true, client_type: "Official" });
    }
  });

  it("filters non-string custom task names", () => {
    const task = createTask("Custom");
    const params = buildMaaTaskParams({ ...task, params: { task_names: ["mini-game", 3, null] } }, settings);
    expect(params.task_names).toEqual(["mini-game"]);
  });

  it("keeps the close-down payload minimal", () => {
    expect(buildMaaTaskParams(createTask("CloseDown"), settings)).toEqual({
      enable: true,
      client_type: "Official",
    });
  });
});
