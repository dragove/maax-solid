import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CopilotItem,
  CopilotOperator,
  CopilotResolveResult,
  CopilotSearchItem,
  CopilotSearchResult,
} from "../../shared/schemas";
import { copilotKindFromContent } from "../../shared/copilot-kind";
import type { PrtsClient } from "./prts";

/**
 * PRTS copilot API (prts.maa.plus, the mirror MAA itself talks to).
 *
 * A single assignment returns `content`, which is itself a JSON string holding
 * `stage_name`, `difficulty` and `doc.title`. `difficulty` is a bitmask:
 * 0/1 = normal only, 2 = raid only, 3 = the same file clears both. A set only
 * lists ids; each entry is fetched separately.
 */
const DIFFICULTY_NORMAL = 1;
const DIFFICULTY_RAID = 2;
const SET_CONCURRENCY = 4;

export interface CopilotReference {
  readonly kind: "single" | "set";
  readonly id: number;
}

/**
 * Accept what a user is likely to paste: a bare id, a PRTS link, `prts://` or
 * `maa://` shortcuts, with an optional `s`/`set` marking a set.
 */
export const parseCopilotInput = (input: string): CopilotReference | undefined => {
  const text = input.trim();
  if (text === "") return undefined;

  const path = /\/(copilot|set|s)\/(\d+)/iu.exec(text);
  if (path) {
    const id = Number(path[2]);
    if (!Number.isSafeInteger(id) || id <= 0) return undefined;
    return { kind: path[1]!.toLowerCase() === "copilot" ? "single" : "set", id };
  }

  const shortcut = /^(?:(?:prts|maa):\/\/)?(s(?:et)?(?=[:/\d]))?[:/]*(\d+)$/iu.exec(text);
  if (!shortcut) return undefined;
  const id = Number(shortcut[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return { kind: shortcut[1] === undefined ? "single" : "set", id };
};

interface CopilotContent {
  readonly type?: unknown;
  readonly stage_name?: unknown;
  readonly difficulty?: unknown;
  readonly doc?: { readonly title?: unknown };
}

/** Turn a downloaded assignment into one or two batch entries. */
export const itemsFromContent = (
  content: CopilotContent,
  copilotId: number,
  filename: string,
): ReadonlyArray<CopilotItem> => {
  const stage = typeof content.stage_name === "string" ? content.stage_name : "";
  const title = typeof content.doc?.title === "string" && content.doc.title !== "" ? content.doc.title : stage;
  const raw = typeof content.difficulty === "number" ? content.difficulty : 0;
  const difficulty = raw === 0 ? DIFFICULTY_NORMAL : raw;
  const kind = copilotKindFromContent(content.type);
  // SSS and Paradox are not normal/raid pairs; their files carry no difficulty
  // branch even if a malformed document still has the bitmask.
  if (kind !== "normal") {
    return [{ id: randomUUID(), copilotId, filename, stage, title, isRaid: false, kind }];
  }
  const modes: boolean[] = [];
  if ((difficulty & DIFFICULTY_NORMAL) !== 0) modes.push(false);
  if ((difficulty & DIFFICULTY_RAID) !== 0) modes.push(true);
  if (modes.length === 0) modes.push(false);
  return modes.map((isRaid) => ({ id: randomUUID(), copilotId, filename, stage, title, isRaid, kind }));
};

const unwrap = (raw: unknown): { code: number; message: string; data: unknown } => {
  const body = (raw ?? {}) as { status_code?: unknown; message?: unknown; data?: unknown };
  return {
    code: typeof body.status_code === "number" ? body.status_code : 0,
    message: typeof body.message === "string" ? body.message : "",
    data: body.data,
  };
};

const downloadSingle = async (
  id: number,
  copilotDir: string,
  client: PrtsClient,
): Promise<ReadonlyArray<CopilotItem>> => {
  const body = unwrap(await client.getJson(`/copilot/get/${id}`));
  if (body.code >= 400) throw new Error(body.message || `作业 ${id} 不存在`);
  const content = (body.data ?? {}) as { content?: unknown };
  const raw = typeof content.content === "string" ? content.content : "";
  let parsed: CopilotContent;
  try {
    parsed = JSON.parse(raw) as CopilotContent;
  } catch {
    throw new Error(`作业 ${id} 的内容不是有效的 JSON`);
  }
  await mkdir(copilotDir, { recursive: true });
  const filename = join(copilotDir, `prts-${id}.json`);
  await writeFile(filename, raw, "utf8");
  return itemsFromContent(parsed, id, filename);
};

const downloadSet = async (
  id: number,
  copilotDir: string,
  client: PrtsClient,
): Promise<{ title: string; items: ReadonlyArray<CopilotItem> }> => {
  const body = unwrap(await client.getJson(`/set/get?id=${id}`));
  if (body.code >= 400) throw new Error(body.message || `作业集 ${id} 不存在`);
  const data = (body.data ?? {}) as { name?: unknown; copilot_ids?: unknown };
  const title = typeof data.name === "string" ? data.name : `${id}`;
  const ids = Array.isArray(data.copilot_ids)
    ? data.copilot_ids.filter((value): value is number => typeof value === "number" && value > 0)
    : [];
  if (ids.length === 0) throw new Error(`作业集 ${id} 里没有作业`);

  const items: CopilotItem[] = [];
  for (let index = 0; index < ids.length; index += SET_CONCURRENCY) {
    const chunk = ids.slice(index, index + SET_CONCURRENCY);
    // Sequential through the shared client: the queue already spaces requests.
    const results = await Promise.all(chunk.map((copilotId) => downloadSingle(copilotId, copilotDir, client)));
    for (const result of results) items.push(...result);
  }
  return { title, items };
};

/** Resolve a pasted reference into downloaded files plus their batch entries. */
export const resolveCopilot = async (
  input: string,
  copilotDir: string,
  client: PrtsClient,
): Promise<CopilotResolveResult> => {
  const reference = parseCopilotInput(input);
  if (!reference) throw new Error("请输入作业编号、PRTS 链接，或 prts://s/<作业集编号>");
  if (reference.kind === "set") {
    const { title, items } = await downloadSet(reference.id, copilotDir, client);
    return { kind: "set", title, items: [...items] };
  }
  const items = await downloadSingle(reference.id, copilotDir, client);
  return { kind: "single", title: items[0]?.title ?? `${reference.id}`, items: [...items] };
};

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export interface CopilotSearchParams {
  /** Full-text keyword: matches stage names, operator names, uploader and details. */
  readonly document?: string;
  readonly operator?: string;
  readonly uploaderId?: string;
  /** Internal stage id (`main_01-07`); exact stage filtering happens here. */
  readonly stage?: string;
  readonly orderBy?: "hot" | "views" | "upload_time";
  readonly desc?: boolean;
  readonly page?: number;
  readonly limit?: number;
  readonly language?: "zh" | "en";
}

/** Build the query string for `copilot/query`; empty filters are omitted. */
export const buildCopilotQuery = (params: CopilotSearchParams): string => {
  const search = new URLSearchParams();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const limit = Math.min(50, Math.max(1, Math.trunc(params.limit ?? 20)));
  search.set("page", String(page));
  search.set("limit", String(limit));
  search.set("orderBy", params.orderBy ?? "hot");
  search.set("desc", String(params.desc ?? true));
  search.set("language", params.language ?? "zh");
  const document = params.document?.trim();
  if (document) search.set("document", document);
  const operator = params.operator?.trim();
  if (operator) search.set("operator", operator);
  const uploaderId = params.uploaderId?.trim();
  if (uploaderId) search.set("uploader_id", uploaderId);
  const stage = params.stage?.trim();
  if (stage) search.set("level_keyword", stage);
  return `/copilot/query?${search.toString()}`;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown, fallback = 0): number => (typeof value === "number" ? value : fallback);

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

const mapOperators = (content: Record<string, unknown>): ReadonlyArray<CopilotOperator> => {
  const opers = Array.isArray(content.opers) ? content.opers : [];
  return opers.flatMap((item) => {
    const oper = asRecord(item);
    const name = asString(oper.name);
    if (name === "") return [];
    const requirements = asRecord(oper.requirements);
    const elite = optionalNumber(requirements.elite);
    const level = optionalNumber(requirements.level);
    const module = optionalNumber(requirements.module);
    const potential = optionalNumber(requirements.potentiality);
    return [
      {
        name,
        role: asString(oper.role),
        skill: asNumber(oper.skill),
        ...(elite === undefined ? {} : { elite }),
        ...(level === undefined ? {} : { level }),
        ...(module === undefined ? {} : { module }),
        ...(potential === undefined ? {} : { potential }),
      },
    ];
  });
};

/** Turn one `copilot/query` response into renderable rows. */
export const mapCopilotSearch = (raw: unknown, stageCodes: ReadonlyMap<string, string>): CopilotSearchResult => {
  const body = asRecord(raw);
  const data = asRecord(body.data);
  const rows = Array.isArray(data.data) ? data.data : [];
  const items: CopilotSearchItem[] = [];

  for (const row of rows) {
    const record = asRecord(row);
    const id = asNumber(record.id);
    if (id <= 0) continue;
    let content: Record<string, unknown> = {};
    try {
      content = asRecord(JSON.parse(asString(record.content)));
    } catch {
      content = {};
    }
    const doc = asRecord(content.doc);
    const stage = asString(content.stage_name);
    items.push({
      id,
      title: asString(doc.title),
      details: asString(doc.details),
      stage,
      stageCode: stageCodes.get(stage) ?? "",
      difficulty: asNumber(content.difficulty),
      operators: mapOperators(content),
      uploader: asString(record.uploader),
      uploaderId: asString(record.uploader_id) || String(asNumber(record.uploader_id) || ""),
      views: asNumber(record.views),
      hotScore: asNumber(record.hot_score),
      ratingLevel: asNumber(record.rating_level),
      minimumRequired: asString(content.minimum_required),
    });
  }

  return {
    page: asNumber(data.page, 1),
    total: asNumber(data.total),
    hasNext: data.has_next === true,
    items,
  };
};

/** One polite request through the shared client. */
export const searchCopilot = async (
  client: PrtsClient,
  params: CopilotSearchParams,
  stageCodes: ReadonlyMap<string, string> = new Map(),
): Promise<CopilotSearchResult> => mapCopilotSearch(await client.getJson(buildCopilotQuery(params)), stageCodes);
