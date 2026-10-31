import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoguelikeOperator } from "../../shared/schemas";
import { ROGUELIKE_THEMES } from "../../shared/tasks";
import type { OperatorCatalogueData } from "./operator-catalog";

/**
 * Starting-operator suggestions and avatars for the Roguelike form.
 *
 * The recommendation list comes from MaaCore's
 * `resource/roguelike/<theme>/recruitment.json`: entries flagged `is_start`,
 * in MAA's own priority order. It is a suggestion only — the core accepts any
 * Chinese operator name — so a failed read must leave the form usable.
 */
export const parseStartingOperators = (raw: unknown): ReadonlyArray<string> => {
  const priority = (raw as { priority?: unknown } | null | undefined)?.priority;
  if (!Array.isArray(priority)) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const group of priority) {
    const opers = (group as { opers?: unknown } | null | undefined)?.opers;
    if (!Array.isArray(opers)) continue;
    for (const oper of opers) {
      if (typeof oper !== "object" || oper === null) continue;
      const record = oper as { name?: unknown; is_start?: unknown };
      if (record.is_start !== true || typeof record.name !== "string") continue;
      const name = record.name.trim();
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
};

/** Read one theme's suggestion list; an unknown theme or a missing file is empty. */
export const readStartingOperators = async (resourceRoot: string, theme: string): Promise<ReadonlyArray<string>> => {
  if (!ROGUELIKE_THEMES.includes(theme)) return [];
  const file = join(resourceRoot, "roguelike", theme, "recruitment.json");
  const text = await readFile(file, "utf8");
  return parseStartingOperators(JSON.parse(text) as unknown);
};

/**
 * Mark the catalogue with the theme's recommendations and order it for the
 * picker: recommended first in MAA's order, then the rest by rarity and the
 * game's own sort index. Names the catalogue does not know are dropped, because
 * they could never be picked from a list that only shows catalogue entries.
 */
export const mergeRoguelikeOperators = (
  data: OperatorCatalogueData,
  recommended: ReadonlyArray<string>,
): ReadonlyArray<RoguelikeOperator> => {
  const rank = new Map<string, number>();
  for (const name of recommended) {
    if (!rank.has(name)) rank.set(name, rank.size);
  }
  const entries: RoguelikeOperator[] = data.entries.map((entry) => ({ ...entry, recommended: rank.has(entry.name) }));
  entries.sort((left, right) => {
    const leftRank = rank.get(left.name);
    const rightRank = rank.get(right.name);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    if (right.rarity !== left.rarity) return right.rarity - left.rarity;
    return (data.sortIndex.get(left.id) ?? 0) - (data.sortIndex.get(right.id) ?? 0);
  });
  return entries;
};

/** Avatar files are named by the catalogue id; anything else is not a path we build. */
const AVATAR_ID = /^[A-Za-z0-9_]{1,80}$/u;

/** One picker request never needs more than a screenful plus its matches. */
export const AVATAR_LIMIT = 200;

export const isAvatarId = (value: unknown): value is string => typeof value === "string" && AVATAR_ID.test(value);

export const avatarPath = (resourceRoot: string, id: string): string =>
  join(resourceRoot, "template", "avatar", `${id}.png`);
