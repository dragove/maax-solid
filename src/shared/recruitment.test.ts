import { describe, expect, it } from "vitest";
import { matchRecruitment, recruitmentTagLabel } from "./recruitment";
import type { RecruitmentOperator } from "./schemas";

const operators: ReadonlyArray<RecruitmentOperator> = [
  { id: "a", name: "甲", nameEn: "Alpha", rarity: 3, tags: ["输出", "近战位", "近卫干员"] },
  { id: "b", name: "乙", nameEn: "Beta", rarity: 4, tags: ["输出", "近战位", "重装干员"] },
  { id: "c", name: "丙", nameEn: "Gamma", rarity: 5, tags: ["输出", "近战位", "资深干员"] },
  { id: "d", name: "丁", nameEn: "Delta", rarity: 6, tags: ["高级资深干员", "输出"] },
];

describe("recruitment calculator", () => {
  it("returns nothing until a tag is selected", () => {
    expect(matchRecruitment([], operators).empty).toBe(true);
  });

  it("requires every selected tag", () => {
    const match = matchRecruitment(["输出", "近战位"], operators);
    expect(match.candidates.map((operator) => operator.id)).toEqual(["c", "b", "a"]);
    expect(match.guaranteedRarity).toBe(3);
    expect(match.topRarity).toBe(5);
    expect(match.rarityCounts).toEqual([
      { rarity: 5, count: 1 },
      { rarity: 4, count: 1 },
      { rarity: 3, count: 1 },
    ]);
  });

  it("treats the senior tags as guarantees rather than the lowest match", () => {
    expect(matchRecruitment(["资深干员"], operators).guaranteedRarity).toBe(5);
    expect(matchRecruitment(["高级资深干员"], operators).guaranteedRarity).toBe(6);
  });

  it("reports no match for an impossible combination", () => {
    const match = matchRecruitment(["高级资深干员", "近战位"], operators);
    expect(match.empty).toBe(true);
    expect(match.candidates).toEqual([]);
  });

  it("localizes known tags and falls back to the core name", () => {
    expect(recruitmentTagLabel("输出", "en-US")).toBe("DPS");
    expect(recruitmentTagLabel("输出", "zh-CN")).toBe("输出");
    expect(recruitmentTagLabel("未知标签", "en-US")).toBe("未知标签");
  });
});
