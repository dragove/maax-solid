import { describe, expect, it } from "vitest";
import type { CopilotItem } from "./schemas";
import {
  copilotItemActive,
  copilotItemEntries,
  copilotItemModes,
  copilotModeLabelKey,
  copilotModes,
  copilotStageModes,
  isCopilotItem,
  isHardStage,
  isHazardStage,
  isToughStage,
  mergeCopilotItems,
  normalizeCopilotItem,
  selectCopilotMode,
  unscheduleCopilotMode,
  withSingleMode,
} from "./copilot-mode";

const item = (patch: Partial<CopilotItem> = {}): CopilotItem => ({
  id: "a",
  copilotId: 7,
  filename: "/tmp/a.json",
  stage: "main_01-07",
  title: "1-7",
  modes: { normal: true, raid: false },
  kind: "normal",
  ...patch,
});

describe("copilot difficulty modes", () => {
  it("reads the difficulty bitmask", () => {
    expect(copilotModes(1, "act52side_ex03")).toEqual(["normal"]);
    expect(copilotModes(2, "act52side_ex03")).toEqual(["raid"]);
    expect(copilotModes(3, "act52side_ex03")).toEqual(["normal", "raid"]);
  });

  it("offers both modes when the site leaves difficulty unset", () => {
    expect(copilotModes(0, "main_16-04")).toEqual(["normal", "raid"]);
  });

  it("treats a tough stage as raid regardless of the mask", () => {
    expect(isToughStage("tough_12-16")).toBe(true);
    expect(isToughStage("", "12-18（磨难）")).toBe(true);
    expect(isToughStage("main_12-18")).toBe(false);
    expect(copilotModes(0, "tough_12-16")).toEqual(["raid"]);
    expect(copilotModes(3, "tough_12-16")).toEqual(["raid"]);
  });

  it("never offers raid on an H stage", () => {
    expect(isHardStage("hard_17-04", "H17-4（标准）")).toBe(true);
    expect(isHardStage("", "H9-5")).toBe(true);
    expect(isHardStage("main_01-07")).toBe(false);
    expect(copilotStageModes("hard_17-04")).toEqual(["normal"]);
    expect(copilotStageModes("H17-4（标准）")).toEqual(["normal"]);
    expect(copilotStageModes("tough_12-16")).toEqual(["raid"]);
    expect(copilotStageModes("main_01-07")).toEqual(["normal", "raid"]);
    expect(copilotModes(3, "hard_17-04", "H17-4（标准）")).toEqual(["normal"]);
  });

  it("labels the hard bit by stage family", () => {
    expect(copilotModeLabelKey(false, "tough_12-16")).toBe("copilot.normal");
    expect(copilotModeLabelKey(true, "tough_12-16")).toBe("copilot.tough");
    expect(copilotModeLabelKey(true, "12-18（磨难）")).toBe("copilot.tough");
    expect(copilotModeLabelKey(true, "act52side_ex03")).toBe("copilot.raid");
  });

  it("calls the chapter 15+ hard mode 险地", () => {
    expect(isHazardStage("main_15-01")).toBe(true);
    expect(isHazardStage("main_17-07")).toBe(true);
    expect(isHazardStage("main_14-01")).toBe(false);
    expect(isHazardStage("act52side_ex03")).toBe(false);
    expect(isHazardStage("17-8")).toBe(true);
    expect(isHazardStage("17-8（标准）")).toBe(true);
    expect(isHazardStage("12-18（磨难）")).toBe(false);
    expect(copilotModeLabelKey(true, "main_17-07")).toBe("copilot.hazard");
    expect(copilotModeLabelKey(true, "main_17-07#s")).toBe("copilot.hazard");
    expect(copilotModeLabelKey(true, "17-8（标准）")).toBe("copilot.hazard");
  });
});

