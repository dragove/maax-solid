import { Schema } from "effect";

/**
 * Shared contracts between the Electron main process and the sandboxed
 * renderer. Everything that crosses the contextBridge boundary is decoded on
 * both sides; TypeScript types are derived from these schemas rather than
 * declared twice.
 */

/* -------------------------------------------------------------------------- */
/* Runtime + preferences                                                      */
/* -------------------------------------------------------------------------- */

export const RuntimeInfoSchema = Schema.Struct({
  app: Schema.Struct({
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
    packaged: Schema.Boolean,
    locale: Schema.NonEmptyString,
  }),
  versions: Schema.Struct({
    electron: Schema.NonEmptyString,
    chromium: Schema.NonEmptyString,
    node: Schema.NonEmptyString,
    v8: Schema.NonEmptyString,
  }),
  system: Schema.Struct({
    platform: Schema.NonEmptyString,
    arch: Schema.NonEmptyString,
    release: Schema.NonEmptyString,
    cpuCount: Schema.Int.check(Schema.isGreaterThan(0)),
    totalMemoryBytes: Schema.Int.check(Schema.isGreaterThan(0)),
    timezone: Schema.NonEmptyString,
  }),
  security: Schema.Struct({
    sandbox: Schema.Boolean,
    contextIsolation: Schema.Boolean,
    nodeIntegration: Schema.Boolean,
  }),
});
export type RuntimeInfo = Schema.Schema.Type<typeof RuntimeInfoSchema>;

export const ThemeSchema = Schema.Literals(["dark", "light", "system"]);
export type Theme = Schema.Schema.Type<typeof ThemeSchema>;

export const LocaleSchema = Schema.Literals(["zh-CN", "en-US"]);
export type Locale = Schema.Schema.Type<typeof LocaleSchema>;

export const ClientTypeSchema = Schema.Literals(["Official", "Bilibili", "txwy", "YoStarEN", "YoStarJP", "YoStarKR"]);
export type ClientType = Schema.Schema.Type<typeof ClientTypeSchema>;

export const TouchModeSchema = Schema.Literals(["minitouch", "maatouch", "adb"]);
export type TouchMode = Schema.Schema.Type<typeof TouchModeSchema>;

export const AppSettingsSchema = Schema.Struct({
  theme: ThemeSchema,
  locale: LocaleSchema,
  activeCoreId: Schema.optional(Schema.String),
  adbPath: Schema.String,
  clientType: ClientTypeSchema,
  touchMode: TouchModeSchema,
  connectionConfig: Schema.String,
  confirmBeforeDownload: Schema.Boolean,
  notifyOnComplete: Schema.Boolean,
  developerMode: Schema.Boolean,
});
export type AppSettings = Schema.Schema.Type<typeof AppSettingsSchema>;

export const AppSettingsPatchSchema = Schema.Struct({
  theme: Schema.optional(ThemeSchema),
  locale: Schema.optional(LocaleSchema),
  activeCoreId: Schema.optional(Schema.NullOr(Schema.String)),
  adbPath: Schema.optional(Schema.String),
  clientType: Schema.optional(ClientTypeSchema),
  touchMode: Schema.optional(TouchModeSchema),
  connectionConfig: Schema.optional(Schema.String),
  confirmBeforeDownload: Schema.optional(Schema.Boolean),
  notifyOnComplete: Schema.optional(Schema.Boolean),
  developerMode: Schema.optional(Schema.Boolean),
});
export type AppSettingsPatch = Schema.Schema.Type<typeof AppSettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  locale: "zh-CN",
  adbPath: "",
  clientType: "Official",
  touchMode: "maatouch",
  connectionConfig: "General",
  confirmBeforeDownload: true,
  notifyOnComplete: true,
  developerMode: false,
};

/* -------------------------------------------------------------------------- */
/* Core versions                                                              */
/* -------------------------------------------------------------------------- */

export const CoreSourceSchema = Schema.Literals(["download", "import", "development"]);
export type CoreSource = Schema.Schema.Type<typeof CoreSourceSchema>;

export const CoreChannelSchema = Schema.Literals(["stable", "beta", "alpha", "local"]);
export type CoreChannel = Schema.Schema.Type<typeof CoreChannelSchema>;

