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
  closeToTray: Schema.Boolean,
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
  closeToTray: Schema.optional(Schema.Boolean),
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
  closeToTray: false,
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

/** The three MaaCore copilot task families. */
export const CopilotKindSchema = Schema.Literals(["normal", "sss", "paradox"]);
export type CopilotKind = Schema.Schema.Type<typeof CopilotKindSchema>;

/** Which difficulties one batch row will attempt; both may be checked. */
export const CopilotModeSelectionSchema = Schema.Struct({
  normal: Schema.Boolean,
  raid: Schema.Boolean,
});
export type CopilotModeSelection = Schema.Schema.Type<typeof CopilotModeSelectionSchema>;

/**
 * One entry of a copilot batch, one row per downloaded file.
 *
 * A normal assignment carries the difficulties it should run in; both unchecked
 * means the row is skipped. `isRaid` and `enabled` only exist so batches saved
 * before the two checkboxes still decode — the helpers in `copilot-mode` fold
 * them into `modes` and normalise the row on the way in.
 *
 * `kind` is optional so a batch saved before type detection still decodes as
 * a normal assignment. SSS and paradox rows keep the plain `enabled` switch.
 */
export const CopilotItemSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  copilotId: Schema.Finite,
  filename: Schema.NonEmptyString,
  stage: Schema.String,
  title: Schema.String,
  modes: Schema.optional(CopilotModeSelectionSchema),
  /** Retired single-mode flag, folded into `modes`. */
  isRaid: Schema.optional(Schema.Boolean),
  kind: Schema.optional(CopilotKindSchema),
  /** SSS/paradox switch; a retired normal row uses it only for migration. */
  enabled: Schema.optional(Schema.Boolean),
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

/** An interchangeable operator group; any listed candidate satisfies it. */
export const CopilotGroupSchema = Schema.Struct({
  name: Schema.String,
  operators: Schema.Array(CopilotOperatorSchema),
});
export type CopilotGroup = Schema.Schema.Type<typeof CopilotGroupSchema>;

/**
 * What a downloaded assignment file carries besides its batch entry: the
 * author's notes, fixed operators, alternative groups and the minimum MaaCore
 * version. Kept separate from `CopilotSearchItem` because it comes from the
 * local JSON, not from a PRTS search response.
 */
export const CopilotDetailSchema = Schema.Struct({
  details: Schema.String,
  operators: Schema.Array(CopilotOperatorSchema),
  groups: Schema.Array(CopilotGroupSchema),
  minimumRequired: Schema.String,
});
export type CopilotDetail = Schema.Schema.Type<typeof CopilotDetailSchema>;

export const CopilotSearchItemSchema = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  details: Schema.String,
  stage: Schema.String,
  /** Display code from the level catalogue, empty when unknown. */
  stageCode: Schema.String,
  difficulty: Schema.Int,
  operators: Schema.Array(CopilotOperatorSchema),
  groups: Schema.Array(CopilotGroupSchema),
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

/** One PRTS copilot set; the ids are ordered and each is fetched separately. */
export const CopilotSetSchema = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  description: Schema.String,
  creator: Schema.String,
  creatorId: Schema.String,
  copilotIds: Schema.Array(Schema.Finite),
  createTime: Schema.String,
  updateTime: Schema.String,
});
export type CopilotSet = Schema.Schema.Type<typeof CopilotSetSchema>;

export const CopilotSetSearchResultSchema = Schema.Struct({
  total: Schema.Int,
  hasNext: Schema.Boolean,
  items: Schema.Array(CopilotSetSchema),
});
export type CopilotSetSearchResult = Schema.Schema.Type<typeof CopilotSetSearchResultSchema>;

export const OperatorEntrySchema = Schema.Struct({
  id: Schema.String,
  /** Chinese name; this is what the PRTS `operator` filter expects. */
  name: Schema.String,
  nameEn: Schema.String,
  rarity: Schema.Int,
  profession: Schema.String,
});
export type OperatorEntry = Schema.Schema.Type<typeof OperatorEntrySchema>;

