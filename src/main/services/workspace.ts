import { Context, Effect, Layer, Ref, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { randomUUID } from "node:crypto";
import {
  DeviceProfileSchema,
  TaskPlanSchema,
  type DeviceDraft,
  type DeviceProfile,
  type TaskConfig,
  type TaskPlan,
} from "../../shared/schemas";
import { createDefaultPlanTasks } from "../../shared/tasks";
import { maaxError } from "../errors";
import { AppPaths } from "./paths";
import { readJson, writeJson } from "./json-store";

const WorkspaceSchema = Schema.Struct({
  devices: Schema.Array(DeviceProfileSchema),
  plans: Schema.Array(TaskPlanSchema),
});
type WorkspaceData = Schema.Schema.Type<typeof WorkspaceSchema>;

const EMPTY_WORKSPACE: WorkspaceData = { devices: [], plans: [] };

export interface WorkspaceApi {
  readonly getDevices: Effect.Effect<ReadonlyArray<DeviceProfile>>;
  readonly getPlans: Effect.Effect<ReadonlyArray<TaskPlan>>;
  readonly addDevice: (
    draft: DeviceDraft,
  ) => Effect.Effect<{ device: DeviceProfile; plan: TaskPlan }>;
  readonly updateDevice: (
    id: string,
    patch: Partial<DeviceDraft>,
  ) => Effect.Effect<DeviceProfile, import("../errors").MaaxError>;
  readonly removeDevice: (id: string) => Effect.Effect<ReadonlyArray<DeviceProfile>>;
  readonly savePlan: (plan: TaskPlan) => Effect.Effect<TaskPlan, import("../errors").MaaxError>;
  readonly removePlan: (id: string) => Effect.Effect<ReadonlyArray<TaskPlan>>;
  readonly getPlan: (id: string) => Effect.Effect<TaskPlan | undefined>;
  readonly setActivePlan: (
    deviceId: string,
    planId: string,
  ) => Effect.Effect<DeviceProfile, import("../errors").MaaxError>;
  readonly markConnected: (
    id: string,
  ) => Effect.Effect<DeviceProfile, import("../errors").MaaxError>;
  readonly ensureActivePlan: (
    deviceId: string,
  ) => Effect.Effect<TaskPlan, import("../errors").MaaxError>;
}

export class Workspace extends Context.Service<Workspace, WorkspaceApi>()("maax/Workspace") {}

const sortPlans = (plans: ReadonlyArray<TaskPlan>): ReadonlyArray<TaskPlan> =>
  [...plans].sort((a, b) => a.createdAt - b.createdAt);

export const WorkspaceLive: Layer.Layer<Workspace, never, AppPaths | FileSystem> = Layer.effect(
  Workspace,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const fs = yield* FileSystem;
    yield* fs
      .makeDirectory(paths.configDir, { recursive: true })
      .pipe(Effect.orElseSucceed(() => undefined));

    const loaded = yield* readJson(paths.workspaceFile, WorkspaceSchema, EMPTY_WORKSPACE);
    const ref = yield* Ref.make<WorkspaceData>({
      devices: loaded.devices,
      plans: loaded.plans,
    });

    const persist = (workspace: WorkspaceData) =>
      writeJson(paths.workspaceFile, workspace).pipe(
        Effect.asVoid,
        Effect.provideService(FileSystem, fs),
      );

    const modify = <A>(f: (workspace: WorkspaceData) => { workspace: WorkspaceData; result: A }) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const { workspace, result } = f(current);
        yield* Ref.set(ref, workspace);
        yield* persist(workspace);
        return result;
      });

    const addDevice = (draft: DeviceDraft) =>
      Effect.gen(function* () {
        const now = Date.now();
        const device: DeviceProfile = {
          id: randomUUID(),
          name: draft.name.trim() || draft.address,
          address: draft.address.trim(),
          adbPath: draft.adbPath.trim(),
          config: draft.config,
          clientType: draft.clientType,
          remark: draft.remark,
          createdAt: now,
        };
        const plan: TaskPlan = {
          id: randomUUID(),
          deviceId: device.id,
          name: "Default",
          tasks: [...createDefaultPlanTasks()] as TaskConfig[],
          createdAt: now,
          updatedAt: now,
        };
        const withPlan: DeviceProfile = { ...device, activePlanId: plan.id };
        yield* modify((workspace) => ({
          workspace: {
            devices: [...workspace.devices, withPlan],
            plans: [...workspace.plans, plan],
          },
          result: undefined,
        }));
        return { device: withPlan, plan };
      });

    const updateDevice = (id: string, patch: Partial<DeviceDraft>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const existing = current.devices.find((device) => device.id === id);
        if (!existing) return yield* Effect.fail(maaxError("设备不存在"));
        const next: DeviceProfile = {
          ...existing,
          ...patch,
          name: patch.name?.trim() || existing.name,
          address: patch.address?.trim() || existing.address,
        };
        yield* modify((workspace) => ({
          workspace: {
            ...workspace,
            devices: workspace.devices.map((device) => (device.id === id ? next : device)),
          },
          result: undefined,
        }));
        return next;
      });

    const removeDevice = (id: string) =>
      modify((workspace) => {
        const devices = workspace.devices.filter((device) => device.id !== id);
        const plans = workspace.plans.filter((plan) => plan.deviceId !== id);
        return { workspace: { devices, plans }, result: devices };
      });

    const savePlan = (plan: TaskPlan) =>
      Effect.gen(function* () {
        const exists = (yield* Ref.get(ref)).plans.some((item) => item.id === plan.id);
        if (!exists) return yield* Effect.fail(maaxError("任务计划不存在"));
        const next: TaskPlan = { ...plan, updatedAt: Date.now() };
        yield* modify((workspace) => ({
          workspace: {
            ...workspace,
            plans: workspace.plans.map((item) => (item.id === plan.id ? next : item)),
          },
          result: undefined,
        }));
        return next;
      });

    const removePlan = (id: string) =>
      modify((workspace) => {
        const plans = workspace.plans.filter((plan) => plan.id !== id);
        const devices = workspace.devices.map((device) => {
          if (device.activePlanId !== id) return device;
          const replacement = plans
            .filter((plan) => plan.deviceId === device.id)
            .sort((a, b) => a.createdAt - b.createdAt)[0];
          return replacement
            ? { ...device, activePlanId: replacement.id }
            : { ...device, activePlanId: undefined };
        });
        return { workspace: { devices, plans }, result: sortPlans(plans) };
      });

    const getPlan = (id: string) =>
      Ref.get(ref).pipe(Effect.map((workspace) => workspace.plans.find((plan) => plan.id === id)));

    const setActivePlan = (deviceId: string, planId: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const device = current.devices.find((item) => item.id === deviceId);
        if (!device) return yield* Effect.fail(maaxError("设备不存在"));
        const plan = current.plans.find((item) => item.id === planId && item.deviceId === deviceId);
        if (!plan) return yield* Effect.fail(maaxError("任务计划不存在"));
        const next = { ...device, activePlanId: planId };
        yield* modify((workspace) => ({
          workspace: {
            ...workspace,
            devices: workspace.devices.map((item) => (item.id === deviceId ? next : item)),
          },
          result: undefined,
        }));
        return next;
      });

    const markConnected = (id: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const device = current.devices.find((item) => item.id === id);
        if (!device) return yield* Effect.fail(maaxError("设备不存在"));
        const next: DeviceProfile = { ...device, lastConnectedAt: Date.now() };
        yield* modify((workspace) => ({
          workspace: {
            ...workspace,
            devices: workspace.devices.map((item) => (item.id === id ? next : item)),
          },
          result: undefined,
        }));
        return next;
      });

    const ensureActivePlan = (deviceId: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(ref);
        const device = current.devices.find((item) => item.id === deviceId);
        if (!device) return yield* Effect.fail(maaxError("设备不存在"));
        const existing = current.plans.find((plan) => plan.id === device.activePlanId);
        if (existing) return existing;
        const first = current.plans
          .filter((plan) => plan.deviceId === deviceId)
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (first) {
          yield* setActivePlan(deviceId, first.id);
          return first;
        }
        const now = Date.now();
        const plan: TaskPlan = {
          id: randomUUID(),
          deviceId,
          name: "Default",
          tasks: [...createDefaultPlanTasks()] as TaskConfig[],
          createdAt: now,
          updatedAt: now,
        };
        yield* modify((workspace) => ({
          workspace: {
            devices: workspace.devices.map((item) =>
              item.id === deviceId ? { ...item, activePlanId: plan.id } : item,
            ),
            plans: [...workspace.plans, plan],
          },
          result: undefined,
        }));
        return plan;
      });

    const api: WorkspaceApi = {
      getDevices: Ref.get(ref).pipe(Effect.map((workspace) => workspace.devices)),
      getPlans: Ref.get(ref).pipe(Effect.map((workspace) => sortPlans(workspace.plans))),
      addDevice,
      updateDevice,
      removeDevice,
      savePlan,
      removePlan,
      getPlan,
      setActivePlan,
      markConnected,
      ensureActivePlan,
    };
    return api;
  }),
);