export const CoreStatusSchema = Schema.Literals(["ready", "missing", "broken"]);
export type CoreStatus = Schema.Schema.Type<typeof CoreStatusSchema>;

export const CoreInfoSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  version: Schema.String,
  channel: CoreChannelSchema,
  source: CoreSourceSchema,
  root: Schema.NonEmptyString,
  libPath: Schema.NonEmptyString,
  resourcePath: Schema.NonEmptyString,
  managed: Schema.Boolean,
  status: CoreStatusSchema,
  sizeBytes: Schema.optional(Schema.Finite),
  /** `resource/version.json` → `last_updated`, absent when unreadable. */
  resourceStamp: Schema.optional(Schema.String),
});
export type CoreInfo = Schema.Schema.Type<typeof CoreInfoSchema>;

/* -------------------------------------------------------------------------- */
/* Resource updates                                                           */
/* -------------------------------------------------------------------------- */

export const CoreReleaseCheckSchema = Schema.Struct({
  current: Schema.optional(Schema.String),
  latest: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.Finite),
  sizeBytes: Schema.optional(Schema.Finite),
  available: Schema.Boolean,
});
export type CoreReleaseCheck = Schema.Schema.Type<typeof CoreReleaseCheckSchema>;

export const ResourceBackupSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  stamp: Schema.String,
  createdAt: Schema.Finite,
  files: Schema.Int,
  bytes: Schema.Finite,
});
export type ResourceBackup = Schema.Schema.Type<typeof ResourceBackupSchema>;

export const ResourceStatusSchema = Schema.Struct({
  coreId: Schema.NonEmptyString,
  stamp: Schema.optional(Schema.String),
  backups: Schema.Array(ResourceBackupSchema),
});
export type ResourceStatus = Schema.Schema.Type<typeof ResourceStatusSchema>;

export const ResourceCheckSchema = Schema.Struct({
  coreId: Schema.NonEmptyString,
  local: Schema.optional(Schema.String),
  remote: Schema.optional(Schema.String),
  available: Schema.Boolean,
});
export type ResourceCheck = Schema.Schema.Type<typeof ResourceCheckSchema>;

export const CopilotFileSchema = Schema.Struct({
  filename: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type CopilotFile = Schema.Schema.Type<typeof CopilotFileSchema>;

/**
 * One entry of a copilot batch. Normal and raid runs of the same assignment are
 * two entries sharing a file but differing in `isRaid`.
 */
export const CopilotItemSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  copilotId: Schema.Finite,
  filename: Schema.NonEmptyString,
  stage: Schema.String,
  title: Schema.String,
  isRaid: Schema.Boolean,
});
export type CopilotItem = Schema.Schema.Type<typeof CopilotItemSchema>;

export const CopilotOperatorSchema = Schema.Struct({
  name: Schema.String,
  role: Schema.String,
  skill: Schema.Int,
  elite: Schema.optional(Schema.Int),
  level: Schema.optional(Schema.Int),
  module: Schema.optional(Schema.Int),
  potential: Schema.optional(Schema.Int),
});
export type CopilotOperator = Schema.Schema.Type<typeof CopilotOperatorSchema>;

export const CopilotSearchItemSchema = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  details: Schema.String,
  stage: Schema.String,
  /** Display code from the level catalogue, empty when unknown. */
  stageCode: Schema.String,
  difficulty: Schema.Int,
  operators: Schema.Array(CopilotOperatorSchema),
  uploader: Schema.String,
  uploaderId: Schema.String,
  views: Schema.Finite,
  hotScore: Schema.Finite,
  ratingLevel: Schema.Int,
  minimumRequired: Schema.String,
});
export type CopilotSearchItem = Schema.Schema.Type<typeof CopilotSearchItemSchema>;

export const CopilotSearchResultSchema = Schema.Struct({
  page: Schema.Int,
  total: Schema.Int,
  hasNext: Schema.Boolean,
  items: Schema.Array(CopilotSearchItemSchema),
});
export type CopilotSearchResult = Schema.Schema.Type<typeof CopilotSearchResultSchema>;

export const OperatorEntrySchema = Schema.Struct({
  id: Schema.String,
  /** Chinese name; this is what the PRTS `operator` filter expects. */
  name: Schema.String,
  nameEn: Schema.String,
  rarity: Schema.Int,
  profession: Schema.String,
});
export type OperatorEntry = Schema.Schema.Type<typeof OperatorEntrySchema>;