/**
 * One operator offered by the Roguelike starting-operator picker: the catalogue
 * entry plus whether MAA recommends it for the current theme's opening.
 */
export const RoguelikeOperatorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  nameEn: Schema.String,
  rarity: Schema.Int,
  profession: Schema.String,
  recommended: Schema.Boolean,
});
export type RoguelikeOperator = Schema.Schema.Type<typeof RoguelikeOperatorSchema>;

/** A downscaled avatar from the active core's `resource/template/avatar`. */
export const OperatorAvatarSchema = Schema.Struct({
  id: Schema.String,
  dataUrl: Schema.String,
});
export type OperatorAvatar = Schema.Schema.Type<typeof OperatorAvatarSchema>;

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
  "Roguelike",
  "Reclamation",
  "Copilot",
  "SSSCopilot",
  "ParadoxCopilot",
  "Depot",
  "OperBox",
  "Custom",
  "SingleStep",
  "VideoRecognition",
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
/* Run history + schedules                                                     */
/* -------------------------------------------------------------------------- */

export const RunHistoryTaskSchema = Schema.Struct({
  type: TaskTypeSchema,
  name: Schema.String,
  status: RunTaskStatusSchema,
  startedAt: Schema.optional(Schema.Finite),
  endedAt: Schema.optional(Schema.Finite),
});
export type RunHistoryTask = Schema.Schema.Type<typeof RunHistoryTaskSchema>;

export const RunHistoryEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  deviceName: Schema.String,
  planId: Schema.optional(Schema.NonEmptyString),
  planName: Schema.optional(Schema.String),
  /** Terminal status only: completed, stopped or failed. */
  status: RunStatusSchema,
  startedAt: Schema.Finite,
  endedAt: Schema.Finite,
  tasks: Schema.Array(RunHistoryTaskSchema),
});
export type RunHistoryEntry = Schema.Schema.Type<typeof RunHistoryEntrySchema>;

export const RunDayStatSchema = Schema.Struct({
  /** Local calendar day, YYYY-MM-DD. */
  date: Schema.String,
  total: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int,
});
export type RunDayStat = Schema.Schema.Type<typeof RunDayStatSchema>;

export const RunTaskStatSchema = Schema.Struct({
  type: TaskTypeSchema,
  total: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int,
});
export type RunTaskStat = Schema.Schema.Type<typeof RunTaskStatSchema>;

export const RunStatsSchema = Schema.Struct({
  total: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int,
  stopped: Schema.Int,
  today: Schema.Int,
  totalDurationMs: Schema.Finite,
  byDay: Schema.Array(RunDayStatSchema),
  byTask: Schema.Array(RunTaskStatSchema),
});
export type RunStats = Schema.Schema.Type<typeof RunStatsSchema>;

export const RunHistorySchema = Schema.Struct({
  entries: Schema.Array(RunHistoryEntrySchema),
  stats: RunStatsSchema,
});
export type RunHistory = Schema.Schema.Type<typeof RunHistorySchema>;

/**
 * A daily schedule for one device. The main process checks it while it runs;
 * planId falls back to the device's active plan when absent.
 */
export const ScheduleSchema = Schema.Struct({
  deviceId: Schema.NonEmptyString,
  planId: Schema.optional(Schema.NonEmptyString),
  enabled: Schema.Boolean,
  /** Local time in 24h HH:mm form. */
  time: Schema.String,
  /** JavaScript weekday numbers: Sunday = 0. */
  weekdays: Schema.Array(Schema.Int),
  lastTriggeredAt: Schema.optional(Schema.Finite),
  lastStatus: Schema.optional(Schema.Literals(["started", "skipped", "failed"])),
  lastMessage: Schema.optional(Schema.String),
});
export type Schedule = Schema.Schema.Type<typeof ScheduleSchema>;

/* -------------------------------------------------------------------------- */
/* Tools: recruitment, operator box and depot                                 */
/* -------------------------------------------------------------------------- */

