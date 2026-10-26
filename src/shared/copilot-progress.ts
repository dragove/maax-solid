import { copilotItemEntries, type CopilotRunEntry } from "./copilot-mode";
import type { CopilotItem, CopilotKind } from "./schemas";

/**
 * Which assignments a MaaCore callback proves were completed.
 *
 * Normal assignments share one `Copilot` task, and each checked difficulty is
 * its own `copilot_list` entry, so `lastLoaded` indexes the expanded list
 * rather than the rows the UI shows. A chain error leaves the currently loaded
 * entry (and everything after it) unfinished, so only the entries before
 * `lastLoaded` are safe to retire. SSS and Paradox run one task per file, so a
 * completed task retires exactly the file it carried.
 */
export type CopilotRunOutcome = "completed" | "failed";

export const copilotSucceededEntries = (
  items: ReadonlyArray<CopilotItem>,
  kind: CopilotKind,
  outcome: CopilotRunOutcome,
  lastLoaded: number,
  taskIndex: number,
): ReadonlyArray<CopilotRunEntry> => {
  const entries = copilotItemEntries(items);
  if (outcome === "failed") {
    if (kind !== "normal") return [];
    return entries.slice(0, Math.max(0, lastLoaded));
  }
  if (kind === "normal") return entries;
  const entry = entries[taskIndex];
  return entry === undefined ? [] : [entry];
};
