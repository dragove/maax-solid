import { describe, expect, it } from "vitest";
import type { OperatorCatalogueData } from "./operator-catalog";
import { avatarPath, isAvatarId, mergeRoguelikeOperators, parseStartingOperators } from "./roguelike-catalog";

const raw = {
  priority: [
    {
      name: "第一组",
      opers: [
        { name: "维什戴尔", is_start: true },
        { name: "银灰", is_start: false },
        { name: " 凯尔希 ", is_start: true },
        { name: "", is_start: true },
        { name: 5, is_start: true },
      ],
    },
    {
      opers: [
        { name: "维什戴尔", is_start: true },
        { name: "古米", is_start: true },
      ],
    },
    { opers: "broken" },
    null,
  ],
};

describe("roguelike starting operators", () => {
  it("keeps the is_start operators in recommendation order, trimmed and deduped", () => {
    expect(parseStartingOperators(raw)).toEqual(["维什戴尔", "凯尔希", "古米"]);
  });

  it("tolerates a malformed file", () => {
    expect(parseStartingOperators(undefined)).toEqual([]);
    expect(parseStartingOperators({ priority: 5 })).toEqual([]);
    expect(parseStartingOperators({ priority: [{ opers: [null, 5, {}] }] })).toEqual([]);
  });
});

const catalogue: OperatorCatalogueData = {
  entries: [
    { id: "char_a", name: "甲", nameEn: "A", rarity: 6, profession: "WARRIOR" },
    { id: "char_b", name: "乙", nameEn: "B", rarity: 4, profession: "CASTER" },
    { id: "char_c", name: "丙", nameEn: "C", rarity: 6, profession: "MEDIC" },
    { id: "char_d", name: "丁", nameEn: "D", rarity: 3, profession: "SNIPER" },
  ],
  sortIndex: new Map([
    ["char_a", 30],
    ["char_b", 10],
    ["char_c", 20],
    ["char_d", 40],
  ]),
};

describe("roguelike operator picker data", () => {
  it("puts the theme's recommendations first, in MAA's order", () => {
    const merged = mergeRoguelikeOperators(catalogue, ["丙", "甲", "不存在的干员"]);
    expect(merged.map((entry) => entry.name)).toEqual(["丙", "甲", "乙", "丁"]);
    expect(merged.map((entry) => entry.recommended)).toEqual([true, true, false, false]);
  });

  it("falls back to rarity and the game's sort order", () => {
    const merged = mergeRoguelikeOperators(catalogue, []);
    // 6★ first, and 丙 (sortIndex 20) before 甲 (30) within that rarity.
    expect(merged.map((entry) => entry.name)).toEqual(["丙", "甲", "乙", "丁"]);
  });

  it("keeps a repeated recommendation at its first position", () => {
    const merged = mergeRoguelikeOperators(catalogue, ["乙", "乙", "甲"]);
    expect(merged.map((entry) => entry.name)).toEqual(["乙", "甲", "丙", "丁"]);
  });

  it("only builds avatar paths from plain catalogue ids", () => {
    expect(isAvatarId("char_002_amiya")).toBe(true);
    expect(isAvatarId("char-002")).toBe(false);
    expect(isAvatarId("../template/x")).toBe(false);
    expect(isAvatarId("")).toBe(false);
    expect(isAvatarId(5)).toBe(false);
    expect(avatarPath("/res", "char_002_amiya")).toBe("/res/template/avatar/char_002_amiya.png");
  });
});
