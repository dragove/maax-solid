import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCopilotQuery,
  buildCopilotSetBody,
  detailFromContent,
  isCopilotPath,
  itemsFromContent,
  mapCopilotSearch,
  mapCopilotSetSearch,
  parseCopilotInput,
  readCopilotDetail,
  repairCopilotFile,
  searchCopilotByIds,
} from "./copilot";
import type { PrtsClient } from "./prts";

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

  it("keeps a dual-difficulty assignment as one row with both boxes", () => {
    const items = itemsFromContent(content, 106833, "/tmp/prts-106833.json");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filename: "/tmp/prts-106833.json",
      stage: "act52side_ex03",
      title: "昨日海 YW-EX-3",
      modes: { normal: true, raid: true },
    });
  });

  it("defaults an unset mask to normal", () => {
    expect(itemsFromContent({ ...content, difficulty: 0 }, 1, "/tmp/a.json")[0]!.modes).toEqual({
      normal: true,
      raid: false,
    });
    expect(itemsFromContent({ stage_name: "1-7" }, 1, "/tmp/a.json")[0]!.modes).toEqual({
      normal: true,
      raid: false,
    });
  });

  it("keeps a raid-only assignment on the hard bit", () => {
    expect(itemsFromContent({ ...content, difficulty: 2 }, 1, "/tmp/a.json")[0]!.modes).toEqual({
      normal: false,
      raid: true,
    });
  });

  it("routes a tough stage to the hard bit even without a difficulty mask", () => {
    const items = itemsFromContent({ stage_name: "tough_12-16", doc: { title: "12-18 磨难" } }, 1, "/tmp/a.json");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      modes: { normal: false, raid: true },
      stage: "tough_12-16",
      kind: "normal",
    });
  });

  it("never selects raid for an H stage", () => {
    const items = itemsFromContent(
      { stage_name: "hard_17-04", difficulty: 3, doc: { title: "H17-4" } },
      1,
      "/tmp/a.json",
    );
    expect(items[0]!.modes).toEqual({ normal: true, raid: false });
  });

  it("falls back to the stage code when there is no title", () => {
    expect(itemsFromContent({ stage_name: "1-7" }, 1, "/tmp/a.json")[0]!.title).toBe("1-7");
  });

  it("marks an SSS protocol file as one row without difficulties", () => {
    const items = itemsFromContent(
      { type: "SSS", stage_name: "lt_21_01", difficulty: 3, doc: { title: "保全派驻 LT-1" } },
      7,
      "/tmp/sss.json",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "sss", stage: "lt_21_01" });
    expect(items[0]!.modes).toBeUndefined();
  });

  it("keeps ordinary files typed as normal", () => {
    expect(itemsFromContent({ ...content, difficulty: 1 }, 1, "/tmp/a.json")[0]!.kind).toBe("normal");
  });
});