export const CopilotLevelSchema = Schema.Struct({
  stageId: Schema.NonEmptyString,
  code: Schema.String,
  name: Schema.String,
  category: Schema.String,
});
export type CopilotLevel = Schema.Schema.Type<typeof CopilotLevelSchema>;

export const CopilotOptionsSchema = Schema.Struct({
  formation: Schema.Boolean,
  addTrust: Schema.Boolean,
  ignoreRequirements: Schema.Boolean,
  useSanityPotion: Schema.Boolean,
  supportUnitUsage: Schema.Int,
  loopTimes: Schema.Int,
  formationIndex: Schema.Int,
});
export type CopilotOptions = Schema.Schema.Type<typeof CopilotOptionsSchema>;

export const DEFAULT_COPILOT_OPTIONS: CopilotOptions = {
  formation: true,
  addTrust: false,
  ignoreRequirements: false,
  useSanityPotion: false,
  supportUnitUsage: 0,
  loopTimes: 1,
  formationIndex: 0,
};

export const CopilotSetupSchema = Schema.Struct({
  items: Schema.Array(CopilotItemSchema),
  options: CopilotOptionsSchema,
});
export type CopilotSetup = Schema.Schema.Type<typeof CopilotSetupSchema>;

export const DEFAULT_COPILOT_SETUP: CopilotSetup = {
  items: [],
  options: DEFAULT_COPILOT_OPTIONS,
};

export const CopilotResolveResultSchema = Schema.Struct({
  kind: Schema.Literals(["single", "set"]),
  title: Schema.String,
  items: Schema.Array(CopilotItemSchema),
});
export type CopilotResolveResult = Schema.Schema.Type<typeof CopilotResolveResultSchema>;

export const ResourceApplyResultSchema = Schema.Struct({
  coreId: Schema.NonEmptyString,
  stamp: Schema.String,
  files: Schema.Int,
  bytes: Schema.Finite,
  backupId: Schema.optional(Schema.String),
});
export type ResourceApplyResult = Schema.Schema.Type<typeof ResourceApplyResultSchema>;

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

export const DeviceProfileSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  address: Schema.NonEmptyString,
  adbPath: Schema.String,
  config: Schema.String,
  clientType: ClientTypeSchema,
  remark: Schema.String,
  uuid: Schema.optional(Schema.String),
  activePlanId: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
  lastConnectedAt: Schema.optional(Schema.Finite),
});
export type DeviceProfile = Schema.Schema.Type<typeof DeviceProfileSchema>;

export const DeviceDraftSchema = Schema.Struct({
  name: Schema.String,
  address: Schema.NonEmptyString,
  adbPath: Schema.String,
  config: Schema.String,
  clientType: ClientTypeSchema,
  remark: Schema.String,
});
export type DeviceDraft = Schema.Schema.Type<typeof DeviceDraftSchema>;

export const DeviceUpdateSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  patch: Schema.Struct({
    name: Schema.optional(Schema.String),
    address: Schema.optional(Schema.NonEmptyString),
    adbPath: Schema.optional(Schema.String),
    config: Schema.optional(Schema.String),
    clientType: Schema.optional(ClientTypeSchema),
    remark: Schema.optional(Schema.String),
  }),
});
export type DeviceUpdate = Schema.Schema.Type<typeof DeviceUpdateSchema>;

export const DeviceStatusSchema = Schema.Literals(["offline", "connecting", "online", "running", "error"]);
export type DeviceStatus = Schema.Schema.Type<typeof DeviceStatusSchema>;

export const ResolutionSchema = Schema.Struct({
  width: Schema.Int,
  height: Schema.Int,
});

export const ScreencapCostSchema = Schema.Struct({
  min: Schema.Finite,
  avg: Schema.Finite,
  max: Schema.Finite,
});
export type ScreencapCost = Schema.Schema.Type<typeof ScreencapCostSchema>;
export type Resolution = Schema.Schema.Type<typeof ResolutionSchema>;

