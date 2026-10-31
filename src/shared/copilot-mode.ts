import type { CopilotItem } from "./schemas";

/**
 * The one hard-mode switch MaaCore has for a normal-stage assignment.
 *
 * The game names that mode by stage family — 突袭 for side stories, 磨难 for
 * main story chapters 10–14, 险地 from chapter 15 on — but the core only sees
 * `is_raid`, so both difficulties stay two entries that differ in that flag.
 */
export type CopilotMode = "normal" | "raid";

/** Which difficulties one batch row will attempt; both may be checked. */
export interface CopilotModeSelection {
  readonly normal: boolean;
  readonly raid: boolean;
}

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
 * Main story hard stages (H1-1 … H17-4) are their own difficulty. The game has
 * no 突袭/磨难 run of them, so the catalogue code starting with H — or the
 * `hard_` stage id — means only 普通 can be selected.
 */
export const isHardStage = (stageId: string, stageCode = ""): boolean =>
  stageId.startsWith("hard_") || /^H\d+-\d+/iu.test(stageId) || /^H\d+-\d+/iu.test(stageCode);

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

/** Which difficulty bits this stage actually has. */
export const copilotStageModes = (stageId: string, stageCode = ""): ReadonlyArray<CopilotMode> => {
  if (isToughStage(stageId, stageCode)) return ["raid"];
  if (isHardStage(stageId, stageCode)) return ["normal"];
  return ["normal", "raid"];
};

/**
 * Which difficulty entries a search result can produce.
 *
 * `difficulty` is a bitmask: 1 normal, 2 raid, 3 both, 0 unset. An unset mask
 * offers both modes because the site does not mark 险地/磨难 uploads; the user
 * picks explicitly. Tough and H stages override the mask: those maps only have
 * one difficulty in the game.
 */
export const copilotModes = (difficulty: number, stageId: string, stageCode = ""): ReadonlyArray<CopilotMode> => {
  const available = copilotStageModes(stageId, stageCode);
  if (available.length === 1) return available;
  if (difficulty === 0) return available;
  const modes: CopilotMode[] = [];
  if ((difficulty & 1) !== 0) modes.push("normal");
  if ((difficulty & 2) !== 0) modes.push("raid");
  return modes.length === 0 ? ["normal"] : modes;
};

/**
 * The difficulties a batch row has checked.
 *
 * Batches saved before the two checkboxes existed carry one `isRaid` flag plus
 * an enable switch; that shape is read here and folded into a selection. The
 * stage always wins: a 磨难 map cannot run as normal, an H map cannot run as
 * raid.
 */
export const copilotItemModes = (
  item: Pick<CopilotItem, "modes" | "isRaid" | "enabled" | "kind" | "stage">,
): CopilotModeSelection => {
  if ((item.kind ?? "normal") !== "normal") return { normal: false, raid: false };
  const available = copilotStageModes(item.stage);
  if (item.modes === undefined) {
    // The retired shape only knew one bit, and a 磨难 map saved with the wrong
    // one still belongs on the hard map. The stage decides when it has one bit.
    const active = item.enabled !== false;
    if (available.length === 1) {
      return { normal: active && available[0] === "normal", raid: active && available[0] === "raid" };
    }
    if (!active) return { normal: false, raid: false };
    return item.isRaid === true ? { normal: false, raid: true } : { normal: true, raid: false };
  }
  return {
    normal: available.includes("normal") && item.modes.normal,
    raid: available.includes("raid") && item.modes.raid,
  };
};

/** A row runs only while at least one difficulty is checked. */
export const copilotItemActive = (item: CopilotItem): boolean => {
  if ((item.kind ?? "normal") !== "normal") return item.enabled !== false;
  const modes = copilotItemModes(item);
  return modes.normal || modes.raid;
};

/**
 * Drop the retired shape so every reader sees one model.
 *
 * Only normal assignments are rewritten: SSS and paradox rows keep the plain
 * `enabled` switch, and their `modes` field is meaningless.
 */
export const normalizeCopilotItem = (item: CopilotItem): CopilotItem => {
  if ((item.kind ?? "normal") !== "normal") return item;
  return {
    id: item.id,
    copilotId: item.copilotId,
    filename: item.filename,
    stage: item.stage,
    title: item.title,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    modes: copilotItemModes(item),
  };
};

/**
 * Read the entries of a saved `copilot_list` parameter. Plan params are not
 * schema-decoded, so this both guards the shape and normalises legacy rows; an
 * old normal+raid entry pair folds into one row with both boxes.
 */
export const readCopilotBatch = (value: unknown): ReadonlyArray<CopilotItem> =>
  Array.isArray(value) ? mergeCopilotItems([], value.filter(isCopilotItem)) : [];

