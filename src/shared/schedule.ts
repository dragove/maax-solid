import type { Schedule } from "./schemas";

export const WEEKDAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 0];
export const DEFAULT_SCHEDULE_TIME = "09:00";
export const SCHEDULE_GRACE_MS = 2 * 60 * 60 * 1000;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

export const isValidScheduleTime = (value: string): boolean => TIME_PATTERN.test(value);

export const defaultSchedule = (deviceId: string, planId?: string): Schedule => ({
  deviceId,
  ...(planId === undefined ? {} : { planId }),
  enabled: false,
  time: DEFAULT_SCHEDULE_TIME,
  weekdays: [...WEEKDAYS],
});

/** Validate the shape the UI is allowed to save; the main process is the authority. */
export function normalizeSchedule(input: Schedule): Schedule {
  if (!isValidScheduleTime(input.time)) throw new Error("invalid schedule time");
  const weekdays = [...new Set(input.weekdays)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (weekdays.length === 0) throw new Error("a schedule needs at least one weekday");
  return { ...input, weekdays };
}

export interface ScheduleDue {
  readonly due: boolean;
  /** Local timestamp of today's scheduled time, even when it is not due. */
  readonly scheduledAt: number;
}

/**
 * A schedule fires when its local time has passed today, the weekday matches,
 * it has not fired since that time, and the moment is still inside the grace
 * window. The grace window keeps an app that was closed overnight from
 * starting a 09:00 run at 22:00.
 */
export function scheduleDue(
  schedule: Schedule,
  now: number = Date.now(),
  graceMs: number = SCHEDULE_GRACE_MS,
): ScheduleDue {
  const [hours = 9, minutes = 0] = schedule.time.split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  const scheduledAt = scheduled.getTime();
  if (schedule.enabled !== true || !schedule.weekdays.includes(scheduled.getDay())) {
    return { due: false, scheduledAt };
  }
  if (now < scheduledAt || now - scheduledAt > graceMs) return { due: false, scheduledAt };
  if (schedule.lastTriggeredAt !== undefined && schedule.lastTriggeredAt >= scheduledAt) {
    return { due: false, scheduledAt };
  }
  return { due: true, scheduledAt };
}

/** Next local occurrence, used for the schedule summary in the Runs page. */
export function nextScheduledAt(schedule: Schedule, now: number = Date.now()): number | undefined {
  if (schedule.weekdays.length === 0) return undefined;
  const [hours = 9, minutes = 0] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now) continue;
    if (schedule.weekdays.includes(candidate.getDay())) return candidate.getTime();
  }
  return undefined;
}