export const DeviceViewSchema = Schema.Struct({
  profile: DeviceProfileSchema,
  status: DeviceStatusSchema,
  engineVersion: Schema.optional(Schema.String),
  resolution: Schema.optional(ResolutionSchema),
  screencapCost: Schema.optional(ScreencapCostSchema),
  lastError: Schema.optional(Schema.String),
});
export type DeviceView = Schema.Schema.Type<typeof DeviceViewSchema>;

/* -------------------------------------------------------------------------- */
/* Task plans                                                                 */
/* -------------------------------------------------------------------------- */

export const TaskTypeSchema = Schema.Literals([
  "StartUp",
  "Fight",
  "Recruit",
  "Infrast",
  "Mall",
  "Award",
  "Copilot",
  "SSSCopilot",
  "ParadoxCopilot",
  "Depot",
  "OperBox",
  "Custom",
  "CloseDown",
]);
export type TaskType = Schema.Schema.Type<typeof TaskTypeSchema>;

export const TaskConfigSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  type: TaskTypeSchema,
  enabled: Schema.Boolean,
  name: Schema.String,
  params: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Finite,
});
export type TaskConfig = Schema.Schema.Type<typeof TaskConfigSchema>;

export const TaskPlanSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  tasks: Schema.Array(TaskConfigSchema),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
});
export type TaskPlan = Schema.Schema.Type<typeof TaskPlanSchema>;

/* -------------------------------------------------------------------------- */
/* Engine + runs                                                              */
/* -------------------------------------------------------------------------- */

export const EnginePhaseSchema = Schema.Literals(["idle", "starting", "ready", "running", "crashed", "stopped"]);
export type EnginePhase = Schema.Schema.Type<typeof EnginePhaseSchema>;

export const EngineInfoSchema = Schema.Struct({
  phase: EnginePhaseSchema,
  coreId: Schema.optional(Schema.String),
  coreVersion: Schema.optional(Schema.String),
  sessionCount: Schema.Int,
  message: Schema.optional(Schema.String),
});
export type EngineInfo = Schema.Schema.Type<typeof EngineInfoSchema>;

export const DEFAULT_ENGINE_INFO: EngineInfo = {
  phase: "idle",
  sessionCount: 0,
};

export const RunStatusSchema = Schema.Literals(["idle", "preparing", "running", "completed", "stopped", "failed"]);
export type RunStatus = Schema.Schema.Type<typeof RunStatusSchema>;

export const RunTaskStatusSchema = Schema.Literals(["pending", "running", "completed", "stopped", "failed"]);
export type RunTaskStatus = Schema.Schema.Type<typeof RunTaskStatusSchema>;

export const RunTaskStateSchema = Schema.Struct({
  taskId: Schema.Finite,
  configId: Schema.String,
  type: TaskTypeSchema,
  name: Schema.String,
  status: RunTaskStatusSchema,
  startedAt: Schema.optional(Schema.Finite),
  endedAt: Schema.optional(Schema.Finite),
  message: Schema.optional(Schema.String),
});
export type RunTaskState = Schema.Schema.Type<typeof RunTaskStateSchema>;

export const RunSnapshotSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  /** Absent for a standalone run such as the copilot tab. */
  planId: Schema.optional(Schema.NonEmptyString),
  status: RunStatusSchema,
  startedAt: Schema.Finite,
  endedAt: Schema.optional(Schema.Finite),
  tasks: Schema.Array(RunTaskStateSchema),
  currentTaskId: Schema.optional(Schema.Finite),
  message: Schema.optional(Schema.String),
});
export type RunSnapshot = Schema.Schema.Type<typeof RunSnapshotSchema>;

/* -------------------------------------------------------------------------- */
/* Bootstrap + live events                                                    */
/* -------------------------------------------------------------------------- */

export const BootstrapSchema = Schema.Struct({
  runtime: RuntimeInfoSchema,
  settings: AppSettingsSchema,
  cores: Schema.Array(CoreInfoSchema),
  devices: Schema.Array(DeviceViewSchema),
  plans: Schema.Array(TaskPlanSchema),
  engine: EngineInfoSchema,
  copilot: CopilotSetupSchema,
});
export type Bootstrap = Schema.Schema.Type<typeof BootstrapSchema>;

