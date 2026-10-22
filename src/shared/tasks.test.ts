import { describe, expect, it } from "vitest";
import { DEFAULT_COPILOT_OPTIONS, type AppSettings, type CopilotItem, type TaskType } from "./schemas";
import {
  TASK_DEFINITIONS,
  TASK_PALETTE_ORDER,
  buildMaaTaskParams,
  createCopilotRunTasks,
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
  closeToTray: false,
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

describe("copilot task dispatch", () => {
  const item = (kind: NonNullable<CopilotItem["kind"]>, filename: string, id = filename): CopilotItem => ({
    id,
    copilotId: 1,
    filename,
    stage: "1-7",
    title: "t",
    isRaid: false,
    kind,
  });
  const setup = (items: ReadonlyArray<CopilotItem>, loopTimes = 1) => ({
    items,
    options: { ...DEFAULT_COPILOT_OPTIONS, loopTimes },
  });

  it("keeps normal assignments in one Copilot batch", () => {
    const tasks = createCopilotRunTasks(setup([item("normal", "/tmp/a.json"), item("normal", "/tmp/b.json")]));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: "Copilot" });
    expect(tasks[0]!.params.copilot_list as ReadonlyArray<unknown>).toHaveLength(2);
  });

  it("runs each SSS file as its own task without auto formation", () => {
    const tasks = createCopilotRunTasks(setup([item("sss", "/tmp/a.json"), item("sss", "/tmp/b.json")], 4));
    expect(tasks.map((task) => task.type)).toEqual(["SSSCopilot", "SSSCopilot"]);
    expect(tasks[0]!.params).toMatchObject({ filename: "/tmp/a.json", formation: false, loop_times: 4 });
    expect(tasks[1]!.params).toMatchObject({ filename: "/tmp/b.json", formation: false, loop_times: 4 });
  });

  it("runs each Paradox file as its own task", () => {
    const tasks = createCopilotRunTasks(setup([item("paradox", "/tmp/a.json")]));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: "ParadoxCopilot", params: { filename: "/tmp/a.json" } });
  });

  it("refuses a batch that mixes task families", () => {
    expect(createCopilotRunTasks(setup([item("normal", "/tmp/a.json"), item("sss", "/tmp/b.json")]))).toEqual([]);
  });

  it("treats legacy items without a kind as normal", () => {
    const legacy: CopilotItem = {
      id: "legacy",
      copilotId: 1,
      filename: "/tmp/legacy.json",
      stage: "1-7",
      title: "t",
      isRaid: false,
    };
    expect(createCopilotRunTasks(setup([legacy]))[0]).toMatchObject({ type: "Copilot" });
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

describe("integrated strategies", () => {
  it("omits unlimited counts and empty optional strings", () => {
    const task = createTask("Roguelike");
    const params = buildMaaTaskParams({ ...task, params: { ...task.params, theme: "Sami", mode: 5 } }, settings);

    expect(params).toMatchObject({ theme: "Sami", mode: 5, squad: "指挥分队", roles: "取长补短" });
    expect(params).not.toHaveProperty("starts_count");
    expect(params).not.toHaveProperty("investments_count");
    expect(params).not.toHaveProperty("core_char");
    expect(params).not.toHaveProperty("collectible_mode_start_list");
    expect(params).not.toHaveProperty("collectible_mode_squad");
    expect(params).not.toHaveProperty("first_floor_foldartal");
    expect(params.expected_collapsal_paradigms).toEqual(["目空一些", "睁眼瞎", "图像损坏", "一抹黑"]);
  });

  it("keeps an explicit exploration limit", () => {
    const task = createTask("Roguelike");
    const params = buildMaaTaskParams({ ...task, params: { ...task.params, starts_count: 3 } }, settings);
    expect(params.starts_count).toBe(3);
  });

  it("turns selected opening rewards into the core's flag object", () => {
    const task = createTask("Roguelike");
    const params = buildMaaTaskParams(
      { ...task, params: { ...task.params, mode: 4, collectible_mode_start_list: ["hot_water", "hope"] } },
      settings,
    );
    expect(params.collectible_mode_start_list).toMatchObject({
      hot_water: true,
      hope: true,
      shield: false,
      ideas: false,
      ticket: false,
    });
  });
});

describe("reclamation", () => {
  it("keeps the crafting defaults and drops an empty tool list", () => {
    const task = createTask("Reclamation");
    expect(buildMaaTaskParams(task, settings)).toMatchObject({
      theme: "Fire",
      mode: 0,
      tools_to_craft: ["荧光棒"],
      increment_mode: 0,
      num_craft_batches: 16,
    });
    expect(
      buildMaaTaskParams({ ...task, params: { ...task.params, tools_to_craft: [] } }, settings),
    ).not.toHaveProperty("tools_to_craft");
  });
});

describe("single step", () => {
  it("builds stage, start and action payloads", () => {
    const task = createTask("SingleStep");
    expect(buildMaaTaskParams({ ...task, params: { ...task.params, stage: "1-7" } }, settings)).toEqual({
      enable: true,
      client_type: "Official",
      type: "copilot",
      subtask: "stage",
      details: { stage: "1-7" },
    });
    expect(buildMaaTaskParams({ ...task, params: { ...task.params, subtask: "start" } }, settings)).toEqual({
      enable: true,
      client_type: "Official",
      type: "copilot",
      subtask: "start",
    });

    const action = buildMaaTaskParams(
      {
        ...task,
        params: { ...task.params, subtask: "action", name: "史尔特尔", location: "4, 5", direction: "左", skill: 3 },
      },
      settings,
    );
    expect(action.details).toEqual({ name: "史尔特尔", location: [4, 5], direction: "左", skill: 3 });

    const basic = buildMaaTaskParams(
      { ...task, params: { ...task.params, subtask: "action", name: "史尔特尔", location: "4,5", skill: 0 } },
      settings,
    );
    expect(basic.details).toEqual({ name: "史尔特尔", location: [4, 5], direction: "右" });
  });

  it("only requires the fields its current step shows", () => {
    const task = createTask("SingleStep");
    expect(firstMissingField(task)?.zh).toBe("关卡");
    expect(firstMissingField({ ...task, params: { ...task.params, subtask: "start" } })).toBeUndefined();

    const action = { ...task, params: { ...task.params, subtask: "action", name: "史尔特尔", location: "" } };
    expect(firstMissingField(action)?.zh).toBe("部署位置");
    expect(firstMissingField({ ...action, params: { ...action.params, location: "4-5" } })?.zh).toBe("部署位置");
    expect(firstMissingField({ ...action, params: { ...action.params, location: "4,5" } })).toBeUndefined();
  });
});

describe("video recognition", () => {
  it("sends the picked path untouched and requires one", () => {
    const task = createTask("VideoRecognition");
    expect(firstMissingField(task)?.zh).toBe("作战录像");
    expect(buildMaaTaskParams({ ...task, params: { filename: "/tmp/battle.mp4" } }, settings)).toMatchObject({
      filename: "/tmp/battle.mp4",
    });
    expect(firstMissingField({ ...task, params: { filename: "/tmp/battle.mp4" } })).toBeUndefined();
  });
});

describe("roguelike and reclamation", () => {
  it("drops unlimited counts, empty operators and the empty reward list", () => {
    const task = {
      ...createTask("Roguelike"),
      params: { ...getTaskDefaults("Roguelike"), theme: "Sami", mode: 5, starts_count: 3 },
    };
    const params = buildMaaTaskParams(task, settings);
    expect(params).toMatchObject({
      theme: "Sami",
      mode: 5,
      starts_count: 3,
      squad: "指挥分队",
      roles: "取长补短",
      investment_enabled: true,
      expected_collapsal_paradigms: ["目空一些", "睁眼瞎", "图像损坏", "一抹黑"],
    });
    expect(params).not.toHaveProperty("investments_count");
    expect(params).not.toHaveProperty("core_char");
    expect(params).not.toHaveProperty("first_floor_foldartal");
    expect(params).not.toHaveProperty("collectible_mode_start_list");
  });

  it("turns the mode-4 opening rewards into the core's flag object", () => {
    const base = createTask("Roguelike");
    const params = buildMaaTaskParams(
      { ...base, params: { ...base.params, mode: 4, collectible_mode_start_list: ["hot_water", "hope"] } },
      settings,
    );
    expect(params.collectible_mode_start_list).toEqual({
      hot_water: true,
      shield: false,
      ingot: false,
      hope: true,
      random: false,
      key: false,
      dice: false,
      ideas: false,
      ticket: false,
    });
  });

  it("keeps the documented reclamation defaults and drops an empty tool list", () => {
    const task = createTask("Reclamation");
    expect(buildMaaTaskParams(task, settings)).toMatchObject({
      theme: "Fire",
      mode: 0,
      tools_to_craft: ["荧光棒"],
      increment_mode: 0,
      num_craft_batches: 16,
    });
    expect(
      buildMaaTaskParams({ ...task, params: { ...task.params, tools_to_craft: [] } }, settings),
    ).not.toHaveProperty("tools_to_craft");
  });
});

describe("single step and video recognition", () => {
  it("maps each single-step mode onto the core subtask contract", () => {
    const base = createTask("SingleStep");
    expect(buildMaaTaskParams({ ...base, params: { ...base.params, stage: "1-7" } }, settings)).toEqual({
      enable: true,
      client_type: "Official",
      type: "copilot",
      subtask: "stage",
      details: { stage: "1-7" },
    });
    expect(buildMaaTaskParams({ ...base, params: { ...base.params, subtask: "start" } }, settings)).toEqual({
      enable: true,
      client_type: "Official",
      type: "copilot",
      subtask: "start",
    });

    const action = buildMaaTaskParams(
      {
        ...base,
        params: { ...base.params, subtask: "action", name: "史尔特尔", location: "4, 5", direction: "左", skill: 3 },
      },
      settings,
    );
    expect(action.details).toEqual({ name: "史尔特尔", location: [4, 5], direction: "左", skill: 3 });

    const defaultSkill = buildMaaTaskParams(
      { ...base, params: { ...base.params, subtask: "action", name: "史尔特尔", location: "4,5", skill: 0 } },
      settings,
    );
    expect(defaultSkill.details).toEqual({ name: "史尔特尔", location: [4, 5], direction: "右" });
  });

  it("only requires the fields the chosen step actually shows", () => {
    const base = createTask("SingleStep");
    expect(firstMissingField(base)?.zh).toBe("关卡");
    expect(firstMissingField({ ...base, params: { ...base.params, subtask: "start" } })).toBeUndefined();
    expect(firstMissingField({ ...base, params: { ...base.params, subtask: "action", name: "史尔特尔" } })?.zh).toBe(
      "部署位置",
    );
    expect(
      firstMissingField({ ...base, params: { ...base.params, subtask: "action", name: "史尔特尔", location: "4-5" } })
        ?.zh,
    ).toBe("部署位置");
    expect(
      firstMissingField({ ...base, params: { ...base.params, subtask: "action", name: "史尔特尔", location: "4,5" } }),
    ).toBeUndefined();
  });

  it("requires a recording and passes the picked path through", () => {
    const base = createTask("VideoRecognition");
    expect(firstMissingField(base)?.zh).toBe("作战录像");
    expect(buildMaaTaskParams({ ...base, params: { filename: "/tmp/battle.mp4" } }, settings)).toEqual({
      enable: true,
      client_type: "Official",
      filename: "/tmp/battle.mp4",
    });
  });
});
