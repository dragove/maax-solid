import { Context, Effect, Layer, Schema } from "effect";
import { BrowserWindow, Notification, app, dialog, nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  Bootstrap,
  CoreInfo,
  CopilotDetail,
  CopilotFile,
  CopilotItem,
  CopilotKind,
  CopilotLevel,
  CopilotOptions,
  CopilotResolveResult,
  CopilotSetup,
  OperatorAvatar,
  OperatorEntry,
  RoguelikeOperator,
  CopilotSearchItem,
  CopilotSearchResult,
  CopilotSetSearchResult,
  CoreReleaseCheck,
  DeviceDiscovery,
  DeviceDraft,
  DeviceProfile,
  DeviceStatus,
  DeviceView,
  EngineInfo,
  LogEntry,
  RecruitmentData,
  ScreencapCost,
  Resolution,
  ResourceApplyResult,
  ResourceCheck,
  ResourceStatus,
  RunHistory,
  RunHistoryEntry,
  RunSnapshot,
  Schedule,
  Screenshot,
  StageCatalog,
  StageCatalogEntry,
  TaskPlan,
  ToolKind,
  RuntimeInfo,
} from "../../shared/schemas";
import type { AppendTaskResult, ConnectResult, EngineCallback, InitResult } from "../../shared/engine";
import { TaskConfigSchema } from "../../shared/schemas";
import type { TaskConfig } from "../../shared/schemas";
import {
  buildMaaTaskParams,
  createCopilotRunTasks,
  createDefaultPlanTasks,
  createTask,
  firstMissingField,
} from "../../shared/tasks";
import { copilotSucceededEntries, type CopilotRunOutcome } from "../../shared/copilot-progress";
import {
  copilotItemActive,
  normalizeCopilotItem,
  unscheduleCopilotMode,
  withSingleMode,
  type CopilotMode,
} from "../../shared/copilot-mode";
import { scheduleDue } from "../../shared/schedule";
import { setWindowBehavior } from "../app-behavior";
import { completeTask, failTask, finishSnapshot, runCallbackAction, startTask } from "../run-projection";
import { discoverAdbDevices, probeAdbConnection, releaseAdbServer, resolveAdbPath } from "./adb";

const STAGE_ACTIVITY_URL = "https://api.maa.plus/MaaAssistantArknights/api/gui/StageActivityV2.json";

const ActivityInfoSchema = Schema.Struct({
  Tip: Schema.optional(Schema.String),
  StageName: Schema.optional(Schema.String),
  UtcStartTime: Schema.optional(Schema.String),
  UtcExpireTime: Schema.optional(Schema.String),
  TimeZone: Schema.optional(Schema.Finite),
});
const ActivityStageSchema = Schema.Struct({
  Display: Schema.optional(Schema.String),
  Value: Schema.optional(Schema.String),
  Drop: Schema.optional(Schema.String),
});
const SideStorySchema = Schema.Struct({
  MinimumRequired: Schema.optional(Schema.String),
  Activity: Schema.optional(ActivityInfoSchema),
  Stages: Schema.optional(Schema.Array(ActivityStageSchema)),
});
const StageActivityResponseSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ sideStoryStage: Schema.optional(Schema.Record(Schema.String, SideStorySchema)) }),
);
type StageActivityData = Schema.Schema.Type<typeof StageActivityResponseSchema>;

const parseActivityDate = (value: string | undefined, timeZone: number | undefined): number => {
  if (!value) return 0;
  const normalized = value.replaceAll("/", "-").replace(" ", "T");
  const zone = typeof timeZone === "number" ? timeZone : 8;
  const offset = `${zone >= 0 ? "+" : "-"}${String(Math.abs(zone)).padStart(2, "0")}:00`;
  const parsed = Date.parse(`${normalized}${offset}`);
  return Number.isFinite(parsed) ? parsed : 0;
};

const permanentStageEntries = (locale: string): ReadonlyArray<StageCatalogEntry> => {
  const zh = locale === "zh-CN";
  const group = {
    recommended: zh ? "推荐" : "Recommended",
    resource: zh ? "资源关卡" : "Resource stages",
    annihilation: zh ? "剿灭作战" : "Annihilation",
  };
  const entry = (value: string, label: string, groupLabel: string, tip?: string): StageCatalogEntry => ({
    value,
    label,
    group: groupLabel,
    groupLabel,
    ...(tip ? { tip } : {}),
  });

  return [
    entry(
      "",
      zh ? "当前 / 上次关卡" : "Current / last stage",
      group.recommended,
      zh ? "留空则识别游戏当前或上次关卡" : "Leave empty to use the current or last stage",
    ),
    entry("1-7", "1-7", group.recommended),
    entry("R8-11", "R8-11", group.recommended),
    entry("12-17-HARD", "12-17-HARD", group.recommended),
    entry("CE-6", "CE-6", group.resource, zh ? "龙门币" : "LMD"),
    entry("LS-6", "LS-6", group.resource, zh ? "经验" : "EXP"),
    entry("CA-5", "CA-5", group.resource, zh ? "技能" : "Skill summaries"),
    entry("AP-5", "AP-5", group.resource, zh ? "采购凭证" : "Purchase certificates"),
    entry("SK-5", "SK-5", group.resource, zh ? "碳" : "Carbon"),
    entry("PR-A-1", "PR-A-1", group.resource, zh ? "术师/近卫芯片" : "Caster/Guard chips"),
    entry("PR-A-2", "PR-A-2", group.resource, zh ? "术师/近卫芯片" : "Caster/Guard chips"),
    entry("PR-B-1", "PR-B-1", group.resource, zh ? "狙击/重装芯片" : "Sniper/Defender chips"),
    entry("PR-B-2", "PR-B-2", group.resource, zh ? "狙击/重装芯片" : "Sniper/Defender chips"),
    entry("PR-C-1", "PR-C-1", group.resource, zh ? "医疗/辅助芯片" : "Medic/Supporter chips"),
    entry("PR-C-2", "PR-C-2", group.resource, zh ? "医疗/辅助芯片" : "Medic/Supporter chips"),
    entry("PR-D-1", "PR-D-1", group.resource, zh ? "先锋/特种芯片" : "Vanguard/Specialist chips"),
    entry("PR-D-2", "PR-D-2", group.resource, zh ? "先锋/特种芯片" : "Vanguard/Specialist chips"),
    entry("Annihilation", "Annihilation", group.annihilation, zh ? "当前剿灭" : "Current annihilation"),
    entry("Chernobog@Annihilation", "Chernobog", group.annihilation),
    entry("LungmenOutskirts@Annihilation", "Lungmen Outskirts", group.annihilation),
    entry("LungmenDowntown@Annihilation", "Lungmen Downtown", group.annihilation),
  ];
};

const clientKeyFor = (clientType: string): string => (clientType === "Bilibili" ? "Official" : clientType);

interface StageCache {
  readonly key: string;
  readonly at: number;
  readonly catalog: StageCatalog;
}
import { CoreHostClient } from "../core-host-client";
import { repairCopilotFile, type CopilotSearchParams, type CopilotSetSearchParams } from "./copilot";
import { CoreRegistry } from "./core-registry";
import { CoreInstaller } from "./core-installer";
import { maaxError, type MaaxError } from "../errors";
import { EventBus } from "../events";
import { AppPaths } from "./paths";
import { CopilotSetupStore } from "./copilot-setup";
import { OperatorCatalogue } from "./operator-catalog";
import {
  AVATAR_LIMIT,
  avatarPath,
  isAvatarId,
  mergeRoguelikeOperators,
  readStartingOperators,
} from "./roguelike-catalog";
import { PrtsLibrary } from "./prts-library";
import { ResourceUpdater, type ResourceProgress } from "./resource-updater";
import { RunHistory as RunHistoryService } from "./run-history";
import { ScheduleStore } from "./schedules";
import { Settings } from "./settings";
import { ToolData } from "./tool-data";
import { Workspace } from "./workspace";

interface HostEntry {
  readonly key: string;
  readonly core: CoreInfo;
  readonly server: string;
  readonly client: CoreHostClient;
  version: string;
  readonly devices: Set<string>;
}

interface RuntimeDevice {
  status: DeviceStatus;
  sessionId?: string;
  hostKey?: string;
  engineVersion?: string;
  resolution?: Resolution;
  screencapCost?: ScreencapCost;
  lastError?: string;
}

interface CopilotRunMeta {
  readonly items: ReadonlyArray<CopilotItem>;
  readonly kind: CopilotKind;
  /** Config ids in task order; maps a completed task back to its assignment. */
  readonly taskIds: ReadonlyArray<string>;
  lastLoaded: number;
}

interface RunState {
  snapshot: RunSnapshot;
  readonly taskConfigIds: Map<number, string>;
  readonly hostKey: string;
  /** Progress of a copilot tab run; absent for plans and other task families. */
  copilot?: CopilotRunMeta;
  /** Terminal snapshots are written to history once. */
  recorded?: boolean;
}

