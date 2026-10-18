import { describe, expect, it } from "vitest";
import type { CoreCallbackEvent } from "../../shared/schemas";
import { formatCoreCallback } from "./log-format";

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