describe("batch row difficulties", () => {
  it("folds the retired single-mode shape into a selection", () => {
    expect(copilotItemModes(item({ modes: undefined, isRaid: false }))).toEqual({ normal: true, raid: false });
    expect(copilotItemModes(item({ modes: undefined, isRaid: true }))).toEqual({ normal: false, raid: true });
    expect(copilotItemModes(item({ modes: undefined, isRaid: false, enabled: false }))).toEqual({
      normal: false,
      raid: false,
    });
  });

  it("lets the stage cap the selection", () => {
    expect(copilotItemModes(item({ stage: "tough_12-16", modes: { normal: true, raid: false } }))).toEqual({
      normal: false,
      raid: false,
    });
    expect(copilotItemModes(item({ stage: "H17-4（标准）", modes: { normal: false, raid: true } }))).toEqual({
      normal: false,
      raid: false,
    });
    expect(copilotItemModes(item({ stage: "H17-4（标准）", modes: { normal: true, raid: true } }))).toEqual({
      normal: true,
      raid: false,
    });
  });

  it("skips a row with neither difficulty", () => {
    expect(copilotItemActive(item({ modes: { normal: false, raid: false } }))).toBe(false);
    expect(copilotItemActive(item({ modes: { normal: false, raid: true } }))).toBe(true);
    expect(copilotItemActive(item({ kind: "sss", stage: "lt_21_01" }))).toBe(true);
    expect(copilotItemActive(item({ kind: "sss", stage: "lt_21_01", enabled: false }))).toBe(false);
  });

  it("expands one row into one MaaCore entry per checked difficulty", () => {
    expect(copilotItemEntries([item({ modes: { normal: true, raid: true } })]).map((entry) => entry.mode)).toEqual([
      "normal",
      "raid",
    ]);
    expect(copilotItemEntries([item({ modes: { normal: false, raid: false } })])).toEqual([]);
    expect(
      copilotItemEntries([item({ kind: "sss", stage: "lt_21_01", modes: undefined })]).map((entry) => entry.mode),
    ).toEqual(["normal"]);
  });

  it("unchecks one difficulty without losing the other", () => {
    const retired = unscheduleCopilotMode(item({ modes: { normal: true, raid: true } }), "normal");
    expect(retired.modes).toEqual({ normal: false, raid: true });
    expect(unscheduleCopilotMode(item({ kind: "sss", stage: "lt_21_01" }), "normal").enabled).toBe(false);
  });

  it("gives a retired single-run target one runnable difficulty", () => {
    expect(withSingleMode(item({ modes: { normal: false, raid: false } })).modes).toEqual({
      normal: true,
      raid: false,
    });
    expect(withSingleMode(item({ stage: "tough_12-16", modes: { normal: false, raid: false } })).modes).toEqual({
      normal: false,
      raid: true,
    });
    expect(withSingleMode(item({ stage: "H17-4（标准）", modes: { normal: false, raid: false } })).modes).toEqual({
      normal: true,
      raid: false,
    });
    expect(withSingleMode(item({ modes: { normal: true, raid: true } })).modes).toEqual({ normal: true, raid: false });
  });
});

describe("merging downloaded assignments", () => {
  it("checks the other difficulty instead of appending a second row", () => {
    const merged = mergeCopilotItems([item()], [item({ id: "b", modes: { normal: false, raid: true } })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("a");
    expect(merged[0]!.modes).toEqual({ normal: true, raid: true });
  });

  it("keeps the order of a newly added set and drops duplicates", () => {
    const merged = mergeCopilotItems(
      [],
      [
        item({ id: "x", copilotId: 1, filename: "/tmp/1.json" }),
        item({ id: "y", copilotId: 2, filename: "/tmp/2.json" }),
        item({ id: "z", copilotId: 1, filename: "/tmp/1.json", modes: { normal: false, raid: true } }),
      ],
    );
    expect(merged.map((row) => row.id)).toEqual(["x", "y"]);
    expect(merged[0]!.modes).toEqual({ normal: true, raid: true });
  });

  it("matches local files by path because they carry no PRTS id", () => {
    const local = item({ id: "l", copilotId: 0, filename: "/tmp/local.json" });
    expect(mergeCopilotItems([local], [{ ...local, id: "m" }])).toHaveLength(1);
  });
});

describe("copilot mode selection", () => {
  it("keeps only the requested difficulty", () => {
    expect(selectCopilotMode([item({ modes: { normal: true, raid: true } })], "normal")[0]!.modes).toEqual({
      normal: true,
      raid: false,
    });
    expect(selectCopilotMode([item()], "raid")[0]!.modes).toEqual({ normal: false, raid: true });
  });

  it("never flips or drops SSS and paradox entries", () => {
    const sss = item({ kind: "sss", stage: "lt_21_01", modes: undefined });
    expect(selectCopilotMode([sss], "raid")).toEqual([sss]);
  });
});

describe("normalisation", () => {
  it("drops the retired fields", () => {
    expect(normalizeCopilotItem(item({ modes: undefined, isRaid: true, enabled: false }))).toEqual({
      id: "a",
      copilotId: 7,
      filename: "/tmp/a.json",
      stage: "main_01-07",
      title: "1-7",
      kind: "normal",
      modes: { normal: false, raid: false },
    });
  });
});

describe("saved copilot entries", () => {
  it("accepts both shapes and rejects partial params", () => {
    expect(isCopilotItem(item())).toBe(true);
    expect(isCopilotItem(item({ modes: undefined, isRaid: false }))).toBe(true);
    expect(isCopilotItem({ ...item(), isRaid: undefined, modes: undefined })).toBe(false);
    expect(isCopilotItem({ id: "a", filename: "/tmp/a.json" })).toBe(false);
    expect(isCopilotItem(null)).toBe(false);
  });
});
