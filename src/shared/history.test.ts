import { describe, expect, it } from "vitest";
import { localDayKey, summarizeRuns } from "./history";
import type { RunHistoryEntry } from "./schemas";

const at = (day: number, hour: number): number => new Date(2026, 0, day, hour, 0, 0).getTime();

const entry = (id: string, status: RunHistoryEntry["status"], startedAt: number, endedAt: number): RunHistoryEntry => ({
  id,
  deviceId: "device",
  deviceName: "MuMu",
  planId: "plan",
  planName: "Daily",
  status,
  startedAt,
  endedAt,
  tasks: [
    { type: "StartUp", name: "StartUp", status: "completed", startedAt, endedAt: endedAt - 10_000 },
    {
      type: "Fight",
      name: "Fight",
      status: status === "failed" ? "failed" : "completed",
      startedAt: endedAt - 10_000,
      endedAt,
    },
  ],
});

describe("run history statistics", () => {
  it("uses local calendar days", () => {
    const timestamp = new Date(2026, 0, 9, 23, 30).getTime();
    expect(localDayKey(timestamp)).toBe("2026-01-09");
  });

  it("aggregates outcomes, durations and task counts", () => {
    const now = at(10, 12);
    const entries = [
      entry("1", "completed", at(10, 8), at(10, 9)),
      entry("2", "failed", at(9, 8), at(9, 9)),
      entry("3", "stopped", at(3, 8), at(3, 9)),
    ];
    const stats = summarizeRuns(entries, now);
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.stopped).toBe(1);
    expect(stats.today).toBe(1);
    expect(stats.totalDurationMs).toBe(180 * 60_000);
    expect(stats.byDay).toHaveLength(7);
    expect(stats.byDay.at(-1)?.date).toBe("2026-01-10");
    expect(stats.byDay.find((day) => day.date === "2026-01-10")).toMatchObject({
      total: 1,
      completed: 1,
      failed: 0,
    });
    expect(stats.byTask[0]).toMatchObject({ type: "Fight", total: 3, completed: 2, failed: 1 });
  });

  it("keeps days with no runs in the window", () => {
    const stats = summarizeRuns([], at(10, 12));
    expect(stats.byDay.map((day) => day.total)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.total).toBe(0);
  });
});
