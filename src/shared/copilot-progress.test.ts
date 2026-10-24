import { describe, expect, it } from "vitest";
import { copilotSucceededItems } from "./copilot-progress";
import type { CopilotItem } from "./schemas";

const item = (id: string): CopilotItem => ({
  id,
  copilotId: 1,
  filename: `/tmp/${id}.json`,
  stage: "main_17-07",
  title: id,
  isRaid: false,
  kind: "normal",
});

describe("copilot run outcomes", () => {
  const items = [item("a"), item("b"), item("c")];

  it("retires the whole batch only when the chain completed", () => {
    expect(copilotSucceededItems(items, "normal", "completed", 2, 0).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the failed file and everything after it when a batch fails", () => {
    expect(copilotSucceededItems(items, "normal", "failed", 2, 0).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(copilotSucceededItems(items, "normal", "failed", 0, 0)).toEqual([]);
    expect(copilotSucceededItems(items, "normal", "failed", -1, 0)).toEqual([]);
  });

  it("retires one task's file for SSS and paradox", () => {
    expect(copilotSucceededItems(items, "sss", "completed", -1, 1).map((entry) => entry.id)).toEqual(["b"]);
    expect(copilotSucceededItems(items, "paradox", "completed", -1, 2).map((entry) => entry.id)).toEqual(["c"]);
  });

  it("does not retire anything for a failed sequential task", () => {
    expect(copilotSucceededItems(items, "sss", "failed", 1, 1)).toEqual([]);
  });
});