export const CoreCallbackEventSchema = Schema.TaggedStruct("core-callback", {
  sessionId: Schema.String,
  deviceId: Schema.String,
  msg: Schema.Int,
  payload: Schema.Unknown,
  raw: Schema.String,
  at: Schema.Finite,
});
export type CoreCallbackEvent = Schema.Schema.Type<typeof CoreCallbackEventSchema>;

export const RunUpdatedEventSchema = Schema.TaggedStruct("run-updated", {
  run: RunSnapshotSchema,
});
export const DeviceUpdatedEventSchema = Schema.TaggedStruct("device-updated", {
  device: DeviceViewSchema,
});
export const EngineUpdatedEventSchema = Schema.TaggedStruct("engine-updated", {
  engine: EngineInfoSchema,
});
export const CoresUpdatedEventSchema = Schema.TaggedStruct("cores-updated", {
  cores: Schema.Array(CoreInfoSchema),
});
export const PlansUpdatedEventSchema = Schema.TaggedStruct("plans-updated", {
  plans: Schema.Array(TaskPlanSchema),
});
export const CopilotUpdatedEventSchema = Schema.TaggedStruct("copilot-updated", {
  copilot: CopilotSetupSchema,
});
export const SettingsUpdatedEventSchema = Schema.TaggedStruct("settings-updated", {
  settings: AppSettingsSchema,
});
export const LogEventSchema = Schema.TaggedStruct("log", {
  level: Schema.Literals(["debug", "info", "warn", "error"]),
  message: Schema.String,
  at: Schema.Finite,
});
export const ToastEventSchema = Schema.TaggedStruct("toast", {
  kind: Schema.Literals(["info", "success", "warning", "error"]),
  title: Schema.String,
  message: Schema.optional(Schema.String),
});
export const DownloadProgressEventSchema = Schema.TaggedStruct("download-progress", {
  phase: Schema.Literals(["metadata", "downloading", "extracting", "installing", "done", "failed"]),
  received: Schema.Finite,
  total: Schema.Finite,
  message: Schema.optional(Schema.String),
  /** Which operation the bar belongs to; the renderer keeps two bars. */
  source: Schema.optional(Schema.Literals(["core", "resource"])),
});

export type DownloadProgress = Schema.Schema.Type<typeof DownloadProgressEventSchema>;

export const MaaxEventSchema = Schema.Union([
  CoreCallbackEventSchema,
  RunUpdatedEventSchema,
  DeviceUpdatedEventSchema,
  EngineUpdatedEventSchema,
  CoresUpdatedEventSchema,
  PlansUpdatedEventSchema,
  CopilotUpdatedEventSchema,
  SettingsUpdatedEventSchema,
  LogEventSchema,
  ToastEventSchema,
  DownloadProgressEventSchema,
]);
export type MaaxEvent = Schema.Schema.Type<typeof MaaxEventSchema>;

/* -------------------------------------------------------------------------- */
/* IPC envelope                                                               */
/* -------------------------------------------------------------------------- */

export const IpcErrorSchema = Schema.Struct({
  tag: Schema.String,
  message: Schema.String,
  detail: Schema.optional(Schema.String),
});
export type IpcError = Schema.Schema.Type<typeof IpcErrorSchema>;

export const IpcSuccessSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Unknown,
});

export const IpcFailureSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: IpcErrorSchema,
});

export const IpcEnvelopeSchema = Schema.Union([IpcSuccessSchema, IpcFailureSchema]);
export type IpcEnvelope = Schema.Schema.Type<typeof IpcEnvelopeSchema>;

export const StageCatalogEntrySchema = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  group: Schema.String,
  groupLabel: Schema.String,
  tip: Schema.optional(Schema.String),
});
export type StageCatalogEntry = Schema.Schema.Type<typeof StageCatalogEntrySchema>;

export const StageCatalogSchema = Schema.Struct({
  entries: Schema.Array(StageCatalogEntrySchema),
  updatedAt: Schema.Finite,
  warning: Schema.optional(Schema.String),
});
export type StageCatalog = Schema.Schema.Type<typeof StageCatalogSchema>;

export const ScreenshotSchema = Schema.Struct({
  png: Schema.Uint8Array,
  width: Schema.Int,
  height: Schema.Int,
  durationMs: Schema.Finite,
});
export type Screenshot = Schema.Schema.Type<typeof ScreenshotSchema>;