export interface ApplicationApi {
  readonly bootstrap: Effect.Effect<Bootstrap>;
  readonly getDevices: Effect.Effect<ReadonlyArray<DeviceView>>;
  readonly getPlans: Effect.Effect<ReadonlyArray<TaskPlan>>;
  readonly updateSettings: (patch: AppSettingsPatch) => Effect.Effect<AppSettings, MaaxError>;
  readonly addCore: (root: string) => Effect.Effect<CoreInfo, MaaxError>;
  readonly removeCore: (id: string) => Effect.Effect<ReadonlyArray<CoreInfo>, MaaxError>;
  readonly refreshCores: Effect.Effect<ReadonlyArray<CoreInfo>>;
  readonly downloadCore: Effect.Effect<CoreInfo | null, MaaxError>;
  readonly checkCoreUpdate: Effect.Effect<CoreReleaseCheck, MaaxError>;
  readonly repairCore: (id: string) => Effect.Effect<ReadonlyArray<CoreInfo>, MaaxError>;
  readonly moveCore: (id: string) => Effect.Effect<ReadonlyArray<CoreInfo>, MaaxError>;
  readonly setActiveCore: (
    id: string,
  ) => Effect.Effect<{ settings: AppSettings; cores: ReadonlyArray<CoreInfo> }, MaaxError>;
  readonly discoverDevices: (adbPath: string) => Effect.Effect<DeviceDiscovery>;
  readonly addDevice: (draft: DeviceDraft) => Effect.Effect<DeviceView, MaaxError>;
  readonly updateDevice: (id: string, patch: Partial<DeviceDraft>) => Effect.Effect<DeviceView, MaaxError>;
  readonly removeDevice: (id: string) => Effect.Effect<ReadonlyArray<DeviceView>>;
  readonly connectDevice: (id: string) => Effect.Effect<DeviceView, MaaxError>;
  readonly disconnectDevice: (id: string) => Effect.Effect<DeviceView, MaaxError>;
  readonly screenshotDevice: (id: string) => Effect.Effect<Screenshot, MaaxError>;
  readonly stageCatalog: Effect.Effect<StageCatalog>;
  readonly savePlan: (plan: TaskPlan) => Effect.Effect<TaskPlan, MaaxError>;
  readonly removePlan: (id: string) => Effect.Effect<ReadonlyArray<TaskPlan>>;
  readonly createPlan: (deviceId: string, name: string) => Effect.Effect<TaskPlan, MaaxError>;
  readonly duplicatePlan: (planId: string, name?: string) => Effect.Effect<TaskPlan, MaaxError>;
  readonly renamePlan: (planId: string, name: string) => Effect.Effect<TaskPlan, MaaxError>;
  readonly importPlan: (deviceId: string) => Effect.Effect<TaskPlan | null, MaaxError>;
  readonly exportPlan: (planId: string) => Effect.Effect<string | null, MaaxError>;
  readonly setActivePlan: (deviceId: string, planId: string) => Effect.Effect<DeviceView, MaaxError>;
  readonly importCopilotFile: Effect.Effect<CopilotFile | null, MaaxError>;
  readonly pickVideoFile: Effect.Effect<string | null, MaaxError>;
  readonly resolveCopilot: (input: string) => Effect.Effect<CopilotResolveResult, MaaxError>;
  readonly readCopilotDetail: (filename: string) => Effect.Effect<CopilotDetail | null>;
  readonly searchCopilot: (params: CopilotSearchParams) => Effect.Effect<CopilotSearchResult, MaaxError>;
  readonly copilotSetSearch: (params: CopilotSetSearchParams) => Effect.Effect<CopilotSetSearchResult, MaaxError>;
  readonly copilotSetItems: (ids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<CopilotSearchItem>, MaaxError>;
  readonly copilotLevels: (query: string) => Effect.Effect<ReadonlyArray<CopilotLevel>, MaaxError>;
  readonly copilotOperators: (query: string) => Effect.Effect<ReadonlyArray<OperatorEntry>, MaaxError>;
  readonly roguelikeOperators: (theme: string) => Effect.Effect<ReadonlyArray<RoguelikeOperator>>;
  readonly operatorAvatars: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<OperatorAvatar>>;
  readonly updateCopilotOptions: (patch: Partial<CopilotOptions>) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly setCopilotItems: (items: CopilotSetup["items"]) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly startCopilot: (deviceId: string, itemId?: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly startRun: (deviceId: string, planId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly stopRun: (deviceId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly runHistory: Effect.Effect<RunHistory>;
  readonly clearHistory: Effect.Effect<RunHistory>;
  readonly saveSchedule: (schedule: Schedule) => Effect.Effect<ReadonlyArray<Schedule>, MaaxError>;
  readonly recruitmentData: Effect.Effect<RecruitmentData, MaaxError>;
  readonly startTool: (deviceId: string, kind: ToolKind) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly exportLogs: (entries: ReadonlyArray<LogEntry>) => Effect.Effect<string | null, MaaxError>;
  readonly exportDiagnostics: (entries: ReadonlyArray<LogEntry>) => Effect.Effect<string | null, MaaxError>;
  readonly resourceStatus: (coreId: string) => Effect.Effect<ResourceStatus, MaaxError>;
  readonly checkResourceUpdate: (coreId: string) => Effect.Effect<ResourceCheck, MaaxError>;
  readonly updateResource: (coreId: string) => Effect.Effect<ResourceApplyResult, MaaxError>;
  readonly rollbackResource: (coreId: string, backupId: string) => Effect.Effect<ResourceApplyResult, MaaxError>;
  readonly shutdown: Effect.Effect<void>;
}

export class Application extends Context.Service<Application, ApplicationApi>()("maax/Application") {}

const readRuntimeInfo = (): RuntimeInfo => ({
  app: {
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    locale: app.getLocale(),
  },
  versions: {
    electron: process.versions.electron ?? "unknown",
    chromium: process.versions.chrome ?? "unknown",
    node: process.versions.node,
    v8: process.versions.v8,
  },
  system: {
    platform: process.platform,
    arch: process.arch,
    release: release(),
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  security: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  },
});

const serverForClient = (clientType: string): string => {
  switch (clientType) {
    case "txwy":
      return "txwy";
    case "YoStarEN":
      return "YoStarEN";
    case "YoStarJP":
      return "YoStarJP";
    case "YoStarKR":
      return "YoStarKR";
    default:
      return "CN";
  }
};

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/gu, "-");

export const ApplicationLive: Layer.Layer<
  Application,
  never,
  | AppPaths
  | CoreRegistry
  | CoreInstaller
  | EventBus
  | Settings
  | Workspace
  | ResourceUpdater
  | PrtsLibrary
  | CopilotSetupStore
  | RunHistoryService
  | ScheduleStore
  | ToolData
> = Layer.effect(
  Application,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const settings = yield* Settings;
    const workspace = yield* Workspace;
    const registry = yield* CoreRegistry;
    const installer = yield* CoreInstaller;
    const bus = yield* EventBus;
    const resources = yield* ResourceUpdater;
    const prts = yield* PrtsLibrary;
    const copilotSetup = yield* CopilotSetupStore;
    const history = yield* RunHistoryService;
    const schedules = yield* ScheduleStore;
    const toolData = yield* ToolData;

    const emitCopilot = (setup: CopilotSetup): void => {
      bus.emit({ _tag: "copilot-updated", copilot: setup });
    };
    const operatorCatalogue = new OperatorCatalogue();

    /**
     * Operators come from the active core's `resource/battle_data.json`, so the
     * list always matches the installed game data and costs no request.
     */
    /** The resource tree of the core the user activated; the source of every operator read. */
    const activeResourceRoot = Effect.gen(function* () {
      const currentSettings = yield* settings.get;
      const ready = (yield* registry.list).filter((core) => core.status === "ready");
      const active = currentSettings.activeCoreId
        ? ready.find((core) => core.id === currentSettings.activeCoreId)
        : ready[0];
      return active === undefined ? undefined : join(active.root, "resource");
    });

    const copilotOperators = (query: string) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return yield* maaxError("没有可用的核心，无法读取干员数据");
        return yield* Effect.tryPromise({
          try: () => operatorCatalogue.search(root, query),
          catch: (cause) => maaxError("无法读取干员数据", cause),
        });
      });

    /**
     * The Roguelike starting-operator picker: the whole catalogue, marked with
     * the theme's recommendations. The list is only a suggestion — the core
     * accepts any Chinese name — so a missing core, file or malformed JSON must
     * leave the field usable instead of failing the command.
     */
    const roguelikeOperators = (theme: string) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return [] as ReadonlyArray<RoguelikeOperator>;
        const data = yield* Effect.tryPromise({
          try: () => operatorCatalogue.load(root),
          catch: (cause) => maaxError("无法读取干员数据", cause),
        }).pipe(Effect.orElseSucceed(() => undefined));
        if (data === undefined) return [] as ReadonlyArray<RoguelikeOperator>;
        const recommended = yield* Effect.tryPromise({
          try: () => readStartingOperators(root, theme),
          catch: () => maaxError("无法读取肉鸽开局干员推荐"),
        }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
        return mergeRoguelikeOperators(data, recommended);
      });

