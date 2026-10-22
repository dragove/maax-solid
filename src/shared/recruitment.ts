import type { Locale, RecruitmentOperator } from "./schemas";

/**
 * Recruitment tag translations. The core stores tags in Chinese and the game's
 * own tag ids are those names, so the canonical value stays Chinese and only
 * the display label is localized.
 */
export const RECRUITMENT_TAG_EN: Readonly<Record<string, string>> = {
  位移: "Shift",
  元素: "Element",
  先锋干员: "Vanguard",
  减速: "Slow",
  削弱: "Debuff",
  医疗干员: "Medic",
  召唤: "Summon",
  女性干员: "Female",
  快速复活: "Fast-Redeploy",
  控场: "Crowd-Control",
  支援: "Support",
  支援机械: "Robot",
  新手: "Starter",
  术师干员: "Caster",
  治疗: "Healing",
  爆发: "Burst",
  特种干员: "Specialist",
  狙击干员: "Sniper",
  生存: "Survival",
  男性干员: "Male",
  群攻: "AoE",
  费用回复: "DP-Recovery",
  资深干员: "Senior Operator",
  辅助干员: "Supporter",
  输出: "DPS",
  近卫干员: "Guard",
  近战位: "Melee",
  远程位: "Ranged",
  重装干员: "Defender",
  防护: "Defense",
  高级资深干员: "Top Operator",
};

export const recruitmentTagLabel = (tag: string, locale: Locale): string =>
  locale === "en-US" ? (RECRUITMENT_TAG_EN[tag] ?? tag) : tag;

export interface RecruitmentMatch {
  /** Operators carrying every selected tag, best rarity first. */
  readonly candidates: ReadonlyArray<RecruitmentOperator>;
  /** Lowest rarity that can still appear; 0 when nothing matches. */
  readonly guaranteedRarity: number;
  readonly topRarity: number;
  readonly rarityCounts: ReadonlyArray<{ readonly rarity: number; readonly count: number }>;
  readonly empty: boolean;
}

const byRarityThenName = (a: RecruitmentOperator, b: RecruitmentOperator): number =>
  b.rarity - a.rarity || a.nameEn.localeCompare(b.nameEn) || a.id.localeCompare(b.id);

/**
 * Match a player's chosen tags against the core's recruitment table.
 *
 * The result intentionally reports the guaranteed (lowest) rarity rather than
 * only the best-looking hit: a 5-star tag combination can still drop a 3-star
 * unless every selected tag is a guarantee tag.
 */
export function matchRecruitment(
  selected: ReadonlyArray<string>,
  operators: ReadonlyArray<RecruitmentOperator>,
): RecruitmentMatch {
  if (selected.length === 0) {
    return { candidates: [], guaranteedRarity: 0, topRarity: 0, rarityCounts: [], empty: true };
  }
  const tags = [...new Set(selected)];
  const candidates = operators
    .filter((operator) => tags.every((tag) => operator.tags.includes(tag)))
    .sort(byRarityThenName);
  if (candidates.length === 0) {
    return { candidates: [], guaranteedRarity: 0, topRarity: 0, rarityCounts: [], empty: true };
  }

  const guaranteed = tags.includes("高级资深干员")
    ? 6
    : tags.includes("资深干员")
      ? 5
      : Math.min(...candidates.map((operator) => operator.rarity));
  const counts = new Map<number, number>();
  for (const operator of candidates) counts.set(operator.rarity, (counts.get(operator.rarity) ?? 0) + 1);
  const rarityCounts = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([rarity, count]) => ({ rarity, count }));

  return {
    candidates,
    guaranteedRarity: guaranteed,
    topRarity: Math.max(...candidates.map((operator) => operator.rarity)),
    rarityCounts,
    empty: false,
  };
}
