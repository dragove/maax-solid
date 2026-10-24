import type { CopilotItem } from "./schemas";

/**
 * The one hard-mode switch MaaCore has for a normal-stage assignment.
 *
 * The game names that mode by stage family — 突袭 for side stories, 磨难 for
 * main story chapters 10-14, 险地 from chapter 15 on — but the core only sees
 * `is_raid`, so both difficulties stay two entries that differ in that flag.
 */
export type CopilotMode = "normal" | "raid";

/**
 * The copilot site leaves `difficulty` unset on most main story uploads, so a
 * `tough_` stage id (or a display code carrying 磨难) is the reliable signal
 * that the file is a 磨难 run. Treating it as normal would send the core to the
 * standard stage and fail.
 *
 * MaaCore has no 沙盘推演 switch: its raid task selects 突袭/磨难/险地 and the
 * sandbox assumptions are a separate in-game choice, so there is no third mode.
 */
export const isToughStage = (stageId: string, stageCode = ""): boolean =>
  stageId.startsWith("tough_") || stageCode.includes("磨难") || stageId.includes("磨难");

/**
 * Chapters 15 and later call the hard mode 险地 instead of 突袭/磨难.
 *
 * Saved batch entries carry the catalogue's display code (17-8（标准）), while
 * search results and the SSS protocol use the internal id (main_17-07); both
 * must reach the same label.
 */
export const isHazardStage = (stageId: string): boolean => {
  const match = /^(?:main_)?(\d{2})-\d+/u.exec(stageId);
  return match !== null && Number(match[1]) >= 15;
};

/**
 * Which difficulty entries an assignment can produce.
 *
 * `difficulty` is a bitmask: 1 normal, 2 raid, 3 both, 0 unset. An unset mask
 * offers both modes because the site does not mark 险地/磨难 uploads; the user
 * picks explicitly, which is the same choice MAA exposes by adding an entry as
 * normal or as raid.
 */
export const copilotModes = (difficulty: number, stageId: string): ReadonlyArray<CopilotMode> => {
  if (isToughStage(stageId)) return ["raid"];
  if (difficulty === 0) return ["normal", "raid"];
  const modes: CopilotMode[] = [];
  if ((difficulty & 1) !== 0) modes.push("normal");
  if ((difficulty & 2) !== 0) modes.push("raid");
  return modes.length === 0 ? ["normal"] : modes;
};

/** Force the core's raid switch on the entries a resolve produced. */
export const withCopilotMode = (items: ReadonlyArray<CopilotItem>, mode: CopilotMode): ReadonlyArray<CopilotItem> =>
  items.map((item) => ((item.kind ?? "normal") === "normal" ? { ...item, isRaid: mode === "raid" } : item));

/**
 * Pick the entries for one requested difficulty.
 *
 * A file that declares both difficulties resolves to two entries; keep the one
 * the user asked for. A file that never declared the mode still gets one entry
 * flipped to it — MAA allows a raid run of any file, and main story uploads
 * carry no mask at all.
 */
export const selectCopilotMode = (items: ReadonlyArray<CopilotItem>, mode: CopilotMode): ReadonlyArray<CopilotItem> => {
  const matched = items.filter((item) => (item.kind ?? "normal") !== "normal" || item.isRaid === (mode === "raid"));
  if (matched.length > 0) return matched;
  return withCopilotMode(
    items.filter((item) => (item.kind ?? "normal") === "normal"),
    mode,
  );
};

/**
 * The mode a batch entry will actually run in. A 磨难 entry saved before the
 * stage check existed still has `isRaid: false`; the stage code keeps the UI
 * honest (and `buildMaaTaskParams` forces the core switch for it).
 */
export const copilotEntryMode = (entry: Pick<CopilotItem, "isRaid" | "stage" | "kind">): CopilotMode =>
  (entry.kind ?? "normal") !== "normal" ? "normal" : entry.isRaid || isToughStage(entry.stage) ? "raid" : "normal";

/** Saved task params are not schema-decoded; keep a batch to real entries. */
export const isCopilotItem = (value: unknown): value is CopilotItem => {
  const item = value as Partial<CopilotItem> | null;
  return (
    typeof item?.id === "string" &&
    typeof item.filename === "string" &&
    typeof item.isRaid === "boolean" &&
    typeof item.stage === "string"
  );
};

export type CopilotModeLabelKey = "copilot.normal" | "copilot.raid" | "copilot.tough" | "copilot.hazard";

/** Label the hard bit by the stage family the batch list is showing. */
export const copilotModeLabelKey = (isRaid: boolean, stage: string): CopilotModeLabelKey => {
  if (!isRaid) return "copilot.normal";
  if (isToughStage(stage)) return "copilot.tough";
  return isHazardStage(stage) ? "copilot.hazard" : "copilot.raid";
};
