import type { RunHistoryEntry, RunStats, RunTaskStat } from "./schemas";

/** Local calendar day key (not UTC): schedules and stats are local-time UX. */
export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Aggregate terminal runs for the overview and the Runs page. `entries` are
 * already terminal (completed / stopped / failed); nothing here mutates them.
 */
export function summarizeRuns(entries: ReadonlyArray<RunHistoryEntry>, now: number = Date.now(), days = 7): RunStats {
  let completed = 0;
  let failed = 0;
  let stopped = 0;
  let totalDurationMs = 0;
  let today = 0;
  const todayKey = localDayKey(now);
  const byDay = new Map<string, { total: number; completed: number; failed: number }>();
  const byTask = new Map<string, { total: number; completed: number; failed: number }>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    byDay.set(localDayKey(date.getTime()), { total: 0, completed: 0, failed: 0 });
  }

  for (const entry of entries) {
    if (entry.status === "completed") completed += 1;
    else if (entry.status === "failed") failed += 1;
    else if (entry.status === "stopped") stopped += 1;
    totalDurationMs += Math.max(0, entry.endedAt - entry.startedAt);

    const dayKey = localDayKey(entry.startedAt);
    if (dayKey === todayKey) today += 1;
    const day = byDay.get(dayKey);
    if (day) {
      day.total += 1;
      if (entry.status === "completed") day.completed += 1;
      if (entry.status === "failed") day.failed += 1;
    }

    for (const task of entry.tasks) {
      const bucket = byTask.get(task.type) ?? { total: 0, completed: 0, failed: 0 };
      bucket.total += 1;
      if (task.status === "completed") bucket.completed += 1;
      if (task.status === "failed") bucket.failed += 1;
      byTask.set(task.type, bucket);
    }
  }

  const taskStats: RunTaskStat[] = [...byTask.entries()]
    .map(([type, value]) => ({ type: type as RunTaskStat["type"], ...value }))
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));

  return {
    total: entries.length,
    completed,
    failed,
    stopped,
    today,
    totalDurationMs,
    byDay: [...byDay.entries()].map(([date, value]) => ({ date, ...value })),
    byTask: taskStats,
  };
}
