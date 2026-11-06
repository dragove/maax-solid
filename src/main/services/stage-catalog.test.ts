import { describe, expect, it } from "vitest";
import {
  activityStageEntries,
  clientKeyFor,
  parseActivityDate,
  permanentStageEntries,
  type StageActivityData,
} from "./stage-catalog";

describe("permanent stage entries", () => {
  it("keeps the current-stage placeholder first and localizes the groups", () => {
    const entries = permanentStageEntries("zh-CN");
    expect(entries[0]).toMatchObject({ value: "", groupLabel: "推荐" });
    expect(entries.find((entry) => entry.value === "CE-6")?.tip).toBe("龙门币");
  });

  it("uses the English labels for en-US", () => {
    const entries = permanentStageEntries("en-US");
    expect(entries[0]?.label).toBe("Current / last stage");
    expect(entries.some((entry) => entry.groupLabel === "Resource stages")).toBe(true);
  });
});

describe("parseActivityDate", () => {
  it("applies the time zone from the response", () => {
    expect(parseActivityDate("2024/05/01 04:00", 8)).toBe(Date.parse("2024-05-01T04:00:00+08:00"));
    expect(parseActivityDate("2024/05/01 04:00", -5)).toBe(Date.parse("2024-05-01T04:00:00-05:00"));
  });

  it("returns 0 for a missing or unparsable value so the window stays open", () => {
    expect(parseActivityDate(undefined, 8)).toBe(0);
    expect(parseActivityDate("not a date", 8)).toBe(0);
  });
});

const live = {
  Activity: {
    StageName: "夏日活动",
    UtcStartTime: "2024/05/01 04:00",
    UtcExpireTime: "2024/06/30 03:59",
    TimeZone: 8,
  },
  Stages: [{ Value: "SV-1", Display: "SV-1", Drop: "装置" }],
};

const data = {
  CN: {
    sideStoryStage: {
      live,
      ended: {
        Activity: {
          StageName: "旧活动",
          UtcStartTime: "2024/01/01 04:00",
          UtcExpireTime: "2024/02/01 03:59",
          TimeZone: 8,
        },
        Stages: [{ Value: "OLD-1" }],
      },
      future: {
        Activity: {
          StageName: "新活动",
          UtcStartTime: "2024/07/01 04:00",
          UtcExpireTime: "2024/08/01 03:59",
          TimeZone: 8,
        },
        Stages: [{ Value: "NEW-1" }],
      },
      always: { Stages: [{ Value: "XX-1" }] },
    },
  },
  US: {
    sideStoryStage: {
      live: { ...live, Activity: { ...live.Activity, StageName: "Summer" } },
    },
  },
} as unknown as StageActivityData;

const now = Date.parse("2024-06-01T00:00:00Z");

describe("activity stage entries", () => {
  it("keeps live and undated windows and drops the rest", () => {
    expect(activityStageEntries(data, "CN", "zh-CN", now).map((entry) => entry.value)).toEqual(["SV-1", "XX-1"]);
  });

  it("labels the group with the event name and carries the drop", () => {
    expect(activityStageEntries(data, "CN", "zh-CN", now)[0]).toEqual({
      value: "SV-1",
      label: "SV-1",
      group: "activity",
      groupLabel: "活动 · 夏日活动",
      tip: "掉落: 装置",
    });
  });

  it("reads only the requested client and localizes the group label", () => {
    expect(activityStageEntries(data, "US", "en-US", now)[0]?.groupLabel).toBe("Event · Summer");
    expect(activityStageEntries(data, "JP", "en-US", now)).toEqual([]);
  });

  it("maps Bilibili onto the official list", () => {
    expect(clientKeyFor("Bilibili")).toBe("Official");
    expect(clientKeyFor("YoStarEN")).toBe("YoStarEN");
  });
});
