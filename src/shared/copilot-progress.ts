import type { CopilotItem, CopilotKind } from "./schemas";

/**
 * Which assignments a MaaCore callback proves were completed.
 *
 * Normal assignments share one `Copilot` task: a chain error leaves the
 * currently loaded file (and everything after it) unfinished, so only the
 * entries before `lastLoaded` are safe to retire. SSS and Paradox run one task
 * per file, so a completed task retires exactly the file it carried.
 */
export type CopilotRunOutcome = "completed" | "failed";

export const copilotSucceededItems = (
  items: ReadonlyArray<CopilotItem>,
  kind: CopilotKind,
  outcome: CopilotRunOutcome,
  lastLoaded: number,
  taskIndex: number,
): ReadonlyArray<CopilotItem> => {
  if (outcome === "failed") {
    if (kind !== "normal") return [];
    return items.slice(0, Math.max(0, lastLoaded));
  }
  if (kind === "normal") return items;
  const item = items[taskIndex];
  return item === undefined ? [] : [item];
};
