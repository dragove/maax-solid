import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  CopilotDetail,
  CopilotGroup,
  CopilotItem,
  CopilotOperator,
  CopilotResolveResult,
  CopilotSearchItem,
  CopilotSearchResult,
  CopilotSetSearchResult,
} from "../../shared/schemas";
import { copilotKindFromContent } from "../../shared/copilot-kind";
import { copilotModes, copilotStageModes, type CopilotModeSelection } from "../../shared/copilot-mode";
import { writeFileAtomic, type PrtsClient } from "./prts";

/**
 * PRTS copilot API (prts.maa.plus, the mirror MAA itself talks to).
 *
 * A single assignment returns `content`, which is itself a JSON string holding
 * `stage_name`, `difficulty` and `doc.title`. `difficulty` is a bitmask:
 * 0/1 = normal only, 2 = raid only, 3 = the same file clears both. A set only
 * lists ids; each entry is fetched separately.
 */
const DIFFICULTY_NORMAL = 1;
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
  // The site omits the mask on most uploads; normal is the default except on a
  // 磨难 map, which only has the hard bit, and an H map, which only has normal.
  const difficulty = raw === 0 ? DIFFICULTY_NORMAL : raw;
  const kind = copilotKindFromContent(content.type);
  // SSS and Paradox are not normal/raid pairs; their files carry no difficulty
  // branch even if a malformed document still has the bitmask.
  if (kind !== "normal") {
    return [{ id: randomUUID(), copilotId, filename, stage, title, kind }];
  }
  return [{ id: randomUUID(), copilotId, filename, stage, title, kind, modes: modesFromContent(difficulty, stage) }];
};