    /**
     * Downscaled avatars for the picker. `resource/template/avatar/<id>.png`
     * ships with the resource tree but only covers part of the catalogue, and a
     * hand-written custom name has no id at all, so the caller must render a
     * fallback badge for anything missing from the answer.
     */
    const avatarCache = new Map<string, string>();
    const operatorAvatars = (ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const root = yield* activeResourceRoot;
        if (root === undefined) return [] as ReadonlyArray<OperatorAvatar>;
        const unique = [...new Set(ids.filter(isAvatarId))].slice(0, AVATAR_LIMIT);
        return yield* Effect.sync(() =>
          unique.flatMap((id) => {
            const key = `${root}|${id}`;
            const cached = avatarCache.get(key);
            if (cached !== undefined) return [{ id, dataUrl: cached }];
            const image = nativeImage.createFromPath(avatarPath(root, id));
            if (image.isEmpty()) return [];
            // 40 px matches the row; the source PNGs are several hundred pixels
            // wide and would dominate the IPC payload at full size.
            const dataUrl = image.resize({ width: 40, height: 40 }).toDataURL();
            avatarCache.set(key, dataUrl);
            return [{ id, dataUrl }];
          }),
        );
      });

    /**
     * Names the active core knows, used only to decide whether a downloaded
     * assignment needs the elite-requirement repair: MaaCore skips its check for
     * operators missing from the core's own battle data.
     */
    const knownCopilotOperators = Effect.gen(function* () {
      const root = yield* activeResourceRoot;
      if (root === undefined) return undefined;
      const data = yield* Effect.tryPromise({
        try: () => operatorCatalogue.load(root),
        catch: (cause) => maaxError("无法读取干员数据", cause),
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (data === undefined) return undefined;
      const names = new Set<string>();
      for (const entry of data.entries) {
        names.add(entry.name);
        if (entry.nameEn !== "") names.add(entry.nameEn);
      }
      return names;
    });

    const hosts = new Map<string, HostEntry>();
    const runtime = new Map<string, RuntimeDevice>();
    const runs = new Map<string, RunState>();
    interface ConnectWaiter {
      readonly resolve: (result: { ok: boolean; message?: string }) => void;
      readonly abort: (message: string) => void;
      readonly timer: NodeJS.Timeout;
    }
    const connectWaiters = new Map<string, ConnectWaiter>();
    let profiles: Map<string, DeviceProfile> = new Map();
    let plans: TaskPlan[] = [];
    let engine: EngineInfo = { phase: "idle", sessionCount: 0 };
    let shuttingDown = false;
    let stageCache: StageCache | undefined;

    const log = (level: "debug" | "info" | "warn" | "error", message: string): void => {
      if (level === "debug" && !settingsCache?.developerMode) return;
      bus.emit({ _tag: "log", level, message, at: Date.now() });
    };
    let settingsCache: AppSettings | undefined;

    const refreshLocalState = Effect.gen(function* () {
      settingsCache = yield* settings.get;
      setWindowBehavior({ closeToTray: settingsCache.closeToTray, locale: settingsCache.locale });
      const deviceList = yield* workspace.getDevices;
      profiles = new Map(deviceList.map((device) => [device.id, device]));
      plans = [...(yield* workspace.getPlans)];
    });

    yield* refreshLocalState;

    const viewFor = (deviceId: string): DeviceView | undefined => {
      const profile = profiles.get(deviceId);
      if (!profile) return undefined;
      const state = runtime.get(deviceId) ?? { status: "offline" as const };
      return {
        profile,
        status: state.status,
        ...(state.engineVersion ? { engineVersion: state.engineVersion } : {}),
        ...(state.resolution ? { resolution: state.resolution } : {}),
        ...(state.screencapCost ? { screencapCost: state.screencapCost } : {}),
        ...(state.lastError ? { lastError: state.lastError } : {}),
      };
    };

    const views = (): ReadonlyArray<DeviceView> =>
      [...profiles.values()].flatMap((profile) => {
        const view = viewFor(profile.id);
        return view ? [view] : [];
      });

    const setDeviceState = (deviceId: string, patch: Partial<RuntimeDevice>): void => {
      const current = runtime.get(deviceId) ?? { status: "offline" as const };
      runtime.set(deviceId, { ...current, ...patch });
    };

    const emitDevice = (deviceId: string): void => {
      const view = viewFor(deviceId);
      if (view) bus.emit({ _tag: "device-updated", device: view });
    };

    const computeEngine = (): EngineInfo => {
      const activeHost = [...hosts.values()][0];
      const running = [...runs.values()].some((run) => run.snapshot.status === "running");
      const anyStarting = [...hosts.values()].some((host) => host.version === "");
      const phase = hosts.size === 0 ? "idle" : running ? "running" : anyStarting ? "starting" : "ready";
      const message = phase === "starting" ? "正在加载 MaaCore…" : undefined;
      return {
        phase,
        ...(activeHost ? { coreId: activeHost.core.id, coreVersion: activeHost.version || undefined } : {}),
        sessionCount: [...runtime.values()].filter((device) => device.sessionId !== undefined).length,
        ...(message ? { message } : {}),
      };
    };

    const emitEngine = (): void => {
      engine = computeEngine();
      bus.emit({ _tag: "engine-updated", engine });
    };

    const emitRun = (run: RunState): void => {
      bus.emit({ _tag: "run-updated", run: run.snapshot });
    };

    /**
     * Persist a terminal run once. Runs are projected from callbacks, so the
     * same completion can be observed by the run event and the stop path; the
     * flag on RunState makes the history entry idempotent.
     */
    const recordRun = (run: RunState): void => {
      const snapshot = run.snapshot;
      if (run.recorded) return;
      if (snapshot.status !== "completed" && snapshot.status !== "failed" && snapshot.status !== "stopped") return;
      run.recorded = true;
      const plan = snapshot.planId === undefined ? undefined : plans.find((item) => item.id === snapshot.planId);
      const entry: RunHistoryEntry = {
        id: snapshot.id,
        deviceId: snapshot.deviceId,
        deviceName: profiles.get(snapshot.deviceId)?.name ?? snapshot.deviceId,
        ...(snapshot.planId === undefined ? {} : { planId: snapshot.planId }),
        ...(plan === undefined ? {} : { planName: plan.name }),
        status: snapshot.status,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt ?? Date.now(),
        tasks: snapshot.tasks.map((task) => ({
          type: task.type,
          name: task.name,
          status: task.status,
          ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
          ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }),
        })),
      };
      // History is bookkeeping, not part of run control: a failed write must not
      // turn a completed run into an error in the UI.
      // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
      void Effect.runPromise(
        history
          .add(entry)
          .pipe(Effect.tap((value) => Effect.sync(() => bus.emit({ _tag: "history-updated", history: value })))),
      ).catch(() => undefined);
    };

    const finishRun = (deviceId: string, status: RunSnapshot["status"], message?: string): void => {
      const run = runs.get(deviceId);
      if (!run) return;
      run.copilot = undefined;
      const next = finishSnapshot(run.snapshot, status, Date.now(), message);
      if (next === run.snapshot) return;
      run.snapshot = next;
      emitRun(run);
      setDeviceState(deviceId, { status: "online", lastError: message });
      emitDevice(deviceId);
      emitEngine();
      recordRun(run);
    };

    const notifyRunFinished = (deviceId: string, failed: boolean): void => {
      if (!settingsCache?.notifyOnComplete || !Notification.isSupported()) return;
      const device = profiles.get(deviceId)?.name ?? "MAAX";
      const chinese = settingsCache.locale === "zh-CN";
      new Notification({
        title: failed ? (chinese ? "任务失败" : "Task failed") : chinese ? "任务完成" : "Task completed",
        body: failed
          ? chinese
            ? `${device} 的任务队列已结束，其中存在失败任务。`
            : `${device}'s queue finished with a failed task.`
          : chinese
            ? `${device} 的任务队列已完成。`
            : `${device}'s queue completed.`,
      }).show();
    };

    /* ---------------------------------------------------------------------- */
    /* Host lifecycle                                                          */
    /* ---------------------------------------------------------------------- */

    /**
     * A host is a disposable utility process shared by every device on the same
     * core and resource server. Membership is tracked per device so the process
     * can be released when the last device leaves, and so a crash knows exactly
     * which devices to bring back.
     */
    const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000] as const;
    const reconnectTimers = new Map<string, NodeJS.Timeout>();
    const reconnectAttempts = new Map<string, number>();
    // Devices the app should keep trying to bring back. Cleared by an explicit
    // disconnect, a delete, a successful connect or shutdown, so an in-flight
    // retry that fails afterwards cannot start a new chain behind the user.
    const reconnectWanted = new Set<string>();

    const cancelReconnect = (deviceId: string): void => {
      const timer = reconnectTimers.get(deviceId);
      if (timer !== undefined) clearTimeout(timer);
      reconnectTimers.delete(deviceId);
      reconnectAttempts.delete(deviceId);
      reconnectWanted.delete(deviceId);
    };

    // A host removed from `hosts` may still be exiting; repair/move waits for
    // both the live entries and these in-flight shutdowns (Windows DLL locks).
    const stoppingHosts = new Map<string, Promise<void>>();
    const stopHost = (key: string): Promise<void> => {
      const host = hosts.get(key);
      if (!host) return stoppingHosts.get(key) ?? Promise.resolve();
      hosts.delete(key);
      host.devices.clear();
      const stop = host.client.stop().catch(() => undefined);
      stoppingHosts.set(key, stop);
      void stop.then(() => {
        if (stoppingHosts.get(key) === stop) stoppingHosts.delete(key);
      });
      return stop;
    };

    const releaseHostIfIdle = (key: string): void => {
      const host = hosts.get(key);
      if (!host || host.devices.size > 0) return;
      void stopHost(key);
      emitEngine();
    };

    /** Attach a device to its host and release the host it left behind. */
    const bindDevice = (deviceId: string, host: HostEntry): void => {
      for (const [key, other] of hosts) {
        if (other !== host && other.devices.delete(deviceId)) releaseHostIfIdle(key);
      }
      host.devices.add(deviceId);
    };

    const detachDevice = (deviceId: string): void => {
      for (const [key, host] of hosts) {
        if (!host.devices.delete(deviceId)) continue;
        releaseHostIfIdle(key);
        return;
      }
    };

    /**
     * A crashed host takes every session with it. Reconnecting is safe because
     * runs are never resumed: an interrupted queue is marked failed, so a retry
     * cannot spend sanity, medicine or Originite twice.
     */
    const scheduleReconnect = (deviceId: string, reason: string): void => {
      if (shuttingDown || !profiles.has(deviceId) || !reconnectWanted.has(deviceId)) return;
      // A host can crash again while a retry is in flight; keep one timer only.
      const pending = reconnectTimers.get(deviceId);
      if (pending !== undefined) clearTimeout(pending);
      const attempt = reconnectAttempts.get(deviceId) ?? 0;
      const delay = RECONNECT_DELAYS_MS[attempt];
      if (delay === undefined) {
        // Stop retrying, but leave a state the user can act on and a counter a
        // later manual connect can reset.
        reconnectAttempts.delete(deviceId);
        reconnectTimers.delete(deviceId);
        setDeviceState(deviceId, { status: "error", lastError: reason });
        emitDevice(deviceId);
        log("warn", `自动重连已放弃：${reason}`);
        return;
      }
      reconnectAttempts.set(deviceId, attempt + 1);
      setDeviceState(deviceId, { status: "connecting", lastError: reason });
      emitDevice(deviceId);
      const timer = setTimeout(() => {
        reconnectTimers.delete(deviceId);
        if (shuttingDown) return;
        // The timer fires outside every Effect: this is an event-handler
        // boundary, and the connect program needs no services (R = never).
        // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
        void Effect.runPromise(
          connectDevice(deviceId, { retry: true }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => scheduleReconnect(deviceId, error instanceof Error ? error.message : String(error))),
            ),
          ),
        ).catch(() => undefined);
      }, delay);
      reconnectTimers.set(deviceId, timer);
    };

    // Liking is best-effort and must not repeat for the two entries that share
    // one PRTS assignment (normal + raid use the same copilotId).
    const ratedCopilotIds = new Set<number>();
    const rateCopilot = (copilotId: number): void => {
      if (!Number.isSafeInteger(copilotId) || copilotId <= 0 || ratedCopilotIds.has(copilotId)) return;
      ratedCopilotIds.add(copilotId);
      // Callback boundary: the queued PRTS request runs after the native
      // callback returns and failures are only logged.
      // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
      void Effect.runPromise(prts.like(copilotId)).catch((error: unknown) => {
        console.warn("自动点赞失败", error);
      });
    };

    /**
     * Retire the assignments a terminal copilot callback proves completed.
     *
     * A normal batch is one task, so a completed task retires every enabled
     * entry and a chain error retires only the files loaded before the failing
     * one. SSS and paradox use one task per file, so each completed task retires
     * exactly the file it carried and the queue keeps the metadata until it ends.
     */
    const applyCopilotOutcome = (run: RunState, outcome: CopilotRunOutcome, taskId: number): void => {
      const meta = run.copilot;
      if (!meta) return;
      const configId = run.taskConfigIds.get(taskId);
      const taskIndex = configId === undefined ? -1 : meta.taskIds.indexOf(configId);
      const succeeded = copilotSucceededEntries(meta.items, meta.kind, outcome, meta.lastLoaded, taskIndex);
      if (succeeded.length > 0) {
        // One row may carry both difficulties; each completed entry unchecks
        // exactly its own bit, so a normal clear keeps the pending raid run.
        const completed = new Map<string, CopilotMode[]>();
        for (const entry of succeeded) {
          const modes = completed.get(entry.item.id) ?? [];
          modes.push(entry.mode);
          completed.set(entry.item.id, modes);
        }
        // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
        void Effect.runPromise(
          copilotSetup.patchItems((items) =>
            items.map((item) => {
              const modes = completed.get(item.id);
              return modes === undefined ? item : modes.reduce(unscheduleCopilotMode, item);
            }),
          ),
        )
          .then((setup) => {
            emitCopilot(setup);
          })
          .catch((error: unknown) => {
            console.warn("自动取消已完成作业的难度失败", error);
          });
        for (const entry of succeeded) rateCopilot(entry.item.copilotId);
      }
      // A normal batch has one task; sequential kinds wait for the next task
      // completion and are cleared when the queue closes.
      if (meta.kind !== "normal" && outcome === "completed") return;
      run.copilot = undefined;
    };

    const handleCallback = (item: EngineCallback): void => {
      const deviceId = item.sessionId;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(item.details) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      bus.emit({
        _tag: "core-callback",
        sessionId: item.sessionId,
        deviceId,
        msg: item.msg,
        payload,
        raw: item.details,
        at: Date.now(),
      });

      const what = typeof payload.what === "string" ? payload.what : "";
      const details = (payload.details ?? {}) as Record<string, unknown>;

      // OperBox and Depot stream their recognition results through
      // SubTaskExtraInfo; every frame replaces the previous snapshot, so the
      // Tools page follows a scan in progress and keeps the final result.
      if (item.msg === 20003 && (what === "OperBoxInfo" || what === "DepotInfo")) {
        // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
        void Effect.runPromise(
          toolData
            .apply(deviceId, what, details)
            .pipe(
              Effect.tap((snapshot) =>
                snapshot === undefined
                  ? Effect.void
                  : Effect.sync(() => bus.emit({ _tag: "tools-updated", deviceId, snapshot })),
              ),
            ),
        ).catch(() => undefined);
      }

      if (item.msg === 4 && what === "Connect") {
        const waiter = connectWaiters.get(deviceId);
        if (waiter) {
          clearTimeout(waiter.timer);
          connectWaiters.delete(deviceId);
          waiter.resolve({
            ok: details.ret === true,
            ...(typeof details.error === "string" ? { message: details.error } : {}),
          });
        }
      }

      if (item.msg === 2 && what === "ConnectFailed") {
        const waiter = connectWaiters.get(deviceId);
        if (waiter) {
          clearTimeout(waiter.timer);
          connectWaiters.delete(deviceId);
          waiter.resolve({
            ok: false,
            message: typeof payload.why === "string" ? payload.why : "连接失败",
          });
        }
      }

      if ((item.msg === 2 || item.msg === 20003) && what === "ScreencapCost") {
        const min = Number(details.min);
        const avg = Number(details.avg);
        const max = Number(details.max);
        if (Number.isFinite(min) && Number.isFinite(avg) && Number.isFinite(max)) {
          setDeviceState(deviceId, { screencapCost: { min, avg, max } });
          emitDevice(deviceId);
        }
      }

      const run = runs.get(deviceId);
      if (!run) return;
      // The plugin loads the next file only after the previous battle finished,
      // so its id tells us which files a later chain error may safely retire.
      if (run.copilot?.kind === "normal" && item.msg === 20003 && what === "CopilotListLoadTaskFileSuccess") {
        const loaded = Number(details.id);
        if (Number.isInteger(loaded) && loaded >= 0) run.copilot.lastLoaded = loaded;
      }
      const action = runCallbackAction(item.msg, payload);
      if (!action) return;

      switch (action.kind) {
        case "task-started":
          run.snapshot = startTask(run.snapshot, action.taskId, Date.now());
          setDeviceState(deviceId, { status: "running" });
          emitDevice(deviceId);
          emitRun(run);
          emitEngine();
          break;
        case "task-completed":
          applyCopilotOutcome(run, "completed", action.taskId);
          run.snapshot = completeTask(run.snapshot, action.taskId, Date.now());
          emitRun(run);
          break;
        case "task-failed":
          applyCopilotOutcome(run, "failed", action.taskId);
          run.snapshot = failTask(run.snapshot, action.taskId, action.message, Date.now());
          emitRun(run);
          break;
        case "run-stopped":
          run.copilot = undefined;
          finishRun(deviceId, "stopped");
          break;
        case "queue-finished": {
          run.copilot = undefined;
          const failed = run.snapshot.tasks.some((task) => task.status === "failed");
          finishRun(deviceId, failed ? "failed" : "completed");
          notifyRunFinished(deviceId, failed);
          break;
        }
      }
    };

    const handleHostExit = (key: string, reason: string): void => {
      const host = hosts.get(key);
      if (!host) return;
      hosts.delete(key);
      const affected = [...host.devices];
      host.devices.clear();
      engine = { ...engine, phase: "crashed", message: reason };
      for (const deviceId of affected) {
        abortConnectWaiter(deviceId, reason);
        const run = runs.get(deviceId);
        if (run && (run.snapshot.status === "running" || run.snapshot.status === "preparing")) {
          // Files loaded before the crash are still proven completed for a
          // normal batch; sequential tasks were retired one by one already.
          applyCopilotOutcome(run, "failed", 0);
          finishRun(deviceId, "failed", reason);
        }
        runtime.delete(deviceId);
        setDeviceState(deviceId, { status: "error", lastError: reason });
        emitDevice(deviceId);
      }
      bus.emit({ _tag: "engine-updated", engine });
      if (shuttingDown) return;
      bus.emit({ _tag: "toast", kind: "error", title: "MaaCore 已退出", message: reason });
      for (const deviceId of affected) {
        reconnectWanted.add(deviceId);
        scheduleReconnect(deviceId, reason);
      }
    };

    const ensureActiveCore = (): Effect.Effect<CoreInfo, MaaxError> =>
      Effect.gen(function* () {
        const currentSettings = yield* settings.get;
        const cores = yield* registry.list;
        const ready = cores.filter((core) => core.status === "ready");
        if (ready.length === 0) {
          return yield* maaxError("还没有可用的 MaaCore，请先在设置中导入或下载核心");
        }
        const active = currentSettings.activeCoreId
          ? ready.find((core) => core.id === currentSettings.activeCoreId)
          : undefined;
        return active ?? ready[0]!;
      });

    const ensureHost = (core: CoreInfo, server: string): Effect.Effect<HostEntry, MaaxError> =>
      Effect.gen(function* () {
        const key = `${core.id}::${server}`;
        const existing = hosts.get(key);
        if (existing && existing.version !== "") return existing;

        if (existing) {
          return yield* maaxError("核心正在启动，请稍候");
        }

        engine = { ...engine, phase: "starting", coreId: core.id, message: "正在加载 MaaCore…" };
        bus.emit({ _tag: "engine-updated", engine });
        const userDir = join(paths.maaDir, `${safeSegment(core.id)}-${safeSegment(server)}`);
        const client = new CoreHostClient({
          coreRoot: core.root,
          userDir,
          ...(server !== "CN" ? { resourceServer: server } : {}),
          onCallbacks: (items) => {
            for (const item of items) handleCallback(item);
          },
          onLog: (level, message) => {
            log(level === "error" ? "error" : level === "warn" ? "warn" : "debug", message);
          },
          onExit: (code, reason) => handleHostExit(key, reason || `exit ${code ?? "?"}`),
        });

        const entry: HostEntry = { key, core, server, client, version: "", devices: new Set<string>() };
        hosts.set(key, entry);
        engine = { ...engine, phase: "starting", coreId: core.id, message: "正在加载 MaaCore…" };
        bus.emit({ _tag: "engine-updated", engine });

        const init = yield* Effect.tryPromise({
          try: () => client.start(),
          catch: (cause) => {
            hosts.delete(key);
            client.kill();
            engine = { ...engine, phase: "crashed", coreId: core.id, message: String(cause) };
            bus.emit({ _tag: "engine-updated", engine });
            return maaxError("MaaCore 启动失败", cause);
          },
        });
        const result = init as InitResult;
        entry.version = result.version;
        yield* registry.markVersion(core.id, result.version);
        const cores = yield* registry.list;
        bus.emit({ _tag: "cores-updated", cores });
        engine = computeEngine();
        bus.emit({ _tag: "engine-updated", engine });
        return entry;
      });

    const ensureSession = (device: DeviceProfile, host: HostEntry): Effect.Effect<string, MaaxError> =>
      Effect.gen(function* () {
        const state = runtime.get(device.id);
        if (state?.sessionId && state.hostKey === host.key) {
          bindDevice(device.id, host);
          return state.sessionId;
        }
        if (state?.sessionId) {
          const old = hosts.get(state.hostKey ?? "");
          if (old) {
            yield* Effect.tryPromise({
              try: () => old.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
        }
        const sessionId = device.id;
        yield* Effect.tryPromise({
          try: () =>
            host.client.request({
              id: 0,
              op: "create-session",
              sessionId,
              touchMode: settingsCache?.touchMode ?? "maatouch",
              clientType: device.clientType,
            }),
          catch: (cause) => maaxError("创建 MaaCore 会话失败", cause),
        });
        setDeviceState(device.id, { sessionId, hostKey: host.key, engineVersion: host.version });
        bindDevice(device.id, host);
        return sessionId;
      });

    const waitForConnect = (deviceId: string): Promise<{ ok: boolean; message?: string }> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          connectWaiters.delete(deviceId);
          reject(new Error("连接超时，请检查 ADB 路径、模拟器地址和连接配置"));
        }, 60_000);
        connectWaiters.set(deviceId, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          abort: (message) => {
            clearTimeout(timer);
            reject(new Error(message));
          },
          timer,
        });
      });

    const cancelConnectWaiter = (deviceId: string): void => {
      const waiter = connectWaiters.get(deviceId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      connectWaiters.delete(deviceId);
    };

    /**
     * Settle a pending connect with a failure so the in-flight connect effect
     * cannot hang until its timeout and report a stale result after the retry
     * already moved on.
     */
    const abortConnectWaiter = (deviceId: string, message: string): void => {
      const waiter = connectWaiters.get(deviceId);
      if (!waiter) return;
      connectWaiters.delete(deviceId);
      waiter.abort(message);
    };

    const getConnectedDevice = (deviceId: string) =>
      Effect.gen(function* () {
        const profile = profiles.get(deviceId);
        if (!profile) return yield* maaxError("设备不存在");
        const state = runtime.get(deviceId);
        if (!state?.sessionId || !state.hostKey) {
          return yield* maaxError("设备未连接");
        }
        const host = hosts.get(state.hostKey);
        if (!host) return yield* maaxError("MaaCore 会话已失效，请重新连接");
        return { profile, state, host };
      });

    /**
     * The newest connect attempt owns the device state: a superseded attempt
     * must not settle the badge of its successor.
     */
    const connectGenerations = new Map<string, number>();

    const connectDevice = (deviceId: string, options?: { readonly retry?: boolean }) => {
      let generation: number | undefined;
      const attempt = Effect.gen(function* () {
        const profile = profiles.get(deviceId);
        if (!profile) return yield* maaxError("设备不存在");
        // A manual connect wins over pending retries; a retry keeps its counter.
        if (!options?.retry) cancelReconnect(deviceId);
        const current = runtime.get(deviceId);
        if (current?.status === "online" || current?.status === "running") {
          const view = viewFor(deviceId);
          if (view) return view;
        }
        // This attempt owns the waiter slot: settle a pending attempt instead of
        // letting it time out later and swallow this attempt's callbacks.
        abortConnectWaiter(deviceId, "连接请求已被新的连接请求取代");
        generation = (connectGenerations.get(deviceId) ?? 0) + 1;
        connectGenerations.set(deviceId, generation);
        setDeviceState(deviceId, { status: "connecting", lastError: undefined });
        emitDevice(deviceId);
        const core = yield* ensureActiveCore();
        // An empty ADB path means "auto": packaged Windows builds do not have
        // adb on PATH, so resolve the emulator's bundled client at connect time.
        const adbPath = yield* Effect.promise(() => resolveAdbPath(profile.adbPath || settingsCache?.adbPath || ""));
        // `adb connect` has no timeout of its own, and MaaCore cannot cancel the
        // call it starts, so prove the address is reachable before asking for it.
        const probe = yield* Effect.tryPromise({
          try: () => probeAdbConnection({ adbPath, address: profile.address }),
          catch: (cause) => maaxError("无法执行 ADB，请检查 ADB 路径", cause),
        });
        if (!probe.ok) return yield* maaxError("无法连接设备", probe.message);
        const server = serverForClient(profile.clientType);
        const host = yield* ensureHost(core, server);
        const sessionId = yield* ensureSession(profile, host);
        const waiter = waitForConnect(deviceId);
        const connectResult = yield* Effect.tryPromise({
          try: async () => {
            const raw = await host.client.request({
              id: 0,
              op: "connect",
              sessionId,
              adbPath,
              address: profile.address,
              config: profile.config || settingsCache?.connectionConfig || "General",
            });
            return raw as ConnectResult;
          },
          catch: (cause) => {
            cancelConnectWaiter(deviceId);
            return maaxError("发起连接失败", cause);
          },
        });
        if (!connectResult || connectResult.callId <= 0) {
          return yield* maaxError("连接请求被 MaaCore 拒绝");
        }
        const result = yield* Effect.tryPromise({
          try: () => waiter,
          catch: (cause) => maaxError("连接失败", cause),
        });
        if (!result.ok) {
          return yield* maaxError("连接失败", result.message || "ADB 连接失败");
        }
        const nextProfile = yield* workspace.markConnected(deviceId);
        profiles.set(deviceId, nextProfile);
        setDeviceState(deviceId, {
          status: "online",
          engineVersion: host.version,
          lastError: undefined,
        });
        cancelReconnect(deviceId);
        emitDevice(deviceId);
        engine = computeEngine();
        bus.emit({ _tag: "engine-updated", engine });
        const view = viewFor(deviceId);
        if (!view) return yield* maaxError("设备状态丢失");
        return view;
      });

      /**
       * Every failure — missing core, host spawn, session create, request error,
       * or no callback at all before the timeout — must settle the `connecting`
       * badge. Leaving it set strands the UI on a connect that will never
       * finish and keeps the connect button disabled.
       */
      return attempt.pipe(
        Effect.tapError((error: MaaxError) =>
          Effect.sync(() => {
            if (generation === undefined || connectGenerations.get(deviceId) !== generation) return;
            cancelConnectWaiter(deviceId);
            // An explicit disconnect during the attempt owns the state now.
            if (runtime.get(deviceId)?.status !== "connecting") return;
            const message = error.detail ? `${error.message}：${error.detail}` : error.message;
            setDeviceState(deviceId, { status: "error", lastError: message });
            emitDevice(deviceId);
            log("warn", `连接失败：${message}`);
          }),
        ),
      );
    };

    const disconnectDevice = (deviceId: string) =>
      Effect.gen(function* () {
        // An explicit disconnect must win over a pending crash retry.
        cancelReconnect(deviceId);
        // ...and over an in-flight connect, whose late success would otherwise
        // bring the device back online after the user disconnected it.
        abortConnectWaiter(deviceId, "设备已断开");
        const state = runtime.get(deviceId);
        const run = runs.get(deviceId);
        if (run && (run.snapshot.status === "running" || run.snapshot.status === "preparing")) {
          yield* stopRunInternal(deviceId);
        }
        if (state?.sessionId && state.hostKey) {
          const host = hosts.get(state.hostKey);
          if (host) {
            yield* Effect.tryPromise({
              try: () => host.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
        }
        runtime.set(deviceId, { status: "offline" });
        emitDevice(deviceId);
        detachDevice(deviceId);
        emitEngine();
        const view = viewFor(deviceId);
        if (!view) return yield* maaxError("设备不存在");
        return view;
      });

    const screenshotDevice = (deviceId: string) =>
      Effect.gen(function* () {
        const { state, host } = yield* getConnectedDevice(deviceId);
        const result = yield* Effect.tryPromise({
          try: () => host.client.request({ id: 0, op: "screenshot", sessionId: state.sessionId! }),
          catch: (cause) => maaxError("截图失败", cause),
        });
        const shot = result as Screenshot;
        setDeviceState(deviceId, {
          resolution: { width: shot.width, height: shot.height },
        });
        emitDevice(deviceId);
        return shot;
      });

    const stopRunInternal = (deviceId: string): Effect.Effect<RunSnapshot, MaaxError> =>
      Effect.gen(function* () {
        const run = runs.get(deviceId);
        if (!run) return yield* maaxError("当前没有运行中的任务");
        const { host } = yield* getConnectedDevice(deviceId);
        if (run.hostKey !== host.key) {
          return yield* maaxError("运行中的核心已经切换，请重新连接");
        }
        yield* Effect.tryPromise({
          try: () =>
            host.client.request({
              id: 0,
              op: "stop",
              sessionId: runtime.get(deviceId)?.sessionId ?? deviceId,
            }),
          catch: (cause) => maaxError("停止任务失败", cause),
        });
        const now = Date.now();
        run.copilot = undefined;
        run.snapshot = {
          ...run.snapshot,
          status: "stopped",
          endedAt: now,
          tasks: run.snapshot.tasks.map((task) =>
            task.status === "running" || task.status === "pending"
              ? { ...task, status: "stopped", endedAt: now }
              : task,
          ),
        };
        setDeviceState(deviceId, { status: "online" });
        emitDevice(deviceId);
        emitRun(run);
        emitEngine();
        recordRun(run);
        return run.snapshot;
      });

    /** Append a batch of tasks to the device's session and start it. */
    const launchTasks = (
      deviceId: string,
      tasks: ReadonlyArray<TaskConfig>,
      planId?: string,
      copilot?: { readonly items: ReadonlyArray<CopilotItem>; readonly kind: CopilotKind },
    ) =>
      Effect.gen(function* () {
        const { state, host } = yield* getConnectedDevice(deviceId);
        const sessionId = state.sessionId!;
        const runId = randomUUID();
        const startedAt = Date.now();
        const snapshot: RunSnapshot = {
          id: runId,
          deviceId,
          ...(planId === undefined ? {} : { planId }),
          status: "preparing",
          startedAt,
          tasks: tasks.map((task) => ({
            taskId: 0,
            configId: task.id,
            type: task.type,
            name: task.name || task.type,
            status: "pending",
          })),
        };
        const run: RunState = {
          snapshot,
          taskConfigIds: new Map(),
          hostKey: host.key,
          ...(copilot === undefined
            ? {}
            : {
                copilot: {
                  items: copilot.items,
                  kind: copilot.kind,
                  taskIds: tasks.map((task) => task.id),
                  lastLoaded: -1,
                },
              }),
        };
        runs.set(deviceId, run);
        emitRun(run);

        for (const task of tasks) {
          const params = buildMaaTaskParams(task, settingsCache!);
          const raw = yield* Effect.tryPromise({
            try: () =>
              host.client.request({
                id: 0,
                op: "append-task",
                sessionId,
                type: task.type,
                params,
              }),
            catch: (cause) => {
              const message = cause instanceof Error ? cause.message : String(cause);
              return maaxError(`任务「${task.name || task.type}」参数被拒绝`, message);
            },
          });
          const { taskId } = raw as AppendTaskResult;
          run.taskConfigIds.set(taskId, task.id);
          run.snapshot = {
            ...run.snapshot,
            tasks: run.snapshot.tasks.map((item) => (item.configId === task.id ? { ...item, taskId } : item)),
          };
        }

        const started = yield* Effect.tryPromise({
          try: () => host.client.request({ id: 0, op: "start", sessionId }),
          catch: (cause) => maaxError("启动任务失败", cause),
        });
        const ok =
          typeof started === "object" && started !== null && "ok" in started
            ? Boolean((started as { ok: unknown }).ok)
            : true;
        if (!ok) {
          return yield* maaxError("MaaCore 拒绝启动任务");
        }
        run.snapshot = { ...run.snapshot, status: "running" };
        setDeviceState(deviceId, { status: "running" });
        emitDevice(deviceId);
        emitRun(run);
        emitEngine();
        return run.snapshot;
      }).pipe(
        // The preparing snapshot was already broadcast. If a later step fails,
        // leaving it in the run map strands the UI on "preparing" (and offers a
        // Stop button for a run the core never accepted), so project a terminal
        // failure for every start error.
        Effect.tapError((error: MaaxError) =>
          Effect.sync(() => {
            const message = error.detail ? `${error.message}：${error.detail}` : error.message;
            finishRun(deviceId, "failed", message);
          }),
        ),
      );

    const ensureDeviceIdle = (deviceId: string): Effect.Effect<void, MaaxError> =>
      Effect.gen(function* () {
        const existing = runs.get(deviceId);
        if (existing && (existing.snapshot.status === "running" || existing.snapshot.status === "preparing")) {
          return yield* maaxError("这个设备已经在运行任务");
        }
      });

    /** A run owns the core it was started on until it ends. */
    const runActive = (): boolean =>
      [...runs.values()].some((run) => run.snapshot.status === "preparing" || run.snapshot.status === "running");

    const startRun = (deviceId: string, planId: string) =>
      Effect.gen(function* () {
        yield* ensureDeviceIdle(deviceId);
        const plan = yield* workspace.getPlan(planId);
        if (!plan || plan.deviceId !== deviceId) return yield* maaxError("任务计划不存在");
        const tasks = plan.tasks.filter((task) => task.enabled);
        if (tasks.length === 0) return yield* maaxError("没有启用的任务，请至少启用一个");
        for (const task of tasks) {
          const missing = firstMissingField(task);
          if (missing) {
            const label = task.name || task.type;
            return yield* maaxError(`任务「${label}」缺少必备设置`, missing.zh);
          }
        }
        return yield* launchTasks(deviceId, tasks, planId);
      });

    /**
     * Copilot runs on demand: one assignment batch, no plan, no queue. A
     * completed or stopped run leaves the device connected and idle.
     */
    const startCopilot = (deviceId: string, itemId?: string) =>
      Effect.gen(function* () {
        yield* ensureDeviceIdle(deviceId);
        const setup = yield* copilotSetup.get;
        if (setup.items.length === 0) return yield* maaxError("请先添加作业");

        // An item override is a one-off: keep the saved batch untouched and run
        // just that file in single-file mode. It is also allowed out of a mixed
        // batch, because only the selected normal assignment is used.
        let runSetup = setup;
        let manual = false;
        if (itemId !== undefined) {
          const target = setup.items.find((item) => item.id === itemId);
          if (!target) return yield* maaxError("这份作业已不在列表中", "请刷新列表后重试");
          if ((target.kind ?? "normal") !== "normal") {
            return yield* maaxError("单作业模式只支持普通关卡作业", "保全派驻和悖论模拟请使用各自的入口");
          }
          // An explicit single run ignores the difficulty checkboxes; it is the
          // one way to re-run a retired assignment without checking it first.
          runSetup = { items: [withSingleMode(target)], options: setup.options };
          manual = true;
        } else {
          const checkedItems = setup.items.filter(copilotItemActive);
          if (checkedItems.length === 0) {
            return yield* maaxError("没有选中的作业", "在作业列表里勾选普通或突袭难度后再开始");
          }
          const kinds = new Set(checkedItems.map((item) => item.kind ?? "normal"));
          if (kinds.size > 1) {
            return yield* maaxError(
              "同一批作业不能混合普通关卡、保全派驻和悖论模拟",
              "它们从不同的游戏界面开始，请清空列表后分别运行",
            );
          }
          runSetup = { items: checkedItems.map(normalizeCopilotItem), options: setup.options };
        }
        // PRTS assignments are user content: MaaCore rejects the whole file
        // when one operator's elite requirement contradicts its own skill or
        // module. Normalise that known inconsistency before launch so the
        // failure cannot surface as the opaque "CopilotFileReadError".
        const known = yield* knownCopilotOperators;
        const repairs: string[] = [];
        for (const item of runSetup.items) {
          const repair = yield* Effect.tryPromise({
            try: () => repairCopilotFile(item.filename, known),
            catch: (cause) =>
              maaxError(
                `无法读取作业文件「${item.title || item.stage || item.filename}」`,
                cause instanceof Error ? cause.message : String(cause),
              ),
          });
          if (repair !== null) repairs.push(...repair.fixes);
        }
        if (repairs.length > 0) {
          bus.emit({
            _tag: "toast",
            kind: "warning",
            title: "已修正作业要求",
            message: repairs.join("；"),
          });
        }

        const kind = runSetup.items[0]?.kind ?? "normal";
        const tasks = createCopilotRunTasks(runSetup, undefined, manual);
        if (tasks.length === 0) return yield* maaxError("没有可运行的作业");
        for (const task of tasks) {
          const missing = firstMissingField(task);
          if (missing) return yield* maaxError(`任务「${task.name || task.type}」缺少必备设置`, missing.zh);
        }
        return yield* launchTasks(deviceId, tasks, undefined, { items: runSetup.items, kind });
      });

    const stopRun = (deviceId: string) =>
      Effect.gen(function* () {
        const run = runs.get(deviceId);
        if (!run) return yield* maaxError("当前没有运行中的任务");
        return yield* stopRunInternal(deviceId);
      });

    const bootstrap = Effect.gen(function* () {
      settingsCache = yield* settings.get;
      const deviceList = yield* workspace.getDevices;
      profiles = new Map(deviceList.map((device) => [device.id, device]));
      plans = [...(yield* workspace.getPlans)];
      const cores = yield* registry.list;
      const historyResult = yield* history.result;
      const scheduleList = yield* schedules.list;
      const tools = yield* toolData.state;
      return {
        runtime: readRuntimeInfo(),
        settings: settingsCache,
        cores,
        devices: views(),
        plans,
        engine,
        copilot: yield* copilotSetup.get,
        history: historyResult,
        schedules: scheduleList,
        tools,
      } satisfies Bootstrap;
    });

    const updateSettings = (patch: AppSettingsPatch) =>
      Effect.gen(function* () {
        const next = yield* settings.update(patch);
        settingsCache = next;
        setWindowBehavior({ closeToTray: next.closeToTray, locale: next.locale });
        return next;
      });

    const addCore = (root: string) =>
      Effect.gen(function* () {
        const core = yield* registry.addLocal(root);
        const cores = yield* registry.list;
        bus.emit({ _tag: "cores-updated", cores });
        return core;
      });

    const removeCore = (id: string) =>
      Effect.gen(function* () {
        const current = yield* settings.get;
        const before = yield* registry.list;
        // Removing the active entry is a core switch in disguise, and a run
        // owns the active core until it ends.
        const activeId = current.activeCoreId ?? before.find((core) => core.status === "ready")?.id ?? null;
        if (activeId === id && runActive()) {
          return yield* maaxError("任务运行中不能移除当前内核");
        }
        const cores = yield* registry.remove(id);
        if (current.activeCoreId === id) {
          yield* settings.update({
            activeCoreId: cores.find((core) => core.status === "ready")?.id ?? null,
          });
        }
        bus.emit({ _tag: "cores-updated", cores });
        return cores;
      });

    const refreshCores = Effect.gen(function* () {
      const cores = yield* registry.refresh;
      bus.emit({ _tag: "cores-updated", cores });
      return cores;
    });

    /* ---------------------------------------------------------------------- */
    /* Resource updates                                                        */
    /* ---------------------------------------------------------------------- */

    const emitResourceProgress: ResourceProgress = (phase, received, total) => {
      bus.emit({ _tag: "download-progress", phase, received, total, source: "resource" });
    };

    const coreForUpdate = (coreId: string): Effect.Effect<CoreInfo, MaaxError> =>
      Effect.gen(function* () {
        const core = yield* registry.get(coreId);
        if (!core) return yield* maaxError("核心不存在");
        if (core.status !== "ready") return yield* maaxError("这个核心尚未就绪，无法处理资源");
        return core;
      });

    /**
     * B1: replacing resource files while MaaCore has them loaded is unsafe, and
     * the app deliberately does not cut a running session. The renderer disables
     * the same actions; this is the authoritative check.
     */
    const ensureCoreIdle = (coreId: string): Effect.Effect<void, MaaxError> =>
      Effect.gen(function* () {
        const inUse = [...runtime.values()].some((state) => state.hostKey?.startsWith(`${coreId}::`) ?? false);
        if (inUse) return yield* maaxError("请先断开连接到这个核心的设备，再更新资源");
      });

    /**
     * Stop every host that holds this core and wait for the processes to exit.
     * Windows keeps `MaaCore.dll` locked until then, so a repair/move that
     * renames the core directory must not race the utility process shutdown.
     */
    const releaseCoreHosts = (coreId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const waits: Promise<void>[] = [];
        for (const [key, promise] of stoppingHosts) {
          if (key.startsWith(`${coreId}::`)) waits.push(promise);
        }
        for (const [key, host] of hosts) {
          if (host.core.id !== coreId) continue;
          waits.push(stopHost(key));
        }
        if (waits.length > 0) emitEngine();
        yield* Effect.promise(() => Promise.all(waits));
      });

    const afterResourceChange = Effect.gen(function* () {
      const cores = yield* registry.refresh;
      bus.emit({ _tag: "cores-updated", cores });
      return cores;
    });

    const failResource = (action: string) => (error: MaaxError) =>
      Effect.sync(() => {
        bus.emit({ _tag: "download-progress", phase: "failed", received: 0, total: 0, source: "resource" });
        bus.emit({ _tag: "toast", kind: "error", title: action, message: error.message });
      });

    const resourceStatus = (coreId: string) =>
      Effect.gen(function* () {
        const core = yield* coreForUpdate(coreId);
        return yield* resources.status(core);
      });

    const checkResourceUpdate = (coreId: string) =>
      Effect.gen(function* () {
        const core = yield* coreForUpdate(coreId);
        return yield* resources.check(core);
      });

    const updateResource = (coreId: string) =>
      Effect.gen(function* () {
        const core = yield* coreForUpdate(coreId);
        yield* ensureCoreIdle(coreId);
        yield* releaseCoreHosts(coreId);
        const result = yield* resources
          .apply(core, emitResourceProgress)
          .pipe(Effect.tapError(failResource("资源更新失败")));
        yield* afterResourceChange;
        bus.emit({
          _tag: "download-progress",
          phase: "done",
          received: result.bytes,
          total: result.bytes,
          source: "resource",
        });
        return result;
      });

    const rollbackResource = (coreId: string, backupId: string) =>
      Effect.gen(function* () {
        const core = yield* coreForUpdate(coreId);
        yield* ensureCoreIdle(coreId);
        yield* releaseCoreHosts(coreId);
        const result = yield* resources
          .rollback(core, backupId, emitResourceProgress)
          .pipe(Effect.tapError(failResource("资源回滚失败")));
        yield* afterResourceChange;
        bus.emit({ _tag: "download-progress", phase: "done", received: 0, total: 0, source: "resource" });
        return result;
      });

    const stageCatalog = Effect.gen(function* () {
      const currentSettings = yield* settings.get;
      const locale = currentSettings.locale;
      const client = clientKeyFor(currentSettings.clientType);
      const cacheKey = `${client}:${locale}`;
      if (stageCache && stageCache.key === cacheKey && Date.now() - stageCache.at < 10 * 60_000) {
        return stageCache.catalog;
      }

      const permanent = permanentStageEntries(locale);
      const activity = yield* Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async (): Promise<unknown> => {
            const response = await fetch(STAGE_ACTIVITY_URL, {
              signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          },
          catch: (cause) => maaxError("活动关卡获取失败", cause),
        });
        const data: StageActivityData = yield* Schema.decodeUnknownEffect(StageActivityResponseSchema)(raw).pipe(
          Effect.mapError((cause) => maaxError("活动关卡数据格式无效", cause)),
        );
        const zh = locale === "zh-CN";
        const entries: StageCatalogEntry[] = [];
        const now = Date.now();
        for (const story of Object.values(data[client]?.sideStoryStage ?? {})) {
          const info = story.Activity;
          const start = parseActivityDate(info?.UtcStartTime, info?.TimeZone);
          const expire = parseActivityDate(info?.UtcExpireTime, info?.TimeZone);
          if (start > 0 && now < start) continue;
          if (expire > 0 && now > expire) continue;
          const groupLabel = `${zh ? "活动" : "Event"} · ${info?.StageName || info?.Tip || ""}`.trim();
          for (const stage of story.Stages ?? []) {
            if (!stage.Value) continue;
            entries.push({
              value: stage.Value,
              label: stage.Display || stage.Value,
              group: "activity",
              groupLabel,
              ...(stage.Drop ? { tip: `${zh ? "掉落" : "Drop"}: ${stage.Drop}` } : {}),
            });
          }
        }
        return { entries, warning: undefined as string | undefined };
      }).pipe(
        Effect.orElseSucceed(() => ({
          entries: [] as StageCatalogEntry[],
          warning: locale === "zh-CN" ? "已显示常驻推荐关卡。" : "Showing permanent stage recommendations only.",
        })),
      );

      const catalog: StageCatalog = {
        entries: [permanent[0]!, ...activity.entries, ...permanent.slice(1)],
        updatedAt: Date.now(),
        ...(activity.warning ? { warning: activity.warning } : {}),
      };
      stageCache = { key: cacheKey, at: Date.now(), catalog };
      return catalog;
    });

    const checkCoreUpdate = installer.checkUpdate;

    /**
     * Installing a core never touches the running one; switching to it does
     * change which version the next connection uses, so a live session or an
     * active run keeps the current selection and the switch waits.
     */
    const downloadCore = Effect.gen(function* () {
      const core = yield* installer.downloadStable;
      if (!core) return null;
      const cores = yield* registry.list;
      bus.emit({ _tag: "cores-updated", cores });

      const currentSettings = yield* settings.get;
      if (currentSettings.activeCoreId === core.id) return core;

      const running = runActive();
      const liveSession = [...runtime.values()].some((state) => state.sessionId !== undefined);
      if (liveSession || running) {
        bus.emit({
          _tag: "toast",
          kind: "info",
          title: "核心已安装",
          message: running ? "任务结束后可在设置中切换" : "可在设置中切换",
        });
        return core;
      }

      settingsCache = yield* settings.update({ activeCoreId: core.id });
      bus.emit({ _tag: "toast", kind: "success", title: "已切换到新核心", message: core.version });
      return core;
    });

    const setActiveCore = (id: string) =>
      Effect.gen(function* () {
        if (runActive()) return yield* maaxError("任务运行中不能切换内核");
        const cores = yield* registry.list;
        if (!cores.some((core) => core.id === id && core.status === "ready")) {
          return yield* maaxError("核心不可用");
        }
        const next = yield* settings.update({ activeCoreId: id });
        bus.emit({ _tag: "cores-updated", cores });
        return { settings: next, cores };
      });

    const discoverDevices = (adbPath: string): Effect.Effect<DeviceDiscovery> =>
      Effect.promise(() => discoverAdbDevices({ adbPath }));

    const addDevice = (draft: DeviceDraft) =>
      Effect.gen(function* () {
        const { device } = yield* workspace.addDevice(draft);
        profiles.set(device.id, device);
        plans = [...(yield* workspace.getPlans)];
        runtime.set(device.id, { status: "offline" });
        emitDevice(device.id);
        const view = viewFor(device.id);
        if (!view) return yield* maaxError("创建设备失败");
        return view;
      });

    const updateDevice = (id: string, patch: Partial<DeviceDraft>) =>
      Effect.gen(function* () {
        const profile = yield* workspace.updateDevice(id, patch);
        profiles.set(id, profile);
        emitDevice(id);
        const view = viewFor(id);
        if (!view) return yield* maaxError("设备不存在");
        return view;
      });

    const removeDevice = (id: string) =>
      Effect.gen(function* () {
        cancelReconnect(id);
        // A pending connect must not settle a device that no longer exists.
        abortConnectWaiter(id, "设备已删除");
        const existingRun = runs.get(id);
        if (existingRun && (existingRun.snapshot.status === "running" || existingRun.snapshot.status === "preparing")) {
          yield* stopRunInternal(id).pipe(Effect.ignore);
        }
        const state = runtime.get(id);
        if (state?.sessionId && state.hostKey) {
          const host = hosts.get(state.hostKey);
          if (host) {
            yield* Effect.tryPromise({
              try: () => host.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
        }
        yield* workspace.removeDevice(id);
        yield* schedules.remove(id);
        yield* toolData.clear(id);
        detachDevice(id);
        profiles.delete(id);
        runtime.delete(id);
        runs.delete(id);
        plans = [...(yield* workspace.getPlans)];
        bus.emit({ _tag: "schedules-updated", schedules: [...(yield* schedules.list)] });
        emitEngine();
        return views();
      });

    const savePlan = (plan: TaskPlan) =>
      Effect.gen(function* () {
        const saved = yield* workspace.savePlan(plan);
        plans = plans.map((item) => (item.id === saved.id ? saved : item));
        emitPlans();
        return saved;
      });

    const removePlan = (id: string) =>
      Effect.gen(function* () {
        const next = yield* workspace.removePlan(id);
        plans = [...next];
        const deviceIds = [...profiles.keys()];
        yield* refreshLocalState;
        emitPlans();
        for (const deviceId of deviceIds) emitDevice(deviceId);
        return next;
      });

    /* ---------------------------------------------------------------------- */
    /* Task plans                                                              */
    /* ---------------------------------------------------------------------- */

    const uniquePlanName = (deviceId: string, base: string): string => {
      const taken = new Set(plans.filter((plan) => plan.deviceId === deviceId).map((plan) => plan.name));
      if (!taken.has(base)) return base;
      let index = 2;
      while (taken.has(`${base} ${index}`)) index += 1;
      return `${base} ${index}`;
    };

    const setActivePlan = (deviceId: string, planId: string) =>
      Effect.gen(function* () {
        const profile = yield* workspace.setActivePlan(deviceId, planId);
        profiles.set(deviceId, profile);
        emitDevice(deviceId);
        const view = viewFor(deviceId);
        if (!view) return yield* maaxError("设备不存在");
        return view;
      });

    const emitPlans = (): void => {
      bus.emit({ _tag: "plans-updated", plans: [...plans] });
    };

    const createPlan = (deviceId: string, name: string) =>
      Effect.gen(function* () {
        if (!profiles.has(deviceId)) return yield* maaxError("设备不存在");
        const now = Date.now();
        const plan: TaskPlan = {
          id: randomUUID(),
          deviceId,
          name: uniquePlanName(deviceId, name.trim() || "计划"),
          tasks: [...createDefaultPlanTasks()],
          createdAt: now,
          updatedAt: now,
        };
        yield* workspace.addPlan(plan);
        plans = [...(yield* workspace.getPlans)];
        emitPlans();
        yield* setActivePlan(deviceId, plan.id);
        return plan;
      });

    const duplicatePlan = (planId: string, name?: string) =>
      Effect.gen(function* () {
        const source = yield* workspace.getPlan(planId);
        if (!source) return yield* maaxError("任务计划不存在");
        const now = Date.now();
        const copy: TaskPlan = {
          id: randomUUID(),
          deviceId: source.deviceId,
          name: uniquePlanName(source.deviceId, name?.trim() || `${source.name} copy`),
          tasks: source.tasks.map((task) => ({ ...task, id: randomUUID(), params: { ...task.params } })),
          createdAt: now,
          updatedAt: now,
        };
        yield* workspace.addPlan(copy);
        plans = [...(yield* workspace.getPlans)];
        emitPlans();
        return copy;
      });

    const renamePlan = (planId: string, name: string) =>
      Effect.gen(function* () {
        const trimmed = name.trim();
        if (trimmed === "") return yield* maaxError("计划名称不能为空");
        const plan = yield* workspace.getPlan(planId);
        if (!plan) return yield* maaxError("任务计划不存在");
        const saved = yield* workspace.savePlan({ ...plan, name: trimmed });
        plans = plans.map((item) => (item.id === saved.id ? saved : item));
        emitPlans();
        return saved;
      });

    const PlanImportSchema = Schema.Struct({
      name: Schema.optional(Schema.String),
      tasks: Schema.Array(TaskConfigSchema),
    });

    const importPlan = (deviceId: string) =>
      Effect.gen(function* () {
        if (!profiles.has(deviceId)) return yield* maaxError("设备不存在");
        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "导入任务计划",
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile" as const],
        };
        const picked = yield* Effect.tryPromise({
          try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
          catch: (cause) => maaxError("打开文件对话框失败", cause),
        });
        const path = picked.filePaths[0];
        if (picked.canceled || path === undefined) return null;

        const raw = yield* Effect.tryPromise({
          try: async (): Promise<unknown> => JSON.parse(await readFile(path, "utf8")) as unknown,
          catch: (cause) => maaxError("读取计划文件失败", cause),
        });
        const imported = yield* Schema.decodeUnknownEffect(PlanImportSchema)(raw).pipe(
          Effect.mapError((cause) => maaxError("计划文件格式无效", cause)),
        );
        const now = Date.now();
        const plan: TaskPlan = {
          id: randomUUID(),
          deviceId,
          name: uniquePlanName(deviceId, imported.name?.trim() || basename(path, extname(path))),
          tasks: imported.tasks.map((task) => ({ ...task, id: randomUUID() })),
          createdAt: now,
          updatedAt: now,
        };
        yield* workspace.addPlan(plan);
        plans = [...(yield* workspace.getPlans)];
        emitPlans();
        yield* setActivePlan(deviceId, plan.id);
        return plan;
      });

    const exportPlan = (planId: string) =>
      Effect.gen(function* () {
        const plan = yield* workspace.getPlan(planId);
        if (!plan) return yield* maaxError("任务计划不存在");
        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "导出任务计划",
          defaultPath: `${plan.name.replace(/[^\w\u4e00-\u9fa5-]+/gu, "-")}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        };
        const picked = yield* Effect.tryPromise({
          try: () => (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)),
          catch: (cause) => maaxError("打开保存对话框失败", cause),
        });
        if (picked.canceled || !picked.filePath) return null;
        const payload = { version: 1, name: plan.name, tasks: plan.tasks };
        yield* Effect.tryPromise({
          try: () => writeFile(picked.filePath!, JSON.stringify(payload, null, 2), "utf8"),
          catch: (cause) => maaxError("写入计划文件失败", cause),
        });
        return picked.filePath;
      });

    /** Pick a battle recording for the VideoRecognition task; the core reads the path itself. */
    const pickVideoFile: Effect.Effect<string | null, MaaxError> = Effect.gen(function* () {
      const window = BrowserWindow.getFocusedWindow();
      const options = {
        title: "选择作战录像",
        filters: [{ name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "flv", "webm"] }],
        properties: ["openFile" as const],
      };
      const picked = yield* Effect.tryPromise({
        try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
        catch: (cause) => maaxError("打开文件对话框失败", cause),
      });
      const path = picked.filePaths[0];
      return picked.canceled || path === undefined ? null : path;
    });

    /** Import a copilot JSON into the app data directory and return its path. */
    const importCopilotFile: Effect.Effect<CopilotFile | null, MaaxError> = Effect.gen(function* () {
      const window = BrowserWindow.getFocusedWindow();
      const options = {
        title: "导入作业文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile" as const],
      };
      const picked = yield* Effect.tryPromise({
        try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
        catch: (cause) => maaxError("打开文件对话框失败", cause),
      });
      const path = picked.filePaths[0];
      if (picked.canceled || path === undefined) return null;

      const text = yield* Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (cause) => maaxError("读取作业文件失败", cause),
      });
      yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
        Effect.mapError(() => maaxError("作业文件不是有效的 JSON", path)),
      );

      const base = basename(path, extname(path)).replace(/[^\w\u4e00-\u9fa5.-]+/gu, "-") || "copilot";
      yield* Effect.promise(() => mkdir(paths.copilotDir, { recursive: true }));
      for (let index = 1; index < 100; index += 1) {
        const name = index === 1 ? base : `${base}-${index}`;
        const target = join(paths.copilotDir, `${name}.json`);
        const exists = yield* Effect.promise(() =>
          readFile(target, "utf8").then(
            () => true,
            () => false,
          ),
        );
        if (exists) continue;
        yield* Effect.tryPromise({
          try: () => writeFile(target, text, "utf8"),
          catch: (cause) => maaxError("写入作业文件失败", cause),
        });
        return { filename: target, name };
      }
      return yield* maaxError("同名作业文件过多，请先清理", paths.copilotDir);
    });

    /* ---------------------------------------------------------------------- */
    /* Component manager: repair and relocate                                  */
    /* ---------------------------------------------------------------------- */

    const failCoreAction = (title: string) => (error: MaaxError) =>
      Effect.sync(() => {
        bus.emit({ _tag: "toast", kind: "error", title, message: error.message });
      });

    const repairCore = (id: string) =>
      Effect.gen(function* () {
        const core = yield* registry.get(id);
        if (!core) return yield* maaxError("核心不存在");
        yield* ensureCoreIdle(id);
        yield* releaseCoreHosts(id);
        const repaired = yield* installer.repair(core).pipe(Effect.tapError(failCoreAction("核心修复失败")));
        const cores = yield* registry.list;
        bus.emit({ _tag: "cores-updated", cores });
        bus.emit({ _tag: "toast", kind: "success", title: "核心已修复", message: repaired.version });
        return cores;
      });

    const moveCore = (id: string) =>
      Effect.gen(function* () {
        const core = yield* registry.get(id);
        if (!core) return yield* maaxError("核心不存在");
        if (!core.managed) {
          return yield* maaxError("只能移动由 MaaX 下载安装的核心", "导入的核心请重新选择目录");
        }
        yield* ensureCoreIdle(id);
        yield* releaseCoreHosts(id);

        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "选择新的核心存放目录",
          buttonLabel: "移动到这里",
          properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
        };
        const picked = yield* Effect.tryPromise({
          try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
          catch: (cause) => maaxError("打开目录对话框失败", cause),
        });
        const parent = picked.filePaths[0];
        if (picked.canceled || parent === undefined) return yield* registry.list;

        const target = join(parent, basename(core.root));
        if (resolve(target) === resolve(core.root)) return yield* registry.list;
        const exists = yield* Effect.promise(() =>
          stat(target).then(
            () => true,
            () => false,
          ),
        );
        if (exists) return yield* maaxError("目标目录已经存在", target);

        const move = (from: string, to: string): Promise<void> =>
          rename(from, to).catch(async (error: NodeJS.ErrnoException) => {
            if (error.code !== "EXDEV") throw error;
            await cp(from, to, { recursive: true, force: false, errorOnExist: true });
            await rm(from, { recursive: true, force: true });
          });

        yield* Effect.tryPromise({
          try: () => move(core.root, target),
          catch: (cause) => maaxError("移动核心目录失败", cause),
        });
        const relocated = yield* registry.relocate(id, target).pipe(
          Effect.tapError(() => Effect.promise(() => move(target, core.root).catch(() => undefined))),
          Effect.tapError(failCoreAction("核心移动失败")),
        );
        const cores = yield* registry.list;
        bus.emit({ _tag: "cores-updated", cores });
        bus.emit({ _tag: "toast", kind: "success", title: "核心已移动", message: relocated.root });
        return cores;
      });

    /* ---------------------------------------------------------------------- */
    /* Tools, history and schedules                                            */
    /* ---------------------------------------------------------------------- */

    const recruitmentData = Effect.gen(function* () {
      const core = yield* ensureActiveCore();
      return yield* toolData.recruitment(core);
    });

    const startTool = (deviceId: string, kind: ToolKind) =>
      Effect.gen(function* () {
        yield* ensureDeviceIdle(deviceId);
        const type = kind === "operbox" ? "OperBox" : "Depot";
        const task = createTask(type);
        return yield* launchTasks(deviceId, [task]);
      });

    const saveSchedule = (schedule: Schedule) =>
      Effect.gen(function* () {
        if (!profiles.has(schedule.deviceId)) return yield* maaxError("设备不存在");
        if (
          schedule.planId !== undefined &&
          !plans.some((plan) => plan.id === schedule.planId && plan.deviceId === schedule.deviceId)
        ) {
          return yield* maaxError("任务计划不存在");
        }
        const next = yield* schedules.save(schedule);
        bus.emit({ _tag: "schedules-updated", schedules: [...next] });
        return next;
      });

    const runHistory: Effect.Effect<RunHistory> = history.result;
    const clearHistory: Effect.Effect<RunHistory> = history.clear.pipe(
      Effect.tap((value) => Effect.sync(() => bus.emit({ _tag: "history-updated", history: value }))),
    );

    const stampForFile = (): string => new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);

    const formatLogEntries = (entries: ReadonlyArray<LogEntry>): string =>
      entries
        .map((entry) => `${new Date(entry.at).toISOString()} [${entry.level.toUpperCase()}] ${entry.message}`)
        .join("\n") + "\n";

    const exportLogs = (entries: ReadonlyArray<LogEntry>): Effect.Effect<string | null, MaaxError> =>
      Effect.gen(function* () {
        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "导出运行日志",
          defaultPath: `maax-logs-${stampForFile()}.log`,
          filters: [{ name: "Log", extensions: ["log", "txt"] }],
        };
        const picked = yield* Effect.tryPromise({
          try: () => (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)),
          catch: (cause) => maaxError("打开保存对话框失败", cause),
        });
        if (picked.canceled || !picked.filePath) return null;
        const header = `# Maax ${app.getVersion()} logs\n# Exported ${new Date().toISOString()}\n\n`;
        yield* Effect.tryPromise({
          try: () => writeFile(picked.filePath!, header + formatLogEntries(entries), "utf8"),
          catch: (cause) => maaxError("写入日志文件失败", cause),
        });
        return picked.filePath;
      });

    const exportDiagnostics = (entries: ReadonlyArray<LogEntry>): Effect.Effect<string | null, MaaxError> =>
      Effect.gen(function* () {
        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "选择诊断包存放目录",
          buttonLabel: "导出到这里",
          properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
        };
        const picked = yield* Effect.tryPromise({
          try: () => (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)),
          catch: (cause) => maaxError("打开目录对话框失败", cause),
        });
        const parent = picked.filePaths[0];
        if (picked.canceled || parent === undefined) return null;

        const cores = yield* registry.list;
        const historyResult = yield* history.result;
        const scheduleList = yield* schedules.list;
        const tools = yield* toolData.state;
        const copilot = yield* copilotSetup.get;
        const base = join(parent, `maax-diagnostics-${stampForFile()}`);
        const bundle = yield* Effect.tryPromise({
          try: async () => {
            let target = base;
            for (let index = 2; index < 100; index += 1) {
              const exists = await stat(target).then(
                () => true,
                () => false,
              );
              if (!exists) break;
              target = `${base}-${index}`;
            }
            await mkdir(target, { recursive: false });
            const summary = {
              generatedAt: new Date().toISOString(),
              runtime: readRuntimeInfo(),
              settings: settingsCache,
              engine,
              cores,
              devices: [...profiles.values()],
              counts: { plans: plans.length, schedules: scheduleList.length, runs: historyResult.stats.total },
            };
            const files: ReadonlyArray<[string, string]> = [
              ["summary.json", JSON.stringify(summary, null, 2)],
              ["workspace.json", JSON.stringify({ plans }, null, 2)],
              ["schedules.json", JSON.stringify(scheduleList, null, 2)],
              ["history.json", JSON.stringify(historyResult, null, 2)],
              ["tools.json", JSON.stringify(tools, null, 2)],
              ["copilot.json", JSON.stringify(copilot, null, 2)],
              ["logs.txt", formatLogEntries(entries)],
              [
                "README.txt",
                [
                  `Maax ${app.getVersion()} diagnostics bundle`,
                  `Generated ${new Date().toISOString()}`,
                  "",
                  "This bundle contains local configuration, device addresses, installed",
                  "core paths and recent run logs. Review it before sharing publicly.",
                ].join("\n") + "\n",
              ],
            ];
            await Promise.all(files.map(([name, text]) => writeFile(join(target, name), text, "utf8")));
            return target;
          },
          catch: (cause) => maaxError("写入诊断包失败", cause),
        });
        bus.emit({ _tag: "toast", kind: "success", title: "诊断包已导出", message: bundle });
        return bundle;
      });

    /**
     * The scheduler only runs while MAAX is open (tray mode keeps it alive).
     * A due schedule starts the device's plan even if the device is offline,
     * because connecting is part of the scheduled operation.
     */
    let schedulerTimer: NodeJS.Timeout | undefined;
    let schedulerStartTimer: NodeJS.Timeout | undefined;
    let schedulerBusy = false;

    const markSchedule = (
      deviceId: string,
      at: number,
      status: NonNullable<Schedule["lastStatus"]>,
      message?: string,
    ) =>
      schedules
        .markTriggered(deviceId, at, status, message)
        .pipe(Effect.tap((next) => Effect.sync(() => bus.emit({ _tag: "schedules-updated", schedules: [...next] }))));

    const runDueSchedules: Effect.Effect<void> = Effect.gen(function* () {
      const list = yield* schedules.list;
      const now = Date.now();
      for (const schedule of list) {
        if (!scheduleDue(schedule, now).due) continue;
        const device = profiles.get(schedule.deviceId);
        if (!device) {
          const next = yield* schedules.remove(schedule.deviceId);
          bus.emit({ _tag: "schedules-updated", schedules: [...next] });
          continue;
        }
        const plan =
          (schedule.planId === undefined ? undefined : plans.find((item) => item.id === schedule.planId)) ??
          plans.find((item) => item.id === device.activePlanId) ??
          plans.find((item) => item.deviceId === device.id);
        if (!plan) {
          yield* markSchedule(device.id, now, "failed", "没有可用的任务计划");
          bus.emit({ _tag: "toast", kind: "error", title: "定时任务未启动", message: device.name });
          continue;
        }

        const current = runs.get(device.id);
        if (current && (current.snapshot.status === "running" || current.snapshot.status === "preparing")) {
          yield* markSchedule(device.id, now, "skipped", "设备正在运行任务");
          continue;
        }
        if (runtime.get(device.id)?.status === "connecting") {
          yield* markSchedule(device.id, now, "skipped", "设备正在连接");
          continue;
        }

        const attempt = Effect.gen(function* () {
          if (!runtime.get(device.id)?.sessionId) yield* connectDevice(device.id);
          yield* startRun(device.id, plan.id);
          yield* markSchedule(device.id, now, "started");
          bus.emit({
            _tag: "toast",
            kind: "success",
            title: "定时任务已开始",
            message: `${device.name} · ${plan.name}`,
          });
          log("info", `定时任务已开始：${device.name} / ${plan.name}`);
        });

        yield* attempt.pipe(
          Effect.catch((error: MaaxError) =>
            Effect.gen(function* () {
              const message = error.detail ? `${error.message}：${error.detail}` : error.message;
              yield* markSchedule(device.id, now, "failed", message);
              bus.emit({ _tag: "toast", kind: "error", title: "定时任务启动失败", message });
              log("warn", `定时任务启动失败：${message}`);
            }),
          ),
        );
      }
    });

    const checkSchedules = (): void => {
      if (shuttingDown || schedulerBusy) return;
      schedulerBusy = true;
      // Timer callbacks are a boundary outside Effect; the program itself uses
      // the services captured by this layer.
      // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
      void Effect.runPromise(runDueSchedules)
        .catch((error: unknown) => console.warn("Scheduled run check failed", error))
        .finally(() => {
          schedulerBusy = false;
        });
    };

    schedulerTimer = setInterval(checkSchedules, 20_000);
    schedulerStartTimer = setTimeout(checkSchedules, 8_000);

    const shutdown = Effect.gen(function* () {
      shuttingDown = true;
      if (schedulerTimer !== undefined) clearInterval(schedulerTimer);
      if (schedulerStartTimer !== undefined) clearTimeout(schedulerStartTimer);
      for (const deviceId of reconnectTimers.keys()) cancelReconnect(deviceId);
      for (const host of hosts.values()) {
        yield* Effect.tryPromise({ try: () => host.client.stop(), catch: () => undefined }).pipe(Effect.ignore);
      }
      hosts.clear();
      yield* Effect.promise(() => Promise.all(stoppingHosts.values()));
      // MaaCore starts the ADB daemon and leaves it running: it outlives the app
      // and keeps holding its port (and the fds it inherited). Stop the one this
      // app started now that no host is using it.
      yield* Effect.promise(() => releaseAdbServer());
    });

    const api: ApplicationApi = {
      bootstrap,
      getDevices: Effect.sync(views),
      getPlans: Effect.sync(() => plans),
      updateSettings,
      addCore,
      removeCore,
      refreshCores,
      downloadCore,
      checkCoreUpdate,
      repairCore,
      moveCore,
      setActiveCore,
      discoverDevices,
      addDevice,
      updateDevice,
      removeDevice,
      connectDevice,
      disconnectDevice,
      screenshotDevice,
      stageCatalog,
      savePlan,
      removePlan,
      createPlan,
      duplicatePlan,
      renamePlan,
      importPlan,
      exportPlan,
      setActivePlan,
      importCopilotFile,
      pickVideoFile,
      resolveCopilot: prts.resolve,
      readCopilotDetail: prts.detail,
      searchCopilot: prts.search,
      copilotSetSearch: prts.setSearch,
      copilotSetItems: prts.setItems,
      copilotLevels: prts.levels,
      copilotOperators,
      roguelikeOperators,
      operatorAvatars,
      updateCopilotOptions: (patch) =>
        copilotSetup.updateOptions(patch).pipe(Effect.tap((setup) => Effect.sync(() => emitCopilot(setup)))),
      setCopilotItems: (items) =>
        copilotSetup.setItems(items).pipe(Effect.tap((setup) => Effect.sync(() => emitCopilot(setup)))),
      startCopilot,
      startRun,
      stopRun,
      runHistory,
      clearHistory,
      saveSchedule,
      recruitmentData,
      startTool,
      exportLogs,
      exportDiagnostics,
      resourceStatus,
      checkResourceUpdate,
      updateResource,
      rollbackResource,
      shutdown,
    };
    return api;
  }),
);
