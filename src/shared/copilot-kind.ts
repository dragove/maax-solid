import type { CopilotKind } from "./schemas";

/**
 * Copilot files share one JSON shape but not one MaaCore task. The stage id in
 * the level catalogue is the reliable discriminator: Paradox simulations live
 * under `mem_` and Stationary Security Service maps under `lt_`; everything
 * else is a normal stage or side story.
 *
 * The SSS protocol also carries `type: "SSS"`, which wins when the catalogue
 * lookup fails (for example an assignment for a brand-new map).
 */
export const copilotKindFromStageId = (stageId: string | undefined): CopilotKind => {
  if (stageId?.startsWith("mem_") === true) return "paradox";
  if (stageId?.startsWith("lt_") === true) return "sss";
  return "normal";
};

export const copilotKindFromContent = (type: unknown, stageId?: string): CopilotKind =>
  type === "SSS" ? "sss" : copilotKindFromStageId(stageId);