describe("local assignment details", () => {
  it("extracts the doc block and operator plan", () => {
    expect(
      detailFromContent({
        doc: { details: "摆完挂机" },
        minimum_required: "v6.0.0",
        opers: [{ name: "银灰", role: "近卫", skill: 2, requirements: { elite: 2, level: 60 } }, { name: "" }],
        groups: [
          {
            name: "地刺",
            opers: [{ name: "狮蝎", skill: 1, requirements: { elite: 1, level: 70, skill_level: 10, module: 1 } }],
          },
        ],
      }),
    ).toEqual({
      details: "摆完挂机",
      minimumRequired: "v6.0.0",
      operators: [{ name: "银灰", role: "近卫", skill: 2, elite: 2, level: 60 }],
      groups: [
        {
          name: "地刺",
          operators: [{ name: "狮蝎", role: "", skill: 1, elite: 1, level: 70, module: 1 }],
        },
      ],
    });
  });

  it("only reads files inside the copilot folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "maax-copilot-"));
    const copilotDir = join(root, "copilot");
    await mkdir(copilotDir);
    const inside = join(copilotDir, "prts-1.json");
    const outside = join(root, "secret.json");
    await writeFile(inside, JSON.stringify({ doc: { details: "说明" }, opers: [{ name: "桃金娘", skill: 1 }] }));
    await writeFile(outside, JSON.stringify({ doc: { details: "不该被读到" } }));
    try {
      expect(isCopilotPath(inside, copilotDir)).toBe(true);
      expect(isCopilotPath(outside, copilotDir)).toBe(false);
      expect(isCopilotPath(join(copilotDir, "..", "secret.json"), copilotDir)).toBe(false);
      await expect(readCopilotDetail(inside, copilotDir)).resolves.toEqual({
        details: "说明",
        minimumRequired: "",
        operators: [{ name: "桃金娘", role: "", skill: 1 }],
        groups: [],
      });
      await expect(readCopilotDetail(outside, copilotDir)).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("yields null for a missing or malformed file", async () => {
    const root = await mkdtemp(join(tmpdir(), "maax-copilot-"));
    const file = join(root, "prts-2.json");
    try {
      await expect(readCopilotDetail(file, root)).resolves.toBeNull();
      await writeFile(file, "not json");
      await expect(readCopilotDetail(file, root)).resolves.toBeNull();
      await writeFile(file, JSON.stringify({ doc: {} }));
      await expect(readCopilotDetail(file, root)).resolves.toEqual({
        details: "",
        minimumRequired: "",
        operators: [],
        groups: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("copilot file repair", () => {
  const broken = {
    stage_name: "main_17-12",
    opers: [{ name: "狮蝎", skill: 1, requirements: { elite: 1, level: 70, skill_level: 10, module: 1 } }],
    groups: [
      {
        name: "地刺",
        opers: [{ name: "狮蝎", skill: 1, requirements: { elite: 1, level: 70, skill_level: 10, module: 1 } }],
      },
    ],
  };

  it("raises an elite level that contradicts skill/module requirements", async () => {
    const root = await mkdtemp(join(tmpdir(), "maax-repair-"));
    const file = join(root, "prts-92568.json");
    await writeFile(file, JSON.stringify(broken));
    try {
      const repair = await repairCopilotFile(file, new Set(["狮蝎"]));
      expect(repair?.fixes).toHaveLength(2);
      expect(repair?.fixes[0]).toContain("狮蝎");
      expect(repair?.fixes[0]).toContain("精英一 → 精英二");
      expect(repair?.fixes[1]).toContain("地刺 / 狮蝎");

      const saved = JSON.parse(await readFile(file, "utf8")) as typeof broken;
      expect(saved.opers[0]!.requirements.elite).toBe(2);
      expect(saved.groups[0]!.opers[0]!.requirements.elite).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves an operator unknown to the active core alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "maax-repair-"));
    const file = join(root, "unknown.json");
    const content = {
      stage_name: "main_17-12",
      opers: [{ name: "未来干员", skill: 1, requirements: { elite: 1, skill_level: 10 } }],
    };
    await writeFile(file, JSON.stringify(content));
    try {
      expect(await repairCopilotFile(file, new Set(["狮蝎"]))).toBeNull();
      const saved = JSON.parse(await readFile(file, "utf8")) as typeof content;
      expect(saved.opers[0]!.requirements.elite).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves a consistent assignment untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "maax-repair-"));
    const file = join(root, "valid.json");
    const content = {
      stage_name: "main_17-12",
      opers: [{ name: "狮蝎", skill: 1, requirements: { elite: 2, skill_level: 10, module: 1 } }],
    };
    await writeFile(file, JSON.stringify(content));
    try {
      expect(await repairCopilotFile(file, new Set(["狮蝎"]))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
    groups: [
      {
        name: "地刺",
        opers: [{ name: "狮蝎", skill: 1, requirements: { elite: 1, level: 70, skill_level: 10, module: 1 } }],
      },
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
    expect(result.items[0]!.groups).toEqual([
      {
        name: "地刺",
        operators: [{ name: "狮蝎", role: "", skill: 1, elite: 1, level: 70, module: 1 }],
      },
    ]);
    expect(result.items[1]).toMatchObject({ title: "", stage: "", operators: [] });
  });

  it("tolerates an empty or malformed response", () => {
    expect(mapCopilotSearch(undefined, new Map())).toEqual({ page: 1, total: 0, hasNext: false, items: [] });
    expect(mapCopilotSearch({ data: { data: [] } }, new Map()).items).toEqual([]);
  });
});

describe("copilot sets", () => {
  it("builds a snake_case POST body with clamped paging", () => {
    expect(buildCopilotSetBody({ keyword: " 相见欢 ", creatorId: "54130", page: 2, limit: 200 })).toEqual({
      page: 2,
      limit: 50,
      keyword: "相见欢",
      creator_id: "54130",
    });
    expect(buildCopilotSetBody({ page: 0, limit: 0, keyword: "  " })).toEqual({ page: 1, limit: 1 });
  });

  it("maps a set page and skips unusable rows", () => {
    const result = mapCopilotSetSearch({
      data: {
        has_next: true,
        total: 2683,
        data: [
          {
            id: 56210,
            name: "相见欢OR",
            description: "自用",
            creator: "Sylvain",
            creator_id: "54130",
            copilot_ids: [46417, 82135],
            create_time: "2026-10-26T14:04:29",
            update_time: "2026-10-26T15:07:28",
          },
          { id: 0, name: "broken" },
        ],
      },
    });
    expect(result).toEqual({
      total: 2683,
      hasNext: true,
      items: [
        {
          id: 56210,
          name: "相见欢OR",
          description: "自用",
          creator: "Sylvain",
          creatorId: "54130",
          copilotIds: [46417, 82135],
          createTime: "2026-10-26T14:04:29",
          updateTime: "2026-10-26T15:07:28",
        },
      ],
    });
  });

  it("fetches set contents in the set's own order", async () => {
    const client = {
      getJson: async (path: string) => {
        const ids = new URLSearchParams(path.split("?")[1]).getAll("copilot_ids").map(Number);
        return {
          data: {
            data: ids.map((id) => ({
              id,
              content: JSON.stringify({ stage_name: "main_01-07", doc: { title: `t${id}` } }),
            })),
          },
        };
      },
    } as unknown as PrtsClient;
    const items = await searchCopilotByIds(client, [3, 1, 3], new Map());
    expect(items.map((item) => item.id)).toEqual([3, 1]);
  });

  it("chunks the id filter at the page cap", async () => {
    const calls: number[] = [];
    const client = {
      getJson: async (path: string) => {
        const ids = new URLSearchParams(path.split("?")[1]).getAll("copilot_ids").map(Number);
        calls.push(ids.length);
        return { data: { data: ids.map((id) => ({ id, content: "{}" })) } };
      },
    } as unknown as PrtsClient;
    const ids = Array.from({ length: 60 }, (_, index) => index + 1);
    expect(await searchCopilotByIds(client, ids, new Map())).toHaveLength(60);
    expect(calls).toEqual([50, 10]);
  });
});
