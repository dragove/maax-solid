import { describe, expect, it } from "vitest";
import { defaultSchedule, isValidScheduleTime, nextScheduledAt, normalizeSchedule, scheduleDue } from "./schedule";

const monday = (hours: number, minutes: number): number => new Date(2026, 0, 12, hours, minutes, 0, 0).getTime();

describe("scheduled runs", () => {
  it("validates the time and weekday shape", () => {
    expect(isValidScheduleTime("09:05")).toBe(true);
    expect(isValidScheduleTime("24:00")).toBe(false);
    expect(() => normalizeSchedule({ ...defaultSchedule("d"), weekdays: [] })).toThrow();
    expect(normalizeSchedule({ ...defaultSchedule("d"), weekdays: [1, 1, 3] }).weekdays).toEqual([1, 3]);
  });

  it("fires inside the grace window on a matching weekday", () => {
    const schedule = { ...defaultSchedule("d"), enabled: true, time: "09:00", weekdays: [1] };
    expect(scheduleDue(schedule, monday(9, 5)).due).toBe(true);
    expect(scheduleDue(schedule, monday(8, 59)).due).toBe(false);
    // Monday 11:01 is more than two hours late.
    expect(scheduleDue(schedule, monday(11, 1)).due).toBe(false);
  });

  it("does not fire twice for the same scheduled time", () => {
    const scheduled = monday(9, 0);
    const schedule = {
      ...defaultSchedule("d"),
      enabled: true,
      time: "09:00",
      weekdays: [1],
      lastTriggeredAt: monday(9, 1),
    };
    expect(scheduleDue(schedule, monday(9, 30)).due).toBe(false);
    expect(scheduleDue(schedule, monday(9, 30)).scheduledAt).toBe(scheduled);
  });

  it("ignores disabled schedules and other weekdays", () => {
    expect(scheduleDue({ ...defaultSchedule("d"), enabled: false, time: "09:00" }, monday(9, 5)).due).toBe(false);
    expect(scheduleDue({ ...defaultSchedule("d"), enabled: true, weekdays: [2] }, monday(9, 5)).due).toBe(false);
  });

  it("reports the next matching occurrence", () => {
    const schedule = { ...defaultSchedule("d"), enabled: true, time: "09:00", weekdays: [1] };
    expect(nextScheduledAt(schedule, monday(10, 0))).toBe(new Date(2026, 0, 19, 9, 0, 0, 0).getTime());
  });
});