/** A downloaded file's difficulty selection, capped by what the stage offers. */
const modesFromContent = (difficulty: number, stage: string): CopilotModeSelection => {
  const available = copilotStageModes(stage);
  if (available.length === 1) return { normal: available[0] === "normal", raid: available[0] === "raid" };
  const modes = copilotModes(difficulty, stage);
  return { normal: modes.includes("normal"), raid: modes.includes("raid") };
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

const mapOperatorEntries = (value: unknown): ReadonlyArray<CopilotOperator> => {
  const opers = Array.isArray(value) ? value : [];
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

const mapOperators = (content: Record<string, unknown>): ReadonlyArray<CopilotOperator> =>
  mapOperatorEntries(content.opers);

/** Groups are interchangeable alternatives; the core validates every member. */
const mapGroups = (content: Record<string, unknown>): ReadonlyArray<CopilotGroup> => {
  const groups = Array.isArray(content.groups) ? content.groups : [];
  return groups.flatMap((item) => {
    const group = asRecord(item);
    const name = asString(group.name);
    const operators = mapOperatorEntries(group.opers);
    if (name === "" && operators.length === 0) return [];
    return [{ name, operators }];
  });
};

/** Everything the local assignment file offers for a detail view. */
export const detailFromContent = (raw: unknown): CopilotDetail => {
  const content = asRecord(raw);
  const doc = asRecord(content.doc);
  return {
    details: asString(doc.details),
    minimumRequired: asString(content.minimum_required),
    operators: mapOperators(content),
    groups: mapGroups(content),
  };
};

/**
 * Batch entries store the path of the file they downloaded. Reading one is an
 * IPC-reachable action, so it must never escape the app's own copilot folder.
 */
export const isCopilotPath = (filename: string, copilotDir: string): boolean => {
  const path = relative(resolve(copilotDir), resolve(filename));
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/**
 * Read the saved JSON behind one batch entry. A missing, malformed or
 * out-of-folder file yields `null`: the browser then offers no detail panel for
 * that entry instead of showing an empty one.
 */
export const readCopilotDetail = async (filename: string, copilotDir: string): Promise<CopilotDetail | null> => {
  if (!isCopilotPath(filename, copilotDir)) return null;
  try {
    return detailFromContent(JSON.parse(await readFile(filename, "utf8")));
  } catch {
    return null;
  }
};

const eliteLabel = (value: number): string => ["零", "一", "二", "三"][value] ?? String(value);

export interface CopilotFileRepair {
  /** Human-readable corrections, one per operator. */
  readonly fixes: ReadonlyArray<string>;
}

/**
 * Repair the one inconsistency MaaCore refuses to parse in downloaded
 * assignments: an operator requirement that declares a lower elite level than
 * its own skill level or module implies.
 *
 * MaaCore's `parse_oper_usage` returns `nullopt` for such an operator, which
 * surfaces only as the generic "CopilotFileReadError". The PRTS editor lets
 * authors save the contradiction, and the local JSON is a downloaded cache, so
 * raising the declared elite level to the required minimum is safe and keeps
 * the assignment runnable. Only operators the active core knows are touched;
 * MaaCore skips this check for unknown names.
 */
export const repairCopilotFile = async (
  filename: string,
  known: ReadonlySet<string> | undefined,
): Promise<CopilotFileRepair | null> => {
  const parsed = JSON.parse(await readFile(filename, "utf8")) as Record<string, unknown>;
  const fixes: string[] = [];

  const repairOper = (value: unknown, group: string): void => {
    const oper = asRecord(value);
    const name = asString(oper.name);
    if (name === "") return;
    if (known !== undefined && !known.has(name)) return;
    const requirements = asRecord(oper.requirements);
    if (Object.keys(requirements).length === 0) return;
    const elite = optionalNumber(requirements.elite);
    if (elite === undefined) return;

    // Mirrors CopilotConfig::parse_oper_usage: skill index, skill level and
    // module all impose an elite minimum; a declared elite below it fails load.
    let required = Math.max(0, (optionalNumber(oper.skill) ?? 0) - 1);
    const skillLevel = optionalNumber(requirements.skill_level);
    if (skillLevel !== undefined && skillLevel > 7) required = Math.max(2, required);
    else if (skillLevel !== undefined && skillLevel > 4) required = Math.max(1, required);
    const module = optionalNumber(requirements.module);
    if (module !== undefined && module > 0) required = Math.max(2, required);
    if (required <= elite) return;

    requirements.elite = required;
    fixes.push(`${group === "" ? "" : `${group} / `}${name}：精英${eliteLabel(elite)} → 精英${eliteLabel(required)}`);
  };

  const values = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);
  for (const value of values(parsed.opers)) repairOper(value, "");
  for (const value of values(parsed.groups)) {
    const group = asRecord(value);
    const groupName = asString(group.name);
    for (const oper of values(group.opers)) repairOper(oper, groupName);
  }

  if (fixes.length === 0) return null;
  await writeFileAtomic(filename, `${JSON.stringify(parsed, null, 2)}\n`);
  return { fixes };
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
      groups: mapGroups(content),
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

/* -------------------------------------------------------------------------- */
/* Sets                                                                       */
/* -------------------------------------------------------------------------- */

export interface CopilotSetSearchParams {
  /** Full-text keyword over the set name and description. */
  readonly keyword?: string;
  /** PRTS user id; clicking a set author filters on it. */
  readonly creatorId?: string;
  readonly page?: number;
  readonly limit?: number;
}

/**
 * The set query is the one POST read endpoint; the body is snake_case like
 * every other PRTS payload. The backend sorts by id descending, so there is no
 * sort field to send.
 */
export const buildCopilotSetBody = (params: CopilotSetSearchParams): Record<string, unknown> => ({
  page: Math.max(1, Math.trunc(params.page ?? 1)),
  limit: Math.min(50, Math.max(1, Math.trunc(params.limit ?? 10))),
  ...(params.keyword === undefined || params.keyword.trim() === "" ? {} : { keyword: params.keyword.trim() }),
  ...(params.creatorId === undefined || params.creatorId.trim() === "" ? {} : { creator_id: params.creatorId.trim() }),
});

/** Turn one `set/query` response into renderable rows. */
export const mapCopilotSetSearch = (raw: unknown): CopilotSetSearchResult => {
  const data = asRecord(asRecord(raw).data);
  const rows = Array.isArray(data.data) ? data.data : [];
  const items = rows.flatMap((row) => {
    const record = asRecord(row);
    const id = asNumber(record.id);
    if (id <= 0) return [];
    return [
      {
        id,
        name: asString(record.name),
        description: asString(record.description),
        creator: asString(record.creator),
        creatorId: asString(record.creator_id) || String(asNumber(record.creator_id) || ""),
        copilotIds: Array.isArray(record.copilot_ids)
          ? record.copilot_ids.filter((value): value is number => typeof value === "number" && value > 0)
          : [],
        createTime: asString(record.create_time),
        updateTime: asString(record.update_time),
      },
    ];
  });
  return { total: asNumber(data.total), hasNext: data.has_next === true, items };
};

export const searchCopilotSets = async (
  client: PrtsClient,
  params: CopilotSetSearchParams,
): Promise<CopilotSetSearchResult> =>
  mapCopilotSetSearch(await client.postJson("/set/query", buildCopilotSetBody(params)));

/** `copilot/query` accepts a repeated `copilot_ids` filter; 50 is its page cap. */
const ID_QUERY_LIMIT = 50;

/**
 * Summaries of the assignments a set lists, in the set's own order.
 *
 * A set only stores ids, so a set browser has to fetch the files behind them.
 * Ids that no longer resolve (deleted or private) simply drop out.
 */
export const searchCopilotByIds = async (
  client: PrtsClient,
  ids: ReadonlyArray<number>,
  stageCodes: ReadonlyMap<string, string> = new Map(),
): Promise<ReadonlyArray<CopilotSearchItem>> => {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const rows = new Map<number, CopilotSearchItem>();
  for (let index = 0; index < unique.length; index += ID_QUERY_LIMIT) {
    const chunk = unique.slice(index, index + ID_QUERY_LIMIT);
    const query = new URLSearchParams();
    query.set("page", "1");
    query.set("limit", String(ID_QUERY_LIMIT));
    for (const id of chunk) query.append("copilot_ids", String(id));
    const result = mapCopilotSearch(await client.getJson(`/copilot/query?${query.toString()}`), stageCodes);
    for (const item of result.items) if (!rows.has(item.id)) rows.set(item.id, item);
  }
  // The API orders by hot score; the set's own order is what the user arranged.
  return unique.flatMap((id) => {
    const item = rows.get(id);
    return item === undefined ? [] : [item];
  });
};
