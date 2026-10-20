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

describe("task chain lifecycle", () => {
  it("separates a finished chain from a started one", () => {
    const done = formatCoreCallback(event(10002, { taskchain: "Fight" }), "zh-CN");
    const started = formatCoreCallback(event(10001, { taskchain: "Fight" }), "zh-CN");
    expect(done?.level).toBe("success");
    expect(started?.level).toBe("info");
  });
});
