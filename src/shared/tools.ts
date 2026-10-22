import type { DepotItem, DepotSnapshot, OperBoxEntry, OperBoxSnapshot } from "./schemas";

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;

const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};
const asInt = (value: unknown): number | undefined => {
  const number = asNumber(value);
  return number === undefined ? undefined : Math.max(0, Math.round(number));
};

export interface DepotItemIndex {
  [itemId: string]: { readonly name?: string; readonly classifyType?: string };
}

/**
 * Parse the core's OperBoxInfo callback. Partial callbacks (`done: false`)
 * arrive while the recognition scrolls, so the same parser is used for every
 * frame and the last frame becomes the saved snapshot.
 */
export function parseOperBoxDetails(details: unknown, now: number = Date.now()): OperBoxSnapshot | undefined {
  const root = asObject(details);
  if (!root) return undefined;
  const all = new Map<string, OperBoxEntry>();
  for (const raw of asArray(root.all_opers)) {
    const item = asObject(raw);
    if (!item) continue;
    const id = asString(item.id);
    const name = asString(item.name);
    if (!id || !name) continue;
    const rarity = asInt(item.rarity) ?? 1;
    all.set(id, {
      id,
      name,
      nameEn: asString(item.name_en) ?? name,
      rarity,
      own: item.own === true,
    });
  }

  const owned = new Map<string, OperBoxEntry>();
  for (const raw of asArray(root.own_opers)) {
    const item = asObject(raw);
    if (!item) continue;
    const id = asString(item.id);
    const name = asString(item.name);
    if (!id || !name) continue;
    const base = all.get(id);
    const elite = asInt(item.elite);
    const level = asInt(item.level);
    const potential = asInt(item.potential);
    owned.set(id, {
      id,
      name,
      nameEn: base?.nameEn ?? name,
      rarity: asInt(item.rarity) ?? base?.rarity ?? 1,
      own: true,
      ...(elite === undefined ? {} : { elite }),
      ...(level === undefined ? {} : { level }),
      ...(potential === undefined ? {} : { potential }),
    });
  }

  // Older cores may only send all_opers with own flags.
  if (owned.size === 0 && all.size > 0) {
    for (const entry of all.values()) if (entry.own) owned.set(entry.id, entry);
  }

  const entries = [...owned.values()].sort(
    (a, b) => b.rarity - a.rarity || a.nameEn.localeCompare(b.nameEn) || a.id.localeCompare(b.id),
  );
  return {
    updatedAt: now,
    done: root.done === true,
    entries,
  };
}

/**
 * Parse the core's DepotInfo callback. The core sends the accumulated inventory
 * as a JSON *string* in `details.data` (itemId -> quantity), once per swipe.
 */
export function parseDepotDetails(
  details: unknown,
  itemIndex: DepotItemIndex,
  now: number = Date.now(),
): DepotSnapshot | undefined {
  const root = asObject(details);
  if (!root) return undefined;
  let data: JsonObject | undefined;
  if (typeof root.data === "string") {
    try {
      data = asObject(JSON.parse(root.data) as unknown);
    } catch {
      data = undefined;
    }
  } else {
    data = asObject(root.data);
  }
  if (!data) return undefined;

  const items: DepotItem[] = [];
  for (const [itemId, rawCount] of Object.entries(data)) {
    const count = asInt(rawCount);
    if (count === undefined || count <= 0) continue;
    const meta = itemIndex[itemId];
    items.push({
      itemId,
      name: meta?.name ?? "#" + itemId,
      count,
      group: meta?.classifyType ?? "UNKNOWN",
    });
  }
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));
  return {
    updatedAt: now,
    done: root.done === true,
    items,
  };
}
