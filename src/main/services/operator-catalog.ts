import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { OperatorEntry } from "../../shared/schemas";

/**
 * Operator list from MaaCore's `resource/battle_data.json`.
 *
 * The file ships with every core (≈670 KB, ~1400 entries) and carries names in
 * five languages plus rarity and profession, so the copilot filter needs no
 * network round trip and no bundled table of its own. Trap summons ("TRAP")
 * are dropped: they cannot be picked as a copilot operator.
 */
export const BATTLE_DATA_FILE = "battle_data.json";

interface BattleChar {
  readonly name?: unknown;
  readonly name_en?: unknown;
  readonly rarity?: unknown;
  readonly profession?: unknown;
  readonly sortIndex?: unknown;
}

export interface OperatorCatalogueData {
  readonly entries: ReadonlyArray<OperatorEntry>;
  /** Sort order from the game data, kept separately to avoid polluting the IPC type. */
  readonly sortIndex: ReadonlyMap<string, number>;
}

export const parseOperators = (raw: unknown): OperatorCatalogueData => {
  const chars = ((raw ?? {}) as { chars?: unknown }).chars;
  const entries: OperatorEntry[] = [];
  const sortIndex = new Map<string, number>();
  if (typeof chars !== "object" || chars === null) return { entries, sortIndex };

  for (const [id, value] of Object.entries(chars as Record<string, BattleChar>)) {
    const name = typeof value.name === "string" ? value.name : "";
    if (name === "") continue;
    const profession = typeof value.profession === "string" ? value.profession : "";
    if (profession === "TRAP") continue;
    entries.push({
      id,
      name,
      nameEn: typeof value.name_en === "string" ? value.name_en : "",
      rarity: typeof value.rarity === "number" ? value.rarity : 1,
      profession,
    });
    sortIndex.set(id, typeof value.sortIndex === "number" ? value.sortIndex : 0);
  }
  return { entries, sortIndex };
};

const rank = (entry: OperatorEntry, needle: string): number => {
  const zh = entry.name.toLowerCase();
  const en = entry.nameEn.toLowerCase();
  if (zh === needle || en === needle) return 100;
  if (zh.startsWith(needle) || en.startsWith(needle)) return 80;
  if (zh.includes(needle) || en.includes(needle)) return 50;
  return 0;
};

/** Match by Chinese or English name; best match first, 6★ before 1★ on ties. */
export const searchOperators = (
  data: OperatorCatalogueData,
  query: string,
  limit = 20,
): ReadonlyArray<OperatorEntry> => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matched: Array<{ entry: OperatorEntry; score: number }> = [];
  for (const entry of data.entries) {
    const score = rank(entry, needle);
    if (score > 0) matched.push({ entry, score });
  }
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Higher rarity first, then the game's own ordering.
    if (b.entry.rarity !== a.entry.rarity) return b.entry.rarity - a.entry.rarity;
    return (data.sortIndex.get(a.entry.id) ?? 0) - (data.sortIndex.get(b.entry.id) ?? 0);
  });
  return matched.slice(0, limit).map(({ entry }) => entry);
};

/** Lazily loads and caches the catalogue for one core directory. */
export class OperatorCatalogue {
  private data: OperatorCatalogueData | undefined;
  private loadedFor: { root: string; mtimeMs: number } | undefined;
  private loading: Promise<OperatorCatalogueData> | undefined;

  async load(resourceRoot: string): Promise<OperatorCatalogueData> {
    const file = join(resourceRoot, BATTLE_DATA_FILE);
    const mtimeMs = await stat(file).then(
      (info) => info.mtimeMs,
      () => -1,
    );
    if (this.data && this.loadedFor?.root === resourceRoot && this.loadedFor.mtimeMs === mtimeMs) return this.data;
    this.loading ??= readFile(file, "utf8")
      .then((text) => parseOperators(JSON.parse(text) as unknown))
      .then((data) => {
        this.data = data;
        this.loadedFor = { root: resourceRoot, mtimeMs };
        return data;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return await this.loading;
  }

  async search(resourceRoot: string, query: string, limit?: number): Promise<ReadonlyArray<OperatorEntry>> {
    return searchOperators(await this.load(resourceRoot), query, limit);
  }
}
