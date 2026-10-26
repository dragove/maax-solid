import type {
  AppSettings,
  AppSettingsPatch,
  Bootstrap,
  CopilotDetail,
  CopilotFile,
  CopilotLevel,
  CopilotResolveResult,
  CopilotItem,
  CopilotOptions,
  CopilotSearchItem,
  CopilotSearchResult,
  CopilotSetSearchResult,
  CopilotSetup,
  CoreInfo,
  OperatorAvatar,
  OperatorEntry,
  RoguelikeOperator,
  CoreReleaseCheck,
  DeviceDraft,
  DeviceView,
  LogEntry,
  RecruitmentData,
  ResourceApplyResult,
  ResourceCheck,
  ResourceStatus,
  RunHistory,
  RunSnapshot,
  Schedule,
  Screenshot,
  StageCatalog,
  TaskPlan,
  ToolKind,
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
  checkCoreUpdate: "cores.check-update",
  repairCore: "cores.repair",
  moveCore: "cores.move",
  resourceStatus: "resources.status",
  checkResourceUpdate: "resources.check",
  updateResource: "resources.update",
  rollbackResource: "resources.rollback",
  stageCatalog: "stages.catalog",
  addDevice: "devices.add",
  updateDevice: "devices.update",
  removeDevice: "devices.remove",
  connectDevice: "devices.connect",
  disconnectDevice: "devices.disconnect",
  screenshotDevice: "devices.screenshot",
  savePlan: "plans.save",
  removePlan: "plans.remove",
  createPlan: "plans.create",
  duplicatePlan: "plans.duplicate",
  renamePlan: "plans.rename",
  importPlan: "plans.import",
  exportPlan: "plans.export",
  setActivePlan: "plans.set-active",
  importCopilot: "copilot.import",
  pickVideo: "videos.pick",
  resolveCopilot: "copilot.resolve",
  readCopilotDetail: "copilot.detail",
  searchCopilot: "copilot.search",
  searchCopilotSets: "copilot.sets",
  copilotSetItems: "copilot.set-items",
  searchCopilotLevels: "copilot.levels",
  searchOperators: "copilot.operators",
  roguelikeOperators: "roguelike.operators",
  operatorAvatars: "operator.avatars",
  updateCopilotOptions: "copilot.options",
  setCopilotItems: "copilot.items",
  startCopilot: "copilot.start",
  startRun: "runs.start",
  stopRun: "runs.stop",
  runHistory: "runs.history",
  clearHistory: "runs.clear",
  saveSchedule: "schedules.save",
  recruitmentData: "tools.recruitment",
  startTool: "tools.start",
  exportLogs: "logs.export",
  exportDiagnostics: "diagnostics.export",
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
  "cores.check-update": undefined;
  "cores.repair": { coreId: string };
  "cores.move": { coreId: string };
  "resources.status": { coreId: string };
  "resources.check": { coreId: string };
  "resources.update": { coreId: string };
  "resources.rollback": { coreId: string; backupId: string };
  "stages.catalog": undefined;
  "devices.add": DeviceDraft;
  "devices.update": { id: string; patch: Partial<DeviceDraft> };
  "devices.remove": { id: string };
  "devices.connect": { id: string };
  "devices.disconnect": { id: string };
  "devices.screenshot": { id: string };
  "plans.save": { plan: TaskPlan };
  "plans.remove": { id: string };
  "plans.create": { deviceId: string; name: string };
  "plans.duplicate": { planId: string; name?: string };
  "plans.rename": { planId: string; name: string };
  "plans.import": { deviceId: string };
  "plans.export": { planId: string };
  "plans.set-active": { deviceId: string; planId: string };
  "copilot.import": undefined;
  "videos.pick": undefined;
  "copilot.resolve": { input: string };
  "copilot.detail": { filename: string };
  "copilot.search": {
    document?: string;
    operator?: string;
    uploaderId?: string;
    stage?: string;
    orderBy?: "hot" | "views" | "upload_time";
    desc?: boolean;
    page?: number;
    limit?: number;
    language?: "zh" | "en";
  };
  "copilot.sets": {
    keyword?: string;
    creatorId?: string;
    page?: number;
    limit?: number;
  };
  "copilot.set-items": { ids: ReadonlyArray<number> };
  "copilot.levels": { query: string };
  "copilot.operators": { query: string };
  "roguelike.operators": { theme: string };
  "operator.avatars": { ids: ReadonlyArray<string> };
  "copilot.options": Partial<CopilotOptions>;
  "copilot.items": { items: ReadonlyArray<CopilotItem> };
  "copilot.start": { deviceId: string; itemId?: string };
  "runs.start": { deviceId: string; planId: string };
  "runs.stop": { deviceId: string };
  "runs.history": undefined;
  "runs.clear": undefined;
  "schedules.save": { schedule: Schedule };
  "tools.recruitment": undefined;
  "tools.start": { deviceId: string; kind: ToolKind };
  "logs.export": { entries: ReadonlyArray<LogEntry> };
  "diagnostics.export": { entries: ReadonlyArray<LogEntry> };
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
  "cores.check-update": CoreReleaseCheck;
  "cores.repair": ReadonlyArray<CoreInfo>;
  "cores.move": ReadonlyArray<CoreInfo>;
  "resources.status": ResourceStatus;
  "resources.check": ResourceCheck;
  "resources.update": ResourceApplyResult;
  "resources.rollback": ResourceApplyResult;
  "stages.catalog": StageCatalog;
  "devices.add": DeviceView;
  "devices.update": DeviceView;
  "devices.remove": ReadonlyArray<DeviceView>;
  "devices.connect": DeviceView;
  "devices.disconnect": DeviceView;
  "devices.screenshot": Screenshot;
  "plans.save": TaskPlan;
  "plans.remove": ReadonlyArray<TaskPlan>;
  "plans.create": TaskPlan;
  "plans.duplicate": TaskPlan;
  "plans.rename": TaskPlan;
  "plans.import": TaskPlan | null;
  "plans.export": string | null;
  "plans.set-active": DeviceView;
  "copilot.import": CopilotFile | null;
  "videos.pick": string | null;
  "copilot.resolve": CopilotResolveResult;
  "copilot.detail": CopilotDetail | null;
  "copilot.search": CopilotSearchResult;
  "copilot.sets": CopilotSetSearchResult;
  "copilot.set-items": ReadonlyArray<CopilotSearchItem>;
  "copilot.levels": ReadonlyArray<CopilotLevel>;
  "copilot.operators": ReadonlyArray<OperatorEntry>;
  "roguelike.operators": ReadonlyArray<RoguelikeOperator>;
  "operator.avatars": ReadonlyArray<OperatorAvatar>;
  "copilot.options": CopilotSetup;
  "copilot.items": CopilotSetup;
  "copilot.start": RunSnapshot;
  "runs.start": RunSnapshot;
  "runs.stop": RunSnapshot;
  "runs.history": RunHistory;
  "runs.clear": RunHistory;
  "schedules.save": ReadonlyArray<Schedule>;
  "tools.recruitment": RecruitmentData;
  "tools.start": RunSnapshot;
  "logs.export": string | null;
  "diagnostics.export": string | null;
}

export interface MaaxBridge {
  invoke(command: string, payload: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
}
