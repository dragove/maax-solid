import { describe, expect, it } from "vitest";
import { copilotSucceededEntries } from "./copilot-progress";
import type { CopilotItem } from "./schemas";

const item = (id: string, patch: Partial<CopilotItem> = {}): CopilotItem => ({
  id,
  copilotId: 1,
  filename: `/tmp/${id}.json`,
  stage: "main_17-07",
  title: id,
  modes: { normal: true, raid: false },
  kind: "normal",
  ...patch,
});

describe("copilot run outcomes", () => {
  const items = [item("a"), item("b"), item("c")];

  it("retires the whole batch only when the chain completed", () => {
    expect(copilotSucceededEntries(items, "normal", "completed", 2, 0).map((entry) => entry.item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps the failed file and everything after it when a batch fails", () => {
    expect(copilotSucceededEntries(items, "normal", "failed", 2, 0).map((entry) => entry.item.id)).toEqual(["a", "b"]);
    expect(copilotSucceededEntries(items, "normal", "failed", 0, 0)).toEqual([]);
    expect(copilotSucceededEntries(items, "normal", "failed", -1, 0)).toEqual([]);
  });

  it("retires one task's file for SSS and paradox", () => {
    expect(copilotSucceededEntries(items, "sss", "completed", -1, 1).map((entry) => entry.item.id)).toEqual(["b"]);
    expect(copilotSucceededEntries(items, "paradox", "completed", -1, 2).map((entry) => entry.item.id)).toEqual(["c"]);
  });

  it("does not retire anything for a failed sequential task", () => {
    expect(copilotSucceededEntries(items, "sss", "failed", 1, 1)).toEqual([]);
  });

  it("maps the core's index onto the expanded difficulty list", () => {
    const both = item("both", { modes: { normal: true, raid: true } });
    const entries = copilotSucceededEntries([both, item("next")], "normal", "failed", 1, 0);
    expect(entries.map((entry) => entry.mode)).toEqual(["normal"]);
    expect(entries.map((entry) => entry.item.id)).toEqual(["both"]);
  });

  it("retires both difficulties of a completed row", () => {
    const both = item("both", { modes: { normal: true, raid: true } });
    expect(copilotSucceededEntries([both], "normal", "completed", 1, 0).map((entry) => entry.mode)).toEqual([
      "normal",
      "raid",
    ]);
  });
});
