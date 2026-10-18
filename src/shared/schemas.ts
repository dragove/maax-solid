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

export const ClientTypeSchema = Schema.Literals([
  "Official",
  "Bilibili",
  "txwy",
  "YoStarEN",
  "YoStarJP",
  "YoStarKR",
]);
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
  minimizeToTray: Schema.Boolean,
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
  minimizeToTray: Schema.optional(Schema.Boolean),
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
  minimizeToTray: false,
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
  sizeBytes: Schema.optional(Schema.Number),
});
export type CoreInfo = Schema.Schema.Type<typeof CoreInfoSchema>;

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
  createdAt: Schema.Number,
  lastConnectedAt: Schema.optional(Schema.Number),
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

export const DeviceStatusSchema = Schema.Literals([
  "offline",
  "connecting",
  "online",
  "running",
  "error",
]);
export type DeviceStatus = Schema.Schema.Type<typeof DeviceStatusSchema>;

export const ResolutionSchema = Schema.Struct({
  width: Schema.Int,
  height: Schema.Int,
});
export type Resolution = Schema.Schema.Type<typeof ResolutionSchema>;

export const DeviceViewSchema = Schema.Struct({
  profile: DeviceProfileSchema,
  status: DeviceStatusSchema,
  engineVersion: Schema.optional(Schema.String),
  resolution: Schema.optional(ResolutionSchema),
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
  "CloseDown",
]);
export type TaskType = Schema.Schema.Type<typeof TaskTypeSchema>;

export const TaskConfigSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  type: TaskTypeSchema,
  enabled: Schema.Boolean,
  name: Schema.String,
  params: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Number,
});
export type TaskConfig = Schema.Schema.Type<typeof TaskConfigSchema>;

export const TaskPlanSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  tasks: Schema.Array(TaskConfigSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type TaskPlan = Schema.Schema.Type<typeof TaskPlanSchema>;

/* -------------------------------------------------------------------------- */
/* Engine + runs                                                              */
/* -------------------------------------------------------------------------- */

export const EnginePhaseSchema = Schema.Literals([
  "idle",
  "starting",
  "ready",
  "running",
  "crashed",
  "stopped",
]);
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

export const RunStatusSchema = Schema.Literals([
  "idle",
  "preparing",
  "running",
  "completed",
  "stopped",
  "failed",
]);
export type RunStatus = Schema.Schema.Type<typeof RunStatusSchema>;

export const RunTaskStatusSchema = Schema.Literals([
  "pending",
  "running",
  "completed",
  "stopped",
  "failed",
]);
export type RunTaskStatus = Schema.Schema.Type<typeof RunTaskStatusSchema>;

export const RunTaskStateSchema = Schema.Struct({
  taskId: Schema.Number,
  configId: Schema.String,
  type: TaskTypeSchema,
  name: Schema.String,
  status: RunTaskStatusSchema,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
});
export type RunTaskState = Schema.Schema.Type<typeof RunTaskStateSchema>;

export const RunSnapshotSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  planId: Schema.NonEmptyString,
  status: RunStatusSchema,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  tasks: Schema.Array(RunTaskStateSchema),
  currentTaskId: Schema.optional(Schema.Number),
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
});
export type Bootstrap = Schema.Schema.Type<typeof BootstrapSchema>;

export const CoreCallbackEventSchema = Schema.TaggedStruct("core-callback", {
  sessionId: Schema.String,
  deviceId: Schema.String,
  msg: Schema.Int,
  payload: Schema.Unknown,
  raw: Schema.String,
  at: Schema.Number,
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
export const SettingsUpdatedEventSchema = Schema.TaggedStruct("settings-updated", {
  settings: AppSettingsSchema,
});
export const LogEventSchema = Schema.TaggedStruct("log", {
  level: Schema.Literals(["debug", "info", "warn", "error"]),
  message: Schema.String,
  at: Schema.Number,
});
export const ToastEventSchema = Schema.TaggedStruct("toast", {
  kind: Schema.Literals(["info", "success", "warning", "error"]),
  title: Schema.String,
  message: Schema.optional(Schema.String),
});
export const DownloadProgressEventSchema = Schema.TaggedStruct("download-progress", {
  phase: Schema.Literals(["metadata", "downloading", "extracting", "installing", "done", "failed"]),
  received: Schema.Number,
  total: Schema.Number,
  message: Schema.optional(Schema.String),
});

export type DownloadProgress = Schema.Schema.Type<typeof DownloadProgressEventSchema>;

export const MaaxEventSchema = Schema.Union([
  CoreCallbackEventSchema,
  RunUpdatedEventSchema,
  DeviceUpdatedEventSchema,
  EngineUpdatedEventSchema,
  CoresUpdatedEventSchema,
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

export const ScreenshotSchema = Schema.Struct({
  png: Schema.Uint8Array,
  width: Schema.Int,
  height: Schema.Int,
});
export type Screenshot = Schema.Schema.Type<typeof ScreenshotSchema>;
