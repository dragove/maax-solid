import { Schema } from "effect";

/**
 * MaaResource version stamp.
 *
 * `<core>/resource/version.json` is written by MaaResource and is the only
 * cheap way to tell how stale a resource tree is: it changes whenever the task,
 * stage or pipeline data changes, without downloading anything. The stamp is
 * UTC in the form `YYYY-MM-DD HH:mm:ss.SSS`.
 */
export const RESOURCE_VERSION_FILE = "version.json";

export const ResourceVersionSchema = Schema.Struct({
  last_updated: Schema.String,
  activity: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String), time: Schema.optional(Schema.Finite) }),
  ),
  gacha: Schema.optional(Schema.Struct({ pool: Schema.optional(Schema.String), time: Schema.optional(Schema.Finite) })),
});
export type ResourceVersion = Schema.Schema.Type<typeof ResourceVersionSchema>;

const STAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u;

/** Parse a resource stamp into a UTC epoch, or undefined when it is not one. */
export const parseResourceStamp = (stamp: string): number | undefined => {
  const match = STAMP_PATTERN.exec(stamp.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const millis = Number((fraction ?? "0").padEnd(3, "0"));
  const epoch = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  );
  return Number.isFinite(epoch) ? epoch : undefined;
};

/**
 * Order two stamps: negative when `left` is older, positive when newer.
 * A parseable stamp always beats an unparseable one, so a corrupt local value
 * cannot make an update look unnecessary.
 */
export const compareResourceStamps = (left: string, right: string): number => {
  const a = parseResourceStamp(left);
  const b = parseResourceStamp(right);
  if (a !== undefined && b !== undefined) return a === b ? 0 : a > b ? 1 : -1;
  if (a !== undefined) return 1;
  if (b !== undefined) return -1;
  return left.localeCompare(right);
};

export const isNewerResourceStamp = (candidate: string, current: string): boolean =>
  compareResourceStamps(candidate, current) > 0;

/** Display a stamp in the user's time zone; unparseable values pass through. */
export const formatResourceStamp = (stamp: string, locale: string, timeZone?: string): string => {
  const epoch = parseResourceStamp(stamp);
  if (epoch === undefined) return stamp;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(epoch));
};
