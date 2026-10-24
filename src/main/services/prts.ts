import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Polite HTTP client for prts.maa.plus.
 *
 * Everything the copilot browser does goes through here: requests are
 * serialised with a minimum gap, identical GETs inside a short window are served
 * from memory, and conditional requests are supported for the level catalogue.
 * The site is a community service, so the defaults are deliberately slow.
 */
export interface PrtsClientOptions {
  readonly minGapMs?: number;
  readonly cacheTtlMs?: number;
  readonly cacheMaxEntries?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export interface PrtsRequest {
  readonly path: string;
}

export interface PrtsResponse {
  readonly status: number;
  readonly body: unknown;
  readonly etag?: string;
}

const DEFAULT_MIN_GAP_MS = 750;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX = 60;
const DEFAULT_TIMEOUT_MS = 20_000;

export const prtsBaseUrl = (): string => {
  const value = process.env.MAAX_PRTS_API_BASE;
  return value !== undefined && value.trim() !== "" ? value.trim().replace(/\/+$/u, "") : "https://prts.maa.plus";
};

export class PrtsClient {
  private readonly minGapMs: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; response: PrtsResponse }>();
  /** Tail of the serial queue; every request chains onto it. */
  private tail: Promise<unknown> = Promise.resolve();
  /** Negative infinity: the very first request must not wait for a gap. */
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  constructor(options: PrtsClientOptions = {}) {
    this.minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** Cached GET used by the browser: a repeated query within the TTL costs nothing. */
  async getJson(path: string): Promise<unknown> {
    const key = `get ${path}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < this.cacheTtlMs) return cached.response.body;

    const response = await this.enqueue(() => this.fetchOnce(path, undefined));
    this.remember(key, response);
    return response.body;
  }

  /**
   * Uncached POST for the one write the app performs: liking a completed
   * assignment. It shares the queue and gap with every other request.
   */
  async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await this.enqueue(() =>
      this.fetchOnce(path, undefined, { method: "POST", body: JSON.stringify(body) }),
    );
    return response.body;
  }

  /** Conditional GET: returns the cached body on 304 instead of re-downloading it. */
  async getJsonConditional(
    path: string,
    etag: string | undefined,
  ): Promise<{ body: unknown; etag?: string; notModified: boolean }> {
    const response = await this.enqueue(() => this.fetchOnce(path, etag));
    if (response.status === 304) return { body: undefined, etag, notModified: true };
    this.remember(`get ${path}`, response);
    return { body: response.body, ...(response.etag === undefined ? {} : { etag: response.etag }), notModified: false };
  }

  private remember(key: string, response: PrtsResponse): void {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), response });
    while (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) break;
      this.cache.delete(oldest.value);
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const wait = this.minGapMs - (this.now() - this.lastStartedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStartedAt = this.now();
      return await task();
    });
    // Keep the queue alive after a failure so one bad request cannot block later ones.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async fetchOnce(
    path: string,
    etag: string | undefined,
    init?: { readonly method: string; readonly body: string },
  ): Promise<PrtsResponse> {
    const response = await fetch(`${prtsBaseUrl()}${path}`, {
      method: init?.method ?? "GET",
      ...(init?.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        accept: "application/json",
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...(etag === undefined ? {} : { "if-none-match": etag }),
      },
    });
    if (response.status === 304) return { status: 304, body: undefined, ...(etag === undefined ? {} : { etag }) };
    if (!response.ok) throw new Error(`HTTP ${response.status} from prts.maa.plus`);
    const body: unknown = await response.json();
    const nextEtag = response.headers.get("etag");
    return { status: response.status, body, ...(nextEtag === null ? {} : { etag: nextEtag }) };
  }
}

/** Write a file through a temporary name so a crash cannot leave a truncated cache. */
export const writeFileAtomic = async (path: string, text: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.part`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
};

export const readFileSafe = async (path: string): Promise<string | undefined> =>
  await readFile(path, "utf8").catch(() => undefined);