/** Fold an off-switch for one difficulty of a batch row. */
export const unscheduleCopilotMode = (item: CopilotItem, mode: CopilotMode): CopilotItem => {
  if ((item.kind ?? "normal") !== "normal") return { ...item, enabled: false };
  const normalized = normalizeCopilotItem(item);
  return { ...normalized, modes: { ...copilotItemModes(normalized), [mode]: false } };
};

/**
 * A single run is one MaaCore file with no batch list, so it also retires one
 * difficulty. Prefer the first checked box, then whatever the stage has; a row
 * that is skipped entirely still runs, because the single-run button overrides
 * the checkboxes.
 */
export const withSingleMode = (item: CopilotItem): CopilotItem => {
  const normalized = normalizeCopilotItem(item);
  if ((normalized.kind ?? "normal") !== "normal") return normalized;
  const modes = copilotItemModes(normalized);
  const mode: CopilotMode = modes.normal
    ? "normal"
    : modes.raid
      ? "raid"
      : (copilotStageModes(normalized.stage)[0] ?? "normal");
  return { ...normalized, modes: { normal: mode === "normal", raid: mode === "raid" } };
};

/**
 * A MaaCore `copilot_list` entry: one file plus the difficulty it runs in.
 *
 * Normal assignments produce one entry per checked difficulty; SSS and paradox
 * files are one entry each and never carry the raid bit.
 */
export interface CopilotRunEntry {
  readonly item: CopilotItem;
  readonly mode: CopilotMode;
}

/** Expand the batch rows into the entries MaaCore actually runs. */
export const copilotItemEntries = (items: ReadonlyArray<CopilotItem>): ReadonlyArray<CopilotRunEntry> =>
  items.flatMap((raw) => {
    const item = normalizeCopilotItem(raw);
    if ((item.kind ?? "normal") !== "normal") {
      return item.enabled === false ? [] : [{ item, mode: "normal" as const }];
    }
    const modes = copilotItemModes(item);
    const entries: CopilotRunEntry[] = [];
    if (modes.normal) entries.push({ item, mode: "normal" });
    if (modes.raid) entries.push({ item, mode: "raid" });
    return entries;
  });

const copilotItemKey = (item: CopilotItem): string =>
  item.copilotId > 0 ? `prts:${item.copilotId}` : `file:${item.filename}`;

/**
 * Fold a downloaded assignment or set into the batch.
 *
 * One row owns one file: adding the same PRTS assignment in the other
 * difficulty must check that bit instead of appending a second row, and adding
 * a set twice must not duplicate anything.
 */
export const mergeCopilotItems = (
  current: ReadonlyArray<CopilotItem>,
  incoming: ReadonlyArray<CopilotItem>,
): ReadonlyArray<CopilotItem> => {
  const rows = current.map(normalizeCopilotItem);
  for (const raw of incoming) {
    const item = normalizeCopilotItem(raw);
    const index = rows.findIndex((row) => copilotItemKey(row) === copilotItemKey(item));
    const existing = rows[index];
    if (existing === undefined) {
      rows.push(item);
      continue;
    }
    if ((existing.kind ?? "normal") !== "normal" || (item.kind ?? "normal") !== "normal") {
      rows[index] = item;
      continue;
    }
    const before = copilotItemModes(existing);
    const after = copilotItemModes(item);
    rows[index] = { ...existing, modes: { normal: before.normal || after.normal, raid: before.raid || after.raid } };
  }
  return rows;
};

/** Keep only the difficulty the user asked for when adding a search result. */
export const selectCopilotMode = (items: ReadonlyArray<CopilotItem>, mode: CopilotMode): ReadonlyArray<CopilotItem> =>
  items.map((raw) => {
    const item = normalizeCopilotItem(raw);
    if ((item.kind ?? "normal") !== "normal") return item;
    const available = copilotStageModes(item.stage);
    return {
      ...item,
      modes: {
        normal: available.includes("normal") && mode === "normal",
        raid: available.includes("raid") && mode === "raid",
      },
    };
  });

/** Saved task params are not schema-decoded; keep a batch to real entries. */
export const isCopilotItem = (value: unknown): value is CopilotItem => {
  const item = value as Partial<CopilotItem> | null;
  if (typeof item?.id !== "string" || typeof item.filename !== "string" || typeof item.stage !== "string") {
    return false;
  }
  if (typeof item.copilotId !== "number" || typeof item.title !== "string") return false;
  if (item.modes !== undefined) return typeof item.modes.normal === "boolean" && typeof item.modes.raid === "boolean";
  return typeof item.isRaid === "boolean";
};

export type CopilotModeLabelKey = "copilot.normal" | "copilot.raid" | "copilot.tough" | "copilot.hazard";

/** Label the hard bit by the stage family the batch list is showing. */
export const copilotModeLabelKey = (isRaid: boolean, stage: string): CopilotModeLabelKey => {
  if (!isRaid) return "copilot.normal";
  if (isToughStage(stage)) return "copilot.tough";
  return isHazardStage(stage) ? "copilot.hazard" : "copilot.raid";
};
