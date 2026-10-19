import { join } from "node:path";
import type { CopilotLevel } from "../../shared/schemas";
import { PrtsClient, readFileSafe, writeFileAtomic } from "./prts";

/**
 * Stage catalogue from `GET /arknights/level` (≈690 KB, 3.5k entries).
 *
 * The endpoint advertises an ETag, so the file is cached on disk and only
 * revalidated when the local copy is older than the TTL; a 304 keeps the cached
 * copy. The catalogue is what turns a display code such as `1-7` or `YW-EX-3`
 * into the internal `stage_id` that the copilot query filters on.
 */
export interface LevelEntry {
  readonly stageId: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
}

const LEVEL_PATH = "/arknights/level";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RESULTS = 25;

interface LevelCacheFile {
  readonly etag?: string;
  readonly fetchedAt: number;
  readonly entries: ReadonlyArray<LevelEntry>;
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** `cat_three` carries the display code ("1-7", "YW-EX-3", "H9-5（标准）"). */
export const parseLevels = (raw: unknown): ReadonlyArray<LevelEntry> => {
  const body = (raw ?? {}) as { data?: unknown };
  const list = Array.isArray(body.data) ? body.data : [];
  const entries: LevelEntry[] = [];
  for (const item of list) {
    const row = item as Record<string, unknown>;
    const stageId = asString(row.stage_id);
    if (stageId === "") continue;
    entries.push({
      stageId,
      code: asString(row.cat_three),
      name: asString(row.name),
      category: asString(row.cat_one),
    });
  }
  return entries;
};

const score = (entry: LevelEntry, query: string): number => {
  const code = entry.code.toLowerCase();
  const name = entry.name.toLowerCase();
  const stageId = entry.stageId.toLowerCase();
  const needle = query.toLowerCase();
  if (code === needle) return 100;
  if (stageId === needle) return 95;
  if (code.startsWith(needle)) return 80;
  if (code.split(/[\s（(]/u)[0] === needle) return 75;
  if (name === needle) return 70;
  if (code.includes(needle)) return 50;
  if (stageId.includes(needle)) return 40;
  if (name.includes(needle)) return 30;
  return 0;
};

/** Fuzzy match on display code, stage id and stage name, best match first. */
export const searchLevels = (
  entries: ReadonlyArray<LevelEntry>,
  query: string,
  limit = MAX_RESULTS,
): ReadonlyArray<CopilotLevel> => {
  const needle = query.trim();
  if (needle === "") return [];
  const matched: Array<{ entry: LevelEntry; score: number }> = [];
  for (const entry of entries) {
    const value = score(entry, needle);
    if (value > 0) matched.push({ entry, score: value });
  }
  matched.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
  return matched.slice(0, limit).map(({ entry }) => ({
    stageId: entry.stageId,
    code: entry.code,
    name: entry.name,
    category: entry.category,
  }));
};

/** Exact lookup used before a search: a display code or a stage id. */
export const findLevel = (entries: ReadonlyArray<LevelEntry>, term: string): LevelEntry | undefined => {
  const needle = term.trim().toLowerCase();
  if (needle === "") return undefined;
  return (
    entries.find((entry) => entry.stageId.toLowerCase() === needle) ??
    entries.find((entry) => entry.code.toLowerCase() === needle) ??
    entries.find((entry) => entry.code.toLowerCase().split(/[\s（(]/u)[0] === needle)
  );
};

export class LevelCatalogue {
  private entries: ReadonlyArray<LevelEntry> | undefined;
  private loading: Promise<ReadonlyArray<LevelEntry>> | undefined;
  private etag: string | undefined;
  private fetchedAt = 0;

  constructor(
    private readonly client: PrtsClient,
    private readonly cacheFile: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {}

  async load(): Promise<ReadonlyArray<LevelEntry>> {
    if (this.entries) {
      if (this.now() - this.fetchedAt < this.ttlMs) return this.entries;
      // Stale: refresh in the background and keep serving the cached copy.
      void this.refresh().catch(() => undefined);
      return this.entries;
    }
    this.loading ??= this.loadFromDiskOrNetwork().finally(() => {
      this.loading = undefined;
    });
    return await this.loading;
  }

  async search(query: string, limit?: number): Promise<ReadonlyArray<CopilotLevel>> {
    return searchLevels(await this.load(), query, limit);
  }

  /** Resolve a user-typed stage (display code, name, or stage id) to its id. */
  async resolveStage(term: string): Promise<LevelEntry | undefined> {
    return findLevel(await this.load(), term);
  }

  private async loadFromDiskOrNetwork(): Promise<ReadonlyArray<LevelEntry>> {
    const text = await readFileSafe(this.cacheFile);
    if (text !== undefined) {
      try {
        const cached = JSON.parse(text) as LevelCacheFile;
        if (Array.isArray(cached.entries) && cached.entries.length > 0) {
          this.entries = cached.entries;
          this.fetchedAt = typeof cached.fetchedAt === "number" ? cached.fetchedAt : 0;
          this.etag = typeof cached.etag === "string" ? cached.etag : undefined;
          if (this.now() - this.fetchedAt < this.ttlMs) return this.entries;
          void this.refresh().catch(() => undefined);
          return this.entries;
        }
      } catch {
        // Corrupt cache: fall through and download a fresh copy.
      }
    }
    return await this.refresh();
  }

  private async refresh(): Promise<ReadonlyArray<LevelEntry>> {
    const response = await this.client.getJsonConditional(LEVEL_PATH, this.etag);
    const fetchedAt = this.now();
    if (response.notModified && this.entries) {
      this.fetchedAt = fetchedAt;
      await this.persist();
      return this.entries;
    }
    const entries = parseLevels(response.body);
    if (entries.length === 0) throw new Error("关卡列表为空");
    this.entries = entries;
    this.etag = response.etag;
    this.fetchedAt = fetchedAt;
    await this.persist();
    return entries;
  }

  private async persist(): Promise<void> {
    if (!this.entries) return;
    const payload: LevelCacheFile = {
      ...(this.etag === undefined ? {} : { etag: this.etag }),
      fetchedAt: this.fetchedAt,
      entries: this.entries,
    };
    await writeFileAtomic(this.cacheFile, JSON.stringify(payload));
  }
}

export const levelCachePath = (cacheDir: string): string => join(cacheDir, "prts-levels.json");
