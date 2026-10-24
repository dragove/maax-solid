import { describe, expect, it } from "vitest";
import type { CoreCallbackEvent } from "../../shared/schemas";
import { firstLine, formatCoreCallback, formatLogTime } from "./log-format";

const event = (msg: number, payload: Record<string, unknown>): CoreCallbackEvent => ({
  _tag: "core-callback",
  sessionId: "device",
  deviceId: "device",
  msg,
  payload,
  raw: JSON.stringify(payload),
  at: 1,
});

describe("core callback formatting", () => {
  it("keeps ordinary ProcessTask recognition misses out of the warning stream", () => {
    const line = formatCoreCallback(
      event(20000, {
        subtask: "ProcessTask",
        taskchain: "Fight",
        first: ["LastOrCurBattleBegin"],
        details: {},
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("debug");
    expect(line?.message).toContain("LastOrCurBattleBegin");
    expect(line?.message).not.toContain("unknown");
  });

  it("explains a stuck copilot stage navigation as a warning", () => {
    const line = formatCoreCallback(
      event(20003, {
        what: "ExceededLimit",
        taskchain: "Copilot",
        first: ["Copilot@FullStageNavigation"],
        details: { task: "FullStageNavigation" },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("warn");
    expect(line?.message).toContain("关卡地图");
  });

  it("surfaces recruitment failures as errors", () => {
    const line = formatCoreCallback(
      event(20000, { subtask: "AutoRecruitTask", taskchain: "Recruit", why: "no permit" }),
      "zh-CN",
    );
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("no permit");
  });
});

describe("row time", () => {
  it("formats a fixed-width local clock", () => {
    expect(formatLogTime(new Date(2024, 0, 2, 7, 5, 3).getTime())).toBe("07:05:03");
  });

  it("keeps only the headline for compact surfaces", () => {
    expect(firstLine("本次掉落 · CE-6\n龙门币 ×21")).toBe("本次掉落 · CE-6");
    expect(firstLine("单行")).toBe("单行");
  });
});

describe("stage drops", () => {
  it("lists every drop under the stage headline", () => {
    const line = formatCoreCallback(
      event(20003, {
        what: "StageDrops",
        taskchain: "Fight",
        details: {
          stage: { stageCode: "CE-6" },
          stats: [
            { itemName: "龙门币", quantity: 21, addQuantity: 1 },
            { itemName: "固源岩", quantity: 2 },
          ],
          cur_times: 3,
        },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("info");
    expect(line?.message).toContain("本次掉落 · CE-6");
    expect(line?.message).toContain("龙门币 ×21 (+1)");
    expect(line?.message).toContain("固源岩 ×2");
    expect(line?.message).toContain("轮数 3");
    expect(line?.message.split("\n")).toHaveLength(4);
  });

  it("still reports an empty drop list", () => {
    const line = formatCoreCallback(event(20003, { what: "StageDrops", details: {} }), "zh-CN");
    expect(line?.message).toContain("无掉落");
  });
});

describe("recruit results", () => {
  it("highlights a five star result and keeps the candidates as detail", () => {
    const line = formatCoreCallback(
      event(20003, {
        what: "RecruitResult",
        taskchain: "Recruit",
        details: {
          level: 5,
          result: [{ level: 5, tags: ["资深干员", "输出"], opers: [{ name: "能天使", level: 5 }] }],
        },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("success");
    expect(line?.message).toContain("5 ★");
    expect(line?.detail).toContain("能天使");
    expect(line?.detail).toContain("资深干员");
  });

  it("keeps an ordinary result unremarkable", () => {
    const line = formatCoreCallback(event(20003, { what: "RecruitResult", details: { level: 3 } }), "zh-CN");
    expect(line?.level).toBe("info");
    expect(line?.detail).toBeUndefined();
  });

  it("bounds star counts from an untrusted payload", () => {
    const line = formatCoreCallback(
      event(20003, { what: "RecruitResult", details: { level: 1e9, result: [{ level: 1e9 }] } }),
      "zh-CN",
    );
    expect(line?.message).toContain("6 ★");
  });
});

describe("copilot failure causes", () => {
  it("names the file, stage and index that was loaded", () => {
    const line = formatCoreCallback(
      event(20003, {
        what: "CopilotListLoadTaskFileSuccess",
        taskchain: "Copilot",
        details: {
          file_name: "/tmp/maax/copilot/prts-96378.json",
          stage_name: "tough_12-16",
          id: 0,
        },
      }),
      "zh-CN",
    );
    expect(line?.message).toContain("作业已加载");
    expect(line?.message).toContain("prts-96378.json");
    expect(line?.message).toContain("tough_12-16");
    expect(line?.message).toContain("#1");
    expect(line?.message).not.toContain("/tmp/maax");

    const empty = formatCoreCallback(
      event(20003, {
        what: "CopilotListLoadTaskFileSuccess",
        taskchain: "Copilot",
        details: {},
      }),
      "zh-CN",
    );
    expect(empty?.message).toBe("Copilot · 作业已加载");
  });

  it("turns a file read failure into a named error", () => {
    const line = formatCoreCallback(
      event(20000, {
        subtask: "CopilotTask",
        taskchain: "Copilot",
        what: "CopilotFileReadError",
        details: {},
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("无法被 MaaCore 解析");
  });

  it("names the unsupported stage", () => {
    const line = formatCoreCallback(
      event(20000, {
        subtask: "CopilotTask",
        taskchain: "Copilot",
        what: "CopilotStageNotSupported",
        details: { stage_name: "tough_12-16" },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("作业关卡不受支持");
    expect(line?.message).toContain("tough_12-16");
  });

  it("lists missing formation operators with their reasons", () => {
    const line = formatCoreCallback(
      event(20000, {
        subtask: "BattleFormationTask",
        taskchain: "Copilot",
        why: "OperatorMissing",
        details: {
          opers: {
            银灰: [{ name: "银灰", reason: "Missing" }],
            双人组: [
              { name: "能天使", reason: "Unavailable" },
              { name: "德克萨斯", reason: "Unchecked" },
            ],
          },
        },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("缺少编队干员");
    expect(line?.detail).toContain("银灰 (未拥有)");
    expect(line?.detail).toContain("双人组 ⇒ 能天使 (不满足要求) / 德克萨斯 (未选中)");
  });

  it("falls back to a map/difficulty hint when MaaCore gives no reason", () => {
    const line = formatCoreCallback(event(10000, { taskchain: "Copilot", taskid: 1 }), "zh-CN");
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("未返回具体原因");
    expect(line?.message).toContain("磨难");
  });

  it("does not report a failed queue as completed", () => {
    const line = formatCoreCallback(event(3, { taskchain: "Copilot" }), "zh-CN");
    expect(line?.level).toBe("info");
    expect(line?.message).toContain("任务队列结束");
    expect(line?.message).not.toContain("全部任务完成");
  });

  it("keeps an exception code from the task thread", () => {
    const line = formatCoreCallback(
      event(10000, { taskchain: "Copilot", taskid: 1, details: { error: "OutOfMemory" } }),
      "zh-CN",
    );
    expect(line?.message).toContain("OutOfMemory");
  });

  it("warns when a formation operator misses a requirement", () => {
    const line = formatCoreCallback(
      event(20003, {
        what: "BattleFormationOperUnavailable",
        taskchain: "Copilot",
        details: { oper_name: "银灰", requirement_type: "module" },
      }),
      "zh-CN",
    );
    expect(line?.level).toBe("warn");
    expect(line?.message).toContain("银灰");
    expect(line?.message).toContain("module");
  });

  it("surfaces an unsupported battle level as an error", () => {
    const line = formatCoreCallback(
      event(20003, { what: "UnsupportedLevel", taskchain: "Copilot", details: { level: "main_99-01" } }),
      "zh-CN",
    );
    expect(line?.level).toBe("error");
    expect(line?.message).toContain("main_99-01");
  });
});

describe("task chain lifecycle", () => {
  it("separates a finished chain from a started one", () => {
    const done = formatCoreCallback(event(10002, { taskchain: "Fight" }), "zh-CN");
    const started = formatCoreCallback(event(10001, { taskchain: "Fight" }), "zh-CN");
    expect(done?.level).toBe("success");
    expect(started?.level).toBe("info");
  });
});
