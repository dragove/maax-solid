import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../shared/schemas";
import { completeTask, failTask, finishSnapshot, runCallbackAction, startTask } from "./run-projection";

const snapshot: RunSnapshot = {
  id: "run-1",
  deviceId: "device-1",
  planId: "plan-1",
  status: "running",
  startedAt: 1_000,
  tasks: [
    { taskId: 11, configId: "c1", type: "StartUp", name: "StartUp", status: "running", startedAt: 1_000 },
    { taskId: 12, configId: "c2", type: "Fight", name: "Fight", status: "pending" },
    { taskId: 13, configId: "c3", type: "CloseDown", name: "CloseDown", status: "pending" },
  ],
};

const taskByName = (run: RunSnapshot, taskId: number) => run.tasks.find((task) => task.taskId === taskId);

describe("run projection", () => {
  it("marks only the reported task as running", () => {
    const next = startTask(snapshot, 12, 2_000);
    expect(next.status).toBe("running");
    expect(next.currentTaskId).toBe(12);
    expect(taskByName(next, 11)).toMatchObject({ status: "running", startedAt: 1_000 });
    expect(taskByName(next, 12)).toMatchObject({ status: "running", startedAt: 2_000 });
    expect(taskByName(next, 13)?.status).toBe("pending");
  });

  it("completes a task without touching the others", () => {
    const next = completeTask(snapshot, 11, 2_000);
    expect(taskByName(next, 11)).toMatchObject({ status: "completed", endedAt: 2_000 });
    expect(taskByName(next, 12)?.status).toBe("pending");
  });

  it("records the failure on both the task and the run", () => {
    const next = failTask(snapshot, 12, "识别失败", 2_000);
    expect(next.message).toBe("识别失败");
    expect(taskByName(next, 12)).toMatchObject({ status: "failed", endedAt: 2_000, message: "识别失败" });
  });

  it("stops unfinished tasks and keeps finished ones when a queue completes", () => {
    const partiallyDone = completeTask(snapshot, 11, 2_000);
    const next = finishSnapshot(partiallyDone, "completed", 3_000);
    expect(next).toMatchObject({ status: "completed", endedAt: 3_000 });
    expect(taskByName(next, 11)).toMatchObject({ status: "completed", endedAt: 2_000 });
    expect(taskByName(next, 12)).toMatchObject({ status: "stopped", endedAt: 3_000 });
    expect(taskByName(next, 13)).toMatchObject({ status: "stopped", endedAt: 3_000 });
  });

  it("fails unfinished tasks when the queue failed", () => {
    const next = finishSnapshot(snapshot, "failed", 3_000, "核心退出");
    expect(next.message).toBe("核心退出");
    expect(taskByName(next, 11)?.status).toBe("failed");
    expect(taskByName(next, 12)?.status).toBe("failed");
  });

  it("leaves an already finished run untouched", () => {
    const finished = finishSnapshot(snapshot, "completed", 3_000);
    const again = finishSnapshot(finished, "failed", 4_000, "迟到的回调");
    expect(again).toBe(finished);
  });

  it("classifies only run-related messages", () => {
    expect(runCallbackAction(10001, { taskid: 12 })).toEqual({ kind: "task-started", taskId: 12 });
    expect(runCallbackAction(10002, { taskid: 12 })).toEqual({ kind: "task-completed", taskId: 12 });
    expect(runCallbackAction(10000, { taskid: 12, why: "超时" })).toEqual({
      kind: "task-failed",
      taskId: 12,
      message: "超时",
    });
    expect(runCallbackAction(10000, { taskid: 12 })).toMatchObject({ message: "任务出错" });
    expect(runCallbackAction(10004, {})).toEqual({ kind: "run-stopped" });
    expect(runCallbackAction(3, {})).toEqual({ kind: "queue-finished" });
    expect(runCallbackAction(20001, {})).toBeUndefined();
  });
});
