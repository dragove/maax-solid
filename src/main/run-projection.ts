import type { RunSnapshot, RunStatus, RunTaskStatus } from "../shared/schemas";

/**
 * Pure projections from MaaCore callbacks onto a run snapshot.
 *
 * The main process owns run state, but the transitions themselves are pure and
 * live here so they can be tested without an Electron runtime or a native core.
 * Callers emit events and update device state around these helpers.
 */

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "stopped"]);

export const isTerminalRunStatus = (status: RunStatus): boolean => TERMINAL_RUN_STATUSES.has(status);

const mapTask = (
  snapshot: RunSnapshot,
  taskId: number,
  patch: (task: RunSnapshot["tasks"][number]) => RunSnapshot["tasks"][number],
): RunSnapshot => ({
  ...snapshot,
  tasks: snapshot.tasks.map((task) => (task.taskId === taskId ? patch(task) : task)),
});

export const startTask = (snapshot: RunSnapshot, taskId: number, at: number): RunSnapshot => ({
  ...mapTask(snapshot, taskId, (task) => ({ ...task, status: "running", startedAt: at })),
  status: "running",
  currentTaskId: taskId,
});

export const completeTask = (snapshot: RunSnapshot, taskId: number, at: number): RunSnapshot =>
  mapTask(snapshot, taskId, (task) => ({ ...task, status: "completed", endedAt: at }));

export const failTask = (snapshot: RunSnapshot, taskId: number, message: string, at: number): RunSnapshot => ({
  ...mapTask(snapshot, taskId, (task) => ({ ...task, status: "failed", endedAt: at, message })),
  message,
});

/**
 * Close a run. Pending and running tasks become failed/stopped; already
 * terminal tasks keep their original timestamps. A run that already finished is
 * returned unchanged (same reference) so callers can skip emitting events.
 */
export const finishSnapshot = (snapshot: RunSnapshot, status: RunStatus, at: number, message?: string): RunSnapshot => {
  if (isTerminalRunStatus(snapshot.status)) return snapshot;
  const unfinished: RunTaskStatus = status === "failed" ? "failed" : "stopped";
  return {
    ...snapshot,
    status,
    endedAt: at,
    ...(message ? { message } : {}),
    tasks: snapshot.tasks.map((task) =>
      task.status === "running" || task.status === "pending" ? { ...task, status: unfinished, endedAt: at } : task,
    ),
  };
};

export type RunCallbackAction =
  | { readonly kind: "task-started"; readonly taskId: number }
  | { readonly kind: "task-completed"; readonly taskId: number }
  | { readonly kind: "task-failed"; readonly taskId: number; readonly message: string }
  | { readonly kind: "queue-finished" }
  | { readonly kind: "run-stopped" };

/**
 * Classify a MaaCore message ID into a run transition. Returns undefined for
 * messages that do not move a run, so the caller only parses what it uses.
 */
export const runCallbackAction = (msg: number, payload: Record<string, unknown>): RunCallbackAction | undefined => {
  switch (msg) {
    case 10001:
      return { kind: "task-started", taskId: Number(payload.taskid ?? 0) };
    case 10002:
      return { kind: "task-completed", taskId: Number(payload.taskid ?? 0) };
    case 10000:
      return {
        kind: "task-failed",
        taskId: Number(payload.taskid ?? 0),
        message: typeof payload.why === "string" ? payload.why : "任务出错",
      };
    case 10004:
      return { kind: "run-stopped" };
    case 3:
      return { kind: "queue-finished" };
    default:
      return undefined;
  }
};