export const RecruitmentTagSchema = Schema.Struct({
  /** Chinese tag as stored in recruitment.json; also the key the game uses. */
  name: Schema.String,
  nameEn: Schema.String,
});
export type RecruitmentTag = Schema.Schema.Type<typeof RecruitmentTagSchema>;

export const RecruitmentOperatorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  nameEn: Schema.String,
  rarity: Schema.Int,
  tags: Schema.Array(Schema.String),
});
export type RecruitmentOperator = Schema.Schema.Type<typeof RecruitmentOperatorSchema>;

export const RecruitmentDataSchema = Schema.Struct({
  coreId: Schema.NonEmptyString,
  tags: Schema.Array(RecruitmentTagSchema),
  operators: Schema.Array(RecruitmentOperatorSchema),
  updatedAt: Schema.Finite,
});
export type RecruitmentData = Schema.Schema.Type<typeof RecruitmentDataSchema>;

export const OperBoxEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  nameEn: Schema.String,
  rarity: Schema.Int,
  own: Schema.Boolean,
  elite: Schema.optional(Schema.Int),
  level: Schema.optional(Schema.Int),
  potential: Schema.optional(Schema.Int),
});
export type OperBoxEntry = Schema.Schema.Type<typeof OperBoxEntrySchema>;

export const OperBoxSnapshotSchema = Schema.Struct({
  updatedAt: Schema.Finite,
  done: Schema.Boolean,
  entries: Schema.Array(OperBoxEntrySchema),
});
export type OperBoxSnapshot = Schema.Schema.Type<typeof OperBoxSnapshotSchema>;

export const DepotItemSchema = Schema.Struct({
  itemId: Schema.String,
  name: Schema.String,
  count: Schema.Int,
  group: Schema.String,
});
export type DepotItem = Schema.Schema.Type<typeof DepotItemSchema>;

export const DepotSnapshotSchema = Schema.Struct({
  updatedAt: Schema.Finite,
  done: Schema.Boolean,
  items: Schema.Array(DepotItemSchema),
});
export type DepotSnapshot = Schema.Schema.Type<typeof DepotSnapshotSchema>;

export const ToolSnapshotSchema = Schema.Struct({
  operbox: Schema.optional(OperBoxSnapshotSchema),
  depot: Schema.optional(DepotSnapshotSchema),
});
export type ToolSnapshot = Schema.Schema.Type<typeof ToolSnapshotSchema>;

export const ToolsStateSchema = Schema.Record(Schema.String, ToolSnapshotSchema);
export type ToolsState = Schema.Schema.Type<typeof ToolsStateSchema>;

export const ToolKindSchema = Schema.Literals(["operbox", "depot"]);
export type ToolKind = Schema.Schema.Type<typeof ToolKindSchema>;

/* -------------------------------------------------------------------------- */
/* Logs + diagnostics                                                         */
/* -------------------------------------------------------------------------- */

export const LogEntrySchema = Schema.Struct({
  at: Schema.Finite,
  level: Schema.Literals(["debug", "info", "warn", "error", "success"]),
  message: Schema.String,
});
export type LogEntry = Schema.Schema.Type<typeof LogEntrySchema>;

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
  history: RunHistorySchema,
  schedules: Schema.Array(ScheduleSchema),
  tools: ToolsStateSchema,
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
export const HistoryUpdatedEventSchema = Schema.TaggedStruct("history-updated", {
  history: RunHistorySchema,
});
export const SchedulesUpdatedEventSchema = Schema.TaggedStruct("schedules-updated", {
  schedules: Schema.Array(ScheduleSchema),
});
export const ToolsUpdatedEventSchema = Schema.TaggedStruct("tools-updated", {
  deviceId: Schema.NonEmptyString,
  snapshot: ToolSnapshotSchema,
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
  HistoryUpdatedEventSchema,
  SchedulesUpdatedEventSchema,
  ToolsUpdatedEventSchema,
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
