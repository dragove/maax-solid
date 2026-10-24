import { describe, expect, it } from "vitest";
import type { CopilotItem } from "./schemas";
import {
  copilotEntryMode,
  copilotModeLabelKey,
  copilotModes,
  isCopilotItem,
  isHazardStage,
  isToughStage,
  selectCopilotMode,
  withCopilotMode,
} from "./copilot-mode";

const item = (patch: Partial<CopilotItem> = {}): CopilotItem => ({
  id: "a",
  copilotId: 7,
  filename: "/tmp/a.json",
  stage: "main_01-07",
  title: "1-7",
  isRaid: false,
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

  it("reads a saved tough entry as raid even when its flag is stale", () => {
    expect(copilotEntryMode(item({ isRaid: false, stage: "tough_12-16" }))).toBe("raid");
    expect(copilotEntryMode(item({ isRaid: false, stage: "12-18（磨难）" }))).toBe("raid");
    expect(copilotEntryMode(item({ isRaid: false, stage: "main_01-07" }))).toBe("normal");
    expect(copilotEntryMode(item({ isRaid: true, stage: "act52side_ex03" }))).toBe("raid");
    expect(copilotEntryMode(item({ kind: "sss", isRaid: false, stage: "lt_21_01" }))).toBe("normal");
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

describe("copilot mode selection", () => {
  it("keeps the entry the user asked for", () => {
    const both = [item(), item({ id: "b", isRaid: true })];
    expect(selectCopilotMode(both, "normal").map((entry) => entry.isRaid)).toEqual([false]);
    expect(selectCopilotMode(both, "raid").map((entry) => entry.isRaid)).toEqual([true]);
  });

  it("flips a file that does not declare the requested mode", () => {
    expect(selectCopilotMode([item()], "raid")[0]!.isRaid).toBe(true);
    expect(selectCopilotMode([item({ isRaid: true })], "normal")[0]!.isRaid).toBe(false);
  });

  it("never flips or drops SSS and paradox entries", () => {
    const sss = item({ kind: "sss", isRaid: false });
    expect(withCopilotMode([sss], "raid")[0]!.isRaid).toBe(false);
    expect(selectCopilotMode([sss], "normal")).toEqual([sss]);
  });
});

describe("saved copilot entries", () => {
  it("accepts a complete entry and rejects partial params", () => {
    expect(isCopilotItem(item())).toBe(true);
    expect(isCopilotItem({ ...item(), isRaid: undefined })).toBe(false);
    expect(isCopilotItem({ id: "a", filename: "/tmp/a.json" })).toBe(false);
    expect(isCopilotItem(null)).toBe(false);
  });
});
