import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { TaskPlan } from "../../shared/schemas";
import { createTask } from "../../shared/tasks";
import { decodePlanFile, encodePlanFile, planFileName } from "./plan-file";

const plan: TaskPlan = {
  id: "plan-1",
  deviceId: "device-1",
  name: "我的计划",
  tasks: [createTask("Fight", "00000000-0000-4000-8000-000000000001")],
  createdAt: 1,
  updatedAt: 2,
};

describe("plan file", () => {
  it("round-trips the name and tasks", async () => {
    const file = encodePlanFile(plan);
    expect(file).toMatchObject({ version: 1, name: "我的计划" });

    const decoded = await Effect.runPromise(decodePlanFile(JSON.parse(JSON.stringify(file))));
    expect(decoded.name).toBe("我的计划");
    expect(decoded.tasks.map((task) => task.id)).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  it("accepts a file without a version or name", async () => {
    const decoded = await Effect.runPromise(
      decodePlanFile({ tasks: [createTask("Fight", "00000000-0000-4000-8000-000000000002")] }),
    );
    expect(decoded.version).toBeUndefined();
    expect(decoded.tasks).toHaveLength(1);
  });

  it("rejects a file whose tasks are not task configs", async () => {
    await expect(Effect.runPromise(decodePlanFile({ tasks: [{ type: "Nope" }] }))).rejects.toThrow();
    await expect(Effect.runPromise(decodePlanFile({ name: "no tasks" }))).rejects.toThrow();
  });

  it("strips characters a file name cannot carry", () => {
    expect(planFileName("A/B: C")).toBe("A-B-C.json");
    expect(planFileName("主线 1-7")).toBe("主线-1-7.json");
  });
});
