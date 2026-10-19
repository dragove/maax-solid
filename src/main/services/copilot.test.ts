import { describe, expect, it } from "vitest";
import { buildCopilotQuery, itemsFromContent, mapCopilotSearch, parseCopilotInput } from "./copilot";

describe("copilot references", () => {
  it("reads bare ids", () => {
    expect(parseCopilotInput("123")).toEqual({ kind: "single", id: 123 });
    expect(parseCopilotInput("  456 ")).toEqual({ kind: "single", id: 456 });
  });

  it("reads prts and maa shortcuts", () => {
    expect(parseCopilotInput("prts://123")).toEqual({ kind: "single", id: 123 });
    expect(parseCopilotInput("maa://123")).toEqual({ kind: "single", id: 123 });
    expect(parseCopilotInput("prts://s/123")).toEqual({ kind: "set", id: 123 });
    expect(parseCopilotInput("prts://set/7")).toEqual({ kind: "set", id: 7 });
    expect(parseCopilotInput("s123")).toEqual({ kind: "set", id: 123 });
    expect(parseCopilotInput("set:9")).toEqual({ kind: "set", id: 9 });
  });

  it("reads prts.plus links", () => {
    expect(parseCopilotInput("https://prts.plus/copilot/106833")).toEqual({ kind: "single", id: 106833 });
    expect(parseCopilotInput("https://prts.plus/#/copilot/106833")).toEqual({ kind: "single", id: 106833 });
    expect(parseCopilotInput("https://prts.plus/set/42")).toEqual({ kind: "set", id: 42 });
  });

  it("rejects everything else", () => {
    for (const input of ["", "abc", "0", "-5", "https://prts.plus/copilot/abc", "12.5"]) {
      expect(parseCopilotInput(input)).toBeUndefined();
    }
  });
});

describe("copilot items", () => {
  const content = {
    stage_name: "act52side_ex03",
    difficulty: 3,
    doc: { title: "昨日海 YW-EX-3" },
  };

  it("expands a dual-difficulty assignment into normal and raid entries", () => {
    const items = itemsFromContent(content, 106833, "/tmp/prts-106833.json");
    expect(items.map((item) => item.isRaid)).toEqual([false, true]);
    expect(items.every((item) => item.filename === "/tmp/prts-106833.json")).toBe(true);
    expect(items.every((item) => item.stage === "act52side_ex03")).toBe(true);
    expect(items[0]!.title).toBe("昨日海 YW-EX-3");
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("keeps a normal-only assignment to one entry", () => {
    expect(itemsFromContent({ ...content, difficulty: 1 }, 1, "/tmp/a.json")).toHaveLength(1);
    expect(itemsFromContent({ ...content, difficulty: 0 }, 1, "/tmp/a.json")).toHaveLength(1);
    expect(itemsFromContent({ stage_name: "1-7" }, 1, "/tmp/a.json")[0]!.isRaid).toBe(false);
  });

  it("keeps a raid-only assignment to one raid entry", () => {
    const items = itemsFromContent({ ...content, difficulty: 2 }, 1, "/tmp/a.json");
    expect(items).toHaveLength(1);
    expect(items[0]!.isRaid).toBe(true);
  });

  it("falls back to the stage code when there is no title", () => {
    expect(itemsFromContent({ stage_name: "1-7" }, 1, "/tmp/a.json")[0]!.title).toBe("1-7");
  });
});

describe("copilot search query", () => {
  it("omits empty filters and keeps the documented parameter names", () => {
    expect(buildCopilotQuery({ document: "1-7" })).toBe(
      "/copilot/query?page=1&limit=20&orderBy=hot&desc=true&language=zh&document=1-7",
    );
    expect(buildCopilotQuery({ document: "  ", operator: "", page: 2, limit: 10, desc: false })).toBe(
      "/copilot/query?page=2&limit=10&orderBy=hot&desc=false&language=zh",
    );
  });

  it("includes stage, operator and uploader filters when given", () => {
    const query = buildCopilotQuery({ stage: "main_01-07", operator: "银灰", uploaderId: "7661", orderBy: "views" });
    expect(query).toContain("level_keyword=main_01-07");
    expect(query).toContain("operator=%E9%93%B6%E7%81%B0");
    expect(query).toContain("uploader_id=7661");
    expect(query).toContain("orderBy=views");
  });

  it("clamps the page size", () => {
    expect(buildCopilotQuery({ limit: 500 })).toContain("limit=50");
    expect(buildCopilotQuery({ limit: 0 })).toContain("limit=1");
    expect(buildCopilotQuery({ page: -3 })).toContain("page=1");
  });
});

describe("copilot search mapping", () => {
  const content = {
    stage_name: "main_01-07",
    difficulty: 3,
    minimum_required: "v6.0.0",
    doc: { title: "1-7 速刷", details: "摆完挂机" },
    opers: [
      { name: "银灰", role: "近卫", skill: 2, requirements: { elite: 2, level: 60, module: 3, potentiality: 1 } },
      { name: "桃金娘", skill: 1 },
      { name: "" },
    ],
  };
  const raw = {
    status_code: 200,
    data: {
      page: 2,
      total: 296,
      has_next: true,
      data: [
        {
          id: 105175,
          uploader: "萨拉托加",
          uploader_id: "7661",
          views: 1200,
          hot_score: 12.5,
          rating_level: 9,
          content: JSON.stringify(content),
        },
        { id: 0, content: "{}" },
        { id: 1, content: "not json" },
      ],
    },
  };

  it("maps rows and skips unusable ones", () => {
    const result = mapCopilotSearch(raw, new Map([["main_01-07", "1-7"]]));
    expect(result).toMatchObject({ page: 2, total: 296, hasNext: true });
    expect(result.items.map((item) => item.id)).toEqual([105175, 1]);
    expect(result.items[0]).toMatchObject({
      title: "1-7 速刷",
      details: "摆完挂机",
      stage: "main_01-07",
      stageCode: "1-7",
      difficulty: 3,
      uploader: "萨拉托加",
      uploaderId: "7661",
      views: 1200,
      ratingLevel: 9,
      minimumRequired: "v6.0.0",
    });
    expect(result.items[0]!.operators[0]).toEqual({
      name: "银灰",
      role: "近卫",
      skill: 2,
      elite: 2,
      level: 60,
      module: 3,
      potential: 1,
    });
    expect(result.items[0]!.operators[1]).toEqual({ name: "桃金娘", role: "", skill: 1 });
    expect(result.items[1]).toMatchObject({ title: "", stage: "", operators: [] });
  });

  it("tolerates an empty or malformed response", () => {
    expect(mapCopilotSearch(undefined, new Map())).toEqual({ page: 1, total: 0, hasNext: false, items: [] });
    expect(mapCopilotSearch({ data: { data: [] } }, new Map()).items).toEqual([]);
  });
});
