import type {
  AppSettings,
  AppSettingsPatch,
  Bootstrap,
  CoreInfo,
  DeviceDraft,
  DeviceView,
  RunSnapshot,
  Screenshot,
  StageCatalog,
  TaskPlan,
} from "./schemas";

/**
 * The complete renderer ↔ main contract.
 *
 * The preload exposes two primitives only: a validated command invocation and a
 * live event subscription. Command payloads and results are decoded with
 * Effect Schema on both sides of the boundary.
 */
export const IPC_CHANNELS = {
  command: "maax:command",
  event: "maax:event",
} as const;

export const COMMANDS = {
  bootstrap: "app.bootstrap",
  updateSettings: "settings.update",
  pickAndAddCore: "cores.pick-and-add",
  addCore: "cores.add",
  setActiveCore: "cores.set-active",
  removeCore: "cores.remove",
  refreshCores: "cores.refresh",
  downloadCore: "cores.download",
  stageCatalog: "stages.catalog",
  addDevice: "devices.add",
  updateDevice: "devices.update",
  removeDevice: "devices.remove",
  connectDevice: "devices.connect",
  disconnectDevice: "devices.disconnect",
  screenshotDevice: "devices.screenshot",
  savePlan: "plans.save",
  removePlan: "plans.remove",
  startRun: "runs.start",
  stopRun: "runs.stop",
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

export interface CommandPayloads {
  "app.bootstrap": undefined;
  "settings.update": AppSettingsPatch;
  "cores.pick-and-add": undefined;
  "cores.add": { root: string };
  "cores.set-active": { coreId: string };
  "cores.remove": { coreId: string };
  "cores.refresh": undefined;
  "cores.download": undefined;
  "stages.catalog": undefined;
  "devices.add": DeviceDraft;
  "devices.update": { id: string; patch: Partial<DeviceDraft> };
  "devices.remove": { id: string };
  "devices.connect": { id: string };
  "devices.disconnect": { id: string };
  "devices.screenshot": { id: string };
  "plans.save": { plan: TaskPlan };
  "plans.remove": { id: string };
  "runs.start": { deviceId: string; planId: string };
  "runs.stop": { deviceId: string };
}

export interface CommandResults {
  "app.bootstrap": Bootstrap;
  "settings.update": AppSettings;
  "cores.pick-and-add": CoreInfo | null;
  "cores.add": CoreInfo;
  "cores.set-active": { settings: AppSettings; cores: ReadonlyArray<CoreInfo> };
  "cores.remove": ReadonlyArray<CoreInfo>;
  "cores.refresh": ReadonlyArray<CoreInfo>;
  "cores.download": CoreInfo | null;
  "stages.catalog": StageCatalog;
  "devices.add": DeviceView;
  "devices.update": DeviceView;
  "devices.remove": ReadonlyArray<DeviceView>;
  "devices.connect": DeviceView;
  "devices.disconnect": DeviceView;
  "devices.screenshot": Screenshot;
  "plans.save": TaskPlan;
  "plans.remove": ReadonlyArray<TaskPlan>;
  "runs.start": RunSnapshot;
  "runs.stop": RunSnapshot;
}

export interface MaaxBridge {
  invoke(command: string, payload: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
}
