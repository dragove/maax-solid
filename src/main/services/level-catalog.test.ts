import { describe, expect, it } from "vitest";
import { findLevel, parseLevels, searchLevels, type LevelEntry } from "./level-catalog";

const entries: ReadonlyArray<LevelEntry> = parseLevels({
  status_code: 200,
  data: [
    {
      level_id: "obt/main/level_main_01-07",
      stage_id: "main_01-07",
      cat_one: "主题曲",
      cat_three: "1-7",
      name: "暴君",
    },
    {
      level_id: "obt/main/level_main_12-17",
      stage_id: "main_12-17",
      cat_one: "主题曲",
      cat_three: "12-17",
      name: "飞跃，烟火",
    },
    {
      level_id: "obt/hard/level_hard_12-17",
      stage_id: "hard_12-17",
      cat_one: "主题曲",
      cat_three: "H12-17（标准）",
      name: "艰难前行",
    },
    {
      level_id: "act/act52side/level_act52side_ex03",
      stage_id: "act52side_ex03",
      cat_one: "活动关卡",
      cat_three: "YW-EX-3",
      name: "一本笔记",
    },
    { stage_id: "", cat_one: "坏数据" },
  ],
});

describe("level catalogue", () => {
  it("parses stage ids, display codes and names", () => {
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({ stageId: "main_01-07", code: "1-7", name: "暴君", category: "主题曲" });
  });

  it("ranks an exact code above substring matches", () => {
    expect(searchLevels(entries, "1-7")[0]?.stageId).toBe("main_01-07");
    const ranked = searchLevels(entries, "12-17");
    expect(ranked.map((item) => item.stageId)).toEqual(["main_12-17", "hard_12-17"]);
  });

  it("matches stage names and event codes", () => {
    expect(searchLevels(entries, "暴君")[0]?.stageId).toBe("main_01-07");
    expect(searchLevels(entries, "YW-EX")[0]?.stageId).toBe("act52side_ex03");
    expect(searchLevels(entries, "act52side")[0]?.stageId).toBe("act52side_ex03");
  });

  it("returns nothing for an empty query", () => {
    expect(searchLevels(entries, "   ")).toEqual([]);
  });

  it("resolves a display code, a stage id and a hard-mode label", () => {
    expect(findLevel(entries, "1-7")?.stageId).toBe("main_01-07");
    expect(findLevel(entries, "main_01-07")?.code).toBe("1-7");
    expect(findLevel(entries, "h12-17")?.stageId).toBe("hard_12-17");
    expect(findLevel(entries, "nope")).toBeUndefined();
  });
});
