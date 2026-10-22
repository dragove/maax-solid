import { describe, expect, it } from "vitest";
import { parseDepotDetails, parseOperBoxDetails } from "./tools";

describe("tool callback parsers", () => {
  it("merges OperBox names with owned details", () => {
    const snapshot = parseOperBoxDetails(
      {
        done: true,
        all_opers: [
          { id: "c1", name: "阿米娅", name_en: "Amiya", rarity: 5, own: true },
          { id: "c2", name: "芬", name_en: "Fang", rarity: 3, own: false },
        ],
        own_opers: [{ id: "c1", name: "阿米娅", own: true, elite: 2, level: 60, potential: 6, rarity: 5 }],
      },
      1_000,
    );
    expect(snapshot).toMatchObject({ done: true, updatedAt: 1_000 });
    expect(snapshot?.entries).toEqual([
      { id: "c1", name: "阿米娅", nameEn: "Amiya", rarity: 5, own: true, elite: 2, level: 60, potential: 6 },
    ]);
  });

  it("falls back to all_opers for cores that only flag ownership", () => {
    const snapshot = parseOperBoxDetails({
      done: false,
      all_opers: [
        { id: "c1", name: "阿米娅", name_en: "Amiya", rarity: 5, own: true },
        { id: "c2", name: "芬", name_en: "Fang", rarity: 3, own: false },
      ],
    });
    expect(snapshot?.entries.map((entry) => entry.id)).toEqual(["c1"]);
    expect(snapshot?.done).toBe(false);
  });

  it("sorts owned operators by rarity then localized name", () => {
    const snapshot = parseOperBoxDetails({
      done: true,
      own_opers: [
        { id: "a", name: "B", own: true, rarity: 4 },
        { id: "b", name: "A", own: true, rarity: 4 },
        { id: "c", name: "C", own: true, rarity: 6 },
      ],
    });
    expect(snapshot?.entries.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });

  it("parses Depot's string payload, joins item names and skips zero counts", () => {
    const snapshot = parseDepotDetails(
      { done: true, data: JSON.stringify({ 2001: 12, 30011: 0, 9999: "3" }) },
      {
        2001: { name: "基础作战记录", classifyType: "MATERIAL" },
        30011: { name: "代币", classifyType: "MATERIAL" },
      },
      2_000,
    );
    expect(snapshot).toMatchObject({ done: true, updatedAt: 2_000 });
    expect(snapshot?.items).toEqual([
      { itemId: "2001", name: "基础作战记录", count: 12, group: "MATERIAL" },
      { itemId: "9999", name: "#9999", count: 3, group: "UNKNOWN" },
    ]);
  });

  it("ignores malformed callbacks", () => {
    expect(parseOperBoxDetails(null)).toBeUndefined();
    expect(parseDepotDetails({ data: "not-json" }, {})).toBeUndefined();
  });
});
