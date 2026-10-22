import { describe, expect, it } from "vitest";
import { copilotKindFromContent, copilotKindFromStageId } from "./copilot-kind";

describe("copilot kind detection", () => {
  it("uses the level id prefixes", () => {
    expect(copilotKindFromStageId("main_01-07")).toBe("normal");
    expect(copilotKindFromStageId("lt_21_01")).toBe("sss");
    expect(copilotKindFromStageId("mem_yu_1")).toBe("paradox");
    expect(copilotKindFromStageId(undefined)).toBe("normal");
  });

  it("honours the SSS protocol marker over a missing catalogue entry", () => {
    expect(copilotKindFromContent("SSS")).toBe("sss");
    expect(copilotKindFromContent("SSS", "main_01-07")).toBe("sss");
    expect(copilotKindFromContent(undefined, "mem_yu_1")).toBe("paradox");
    expect(copilotKindFromContent(undefined, "lt_21_01")).toBe("sss");
    expect(copilotKindFromContent(undefined)).toBe("normal");
  });
});
