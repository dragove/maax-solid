import { Context, Effect, Layer, Ref, Schema } from "effect";
import { ScheduleSchema, type Schedule } from "../../shared/schemas";
import { normalizeSchedule } from "../../shared/schedule";
import { maaxError, type MaaxError } from "../errors";
import { readJsonFile, writeJsonFile } from "./json-file";
import { AppPaths } from "./paths";

const FileSchema = Schema.Array(ScheduleSchema);

export interface ScheduleStoreApi {
  readonly list: Effect.Effect<ReadonlyArray<Schedule>>;
  readonly save: (schedule: Schedule) => Effect.Effect<ReadonlyArray<Schedule>, MaaxError>;
  readonly markTriggered: (
    deviceId: string,
    at: number,
    status: NonNullable<Schedule["lastStatus"]>,
    message?: string,
  ) => Effect.Effect<ReadonlyArray<Schedule>>;
  readonly remove: (deviceId: string) => Effect.Effect<ReadonlyArray<Schedule>>;
}

export class ScheduleStore extends Context.Service<ScheduleStore, ScheduleStoreApi>()("maax/ScheduleStore") {}

const decode = (raw: unknown): ReadonlyArray<Schedule> => {
  if (raw === undefined) return [];
  try {
    return Schema.decodeUnknownSync(FileSchema)(raw);
  } catch {
    return [];
  }
};

export const ScheduleStoreLive: Layer.Layer<ScheduleStore, never, AppPaths> = Layer.effect(
  ScheduleStore,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const loaded = decode(yield* Effect.promise(() => readJsonFile(paths.schedulesFile)));
    const ref = yield* Ref.make<ReadonlyArray<Schedule>>(loaded);
    let chain: Promise<void> = Promise.resolve();

    const persist = (schedules: ReadonlyArray<Schedule>): Effect.Effect<void> =>
      Effect.promise(() => {
        chain = chain
          .then(() => writeJsonFile(paths.schedulesFile, [...schedules]))
          .catch((error: unknown) => console.warn("Failed to persist schedules", error));
        return chain;
      });

    const replace = (
      deviceId: string,
      schedule: Schedule,
      current: ReadonlyArray<Schedule>,
    ): ReadonlyArray<Schedule> => [...current.filter((item) => item.deviceId !== deviceId), schedule];

    const save = (schedule: Schedule) =>
      Effect.gen(function* () {
        const normalized = yield* Effect.try({
          try: () => normalizeSchedule(schedule),
          catch: (cause) => maaxError("计划时间设置无效", cause instanceof Error ? cause.message : String(cause)),
        });
        const next = yield* Ref.modify(ref, (current) => {
          // Scheduler-owned fields survive a UI edit even if the draft was
          // captured before the last trigger; the renderer never owns them.
          const existing = current.find((item) => item.deviceId === normalized.deviceId);
          const merged: Schedule = {
            ...normalized,
            ...(existing?.lastTriggeredAt === undefined ? {} : { lastTriggeredAt: existing.lastTriggeredAt }),
            ...(existing?.lastStatus === undefined ? {} : { lastStatus: existing.lastStatus }),
            ...(existing?.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
          };
          const updated = replace(normalized.deviceId, merged, current);
          return [updated, updated] as const;
        });
        yield* persist(next);
        return next;
      });

    const markTriggered = (
      deviceId: string,
      at: number,
      status: NonNullable<Schedule["lastStatus"]>,
      message?: string,
    ) =>
      Effect.gen(function* () {
        const next = yield* Ref.modify(ref, (current) => {
          const updated = current.map((item) =>
            item.deviceId === deviceId
              ? { ...item, lastTriggeredAt: at, lastStatus: status, lastMessage: message }
              : item,
          );
          return [updated, updated] as const;
        });
        yield* persist(next);
        return next;
      });

    const remove = (deviceId: string) =>
      Effect.gen(function* () {
        const next = yield* Ref.modify(ref, (current) => {
          const updated = current.filter((item) => item.deviceId !== deviceId);
          return [updated, updated] as const;
        });
        yield* persist(next);
        return next;
      });

    return { list: Ref.get(ref), save, markTriggered, remove } satisfies ScheduleStoreApi;
  }),
);
