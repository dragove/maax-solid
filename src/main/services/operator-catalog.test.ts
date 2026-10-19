import { describe, expect, it } from "vitest";
import { parseOperators, searchOperators } from "./operator-catalog";

const raw = {
  chars: {
    char_172_svrash: { name: "银灰", name_en: "SilverAsh", rarity: 6, profession: "WARRIOR", sortIndex: 1210 },
    char_291_aglina: { name: "安洁莉娜", name_en: "Angelina", rarity: 6, profession: "SUPPORT", sortIndex: 1310 },
    char_285_medic2: { name: "Lancet-2", name_en: "Lancet-2", rarity: 1, profession: "MEDIC", sortIndex: 20 },
    char_123_trap: { name: "屏障", name_en: "Barrier", rarity: 1, profession: "TRAP", sortIndex: 1 },
    char_broken: { name_en: "NoName", rarity: 3, profession: "CASTER" },
  },
  ranges: {},
};

describe("operator catalogue", () => {
  it("parses names, rarity and profession and drops traps", () => {
    const data = parseOperators(raw);
    expect(data.entries.map((entry) => entry.name)).toEqual(["银灰", "安洁莉娜", "Lancet-2"]);
    expect(data.entries[0]).toEqual({
      id: "char_172_svrash",
      name: "银灰",
      nameEn: "SilverAsh",
      rarity: 6,
      profession: "WARRIOR",
    });
  });

  it("matches Chinese and English names", () => {
    const data = parseOperators(raw);
    expect(searchOperators(data, "银灰")[0]?.id).toBe("char_172_svrash");
    expect(searchOperators(data, "silver")[0]?.id).toBe("char_172_svrash");
    expect(searchOperators(data, "银")[0]?.id).toBe("char_172_svrash");
    expect(searchOperators(data, "lancet")[0]?.id).toBe("char_285_medic2");
  });

  it("ranks a prefix match above a substring match", () => {
    const data = parseOperators(raw);
    // "a" is a prefix of Angelina (80) and only inside SilverAsh / Lancet-2 (50).
    expect(searchOperators(data, "a").map((entry) => entry.id)).toEqual([
      "char_291_aglina",
      "char_172_svrash",
      "char_285_medic2",
    ]);
  });

  it("prefers the higher rarity on equal matches", () => {
    const data = parseOperators(raw);
    // "e" is a plain substring of all three: 6★ first, then the game order.
    expect(searchOperators(data, "e").map((entry) => entry.id)).toEqual([
      "char_172_svrash",
      "char_291_aglina",
      "char_285_medic2",
    ]);
  });

  it("returns nothing for an empty query or unknown text", () => {
    const data = parseOperators(raw);
    expect(searchOperators(data, "  ")).toEqual([]);
    expect(searchOperators(data, "zzz")).toEqual([]);
  });

  it("tolerates a malformed file", () => {
    expect(parseOperators(undefined).entries).toEqual([]);
    expect(parseOperators({ chars: 5 }).entries).toEqual([]);
  });
});
