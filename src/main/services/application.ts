import { Context, Effect, Layer, Schema } from "effect";
import { BrowserWindow, Notification, app, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { basename, extname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  Bootstrap,
  CoreInfo,
  CopilotFile,
  CopilotLevel,
  CopilotOptions,
  CopilotResolveResult,
  CopilotSetup,
  OperatorEntry,
  CopilotSearchResult,
  CoreReleaseCheck,
  DeviceDraft,
  DeviceProfile,
  DeviceStatus,
  DeviceView,
  EngineInfo,
  ScreencapCost,
  Resolution,
  ResourceApplyResult,
  ResourceCheck,
  ResourceStatus,
  RunSnapshot,
  Screenshot,
  StageCatalog,
  StageCatalogEntry,
  TaskPlan,
  RuntimeInfo,
} from "../../shared/schemas";
import type { AppendTaskResult, ConnectResult, EngineCallback, InitResult } from "../../shared/engine";
import { TaskConfigSchema } from "../../shared/schemas";
import type { TaskConfig } from "../../shared/schemas";
import { buildMaaTaskParams, createCopilotTask, createDefaultPlanTasks, firstMissingField } from "../../shared/tasks";
import { completeTask, failTask, finishSnapshot, runCallbackAction, startTask } from "../run-projection";
import { probeAdbConnection } from "./adb";

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
import type { CopilotSearchParams } from "./copilot";
import { CoreRegistry } from "./core-registry";
import { CoreInstaller } from "./core-installer";
import { maaxError, type MaaxError } from "../errors";
import { EventBus } from "../events";
import { AppPaths } from "./paths";
import { CopilotSetupStore } from "./copilot-setup";
import { OperatorCatalogue } from "./operator-catalog";
import { PrtsLibrary } from "./prts-library";
import { ResourceUpdater, type ResourceProgress } from "./resource-updater";
import { Settings } from "./settings";
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

interface RunState {
  snapshot: RunSnapshot;
  readonly taskConfigIds: Map<number, string>;
  readonly hostKey: string;
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
  readonly setActiveCore: (
    id: string,
  ) => Effect.Effect<{ settings: AppSettings; cores: ReadonlyArray<CoreInfo> }, MaaxError>;
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
  readonly searchCopilot: (params: CopilotSearchParams) => Effect.Effect<CopilotSearchResult, MaaxError>;
  readonly copilotLevels: (query: string) => Effect.Effect<ReadonlyArray<CopilotLevel>, MaaxError>;
  readonly copilotOperators: (query: string) => Effect.Effect<ReadonlyArray<OperatorEntry>, MaaxError>;
  readonly updateCopilotOptions: (patch: Partial<CopilotOptions>) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly setCopilotItems: (items: CopilotSetup["items"]) => Effect.Effect<CopilotSetup, MaaxError>;
  readonly startCopilot: (deviceId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly startRun: (deviceId: string, planId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly stopRun: (deviceId: string) => Effect.Effect<RunSnapshot, MaaxError>;
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

    const emitCopilot = (setup: CopilotSetup): void => {
      bus.emit({ _tag: "copilot-updated", copilot: setup });
    };
    const operatorCatalogue = new OperatorCatalogue();

    /**
     * Operators come from the active core's `resource/battle_data.json`, so the
     * list always matches the installed game data and costs no request.
     */
    const copilotOperators = (query: string) =>
      Effect.gen(function* () {
        const currentSettings = yield* settings.get;
        const ready = (yield* registry.list).filter((core) => core.status === "ready");
        const active = currentSettings.activeCoreId
          ? ready.find((core) => core.id === currentSettings.activeCoreId)
          : ready[0];
        if (!active) return yield* maaxError("没有可用的核心，无法读取干员数据");
        return yield* Effect.tryPromise({
          try: () => operatorCatalogue.search(join(active.root, "resource"), query),
          catch: (cause) => maaxError("无法读取干员数据", cause),
        });
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

    const finishRun = (deviceId: string, status: RunSnapshot["status"], message?: string): void => {
      const run = runs.get(deviceId);
      if (!run) return;
      const next = finishSnapshot(run.snapshot, status, Date.now(), message);
      if (next === run.snapshot) return;
      run.snapshot = next;
      emitRun(run);
      setDeviceState(deviceId, { status: "online", lastError: message });
      emitDevice(deviceId);
      emitEngine();
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

    const stopHost = (key: string): void => {
      const host = hosts.get(key);
      if (!host) return;
      hosts.delete(key);
      host.devices.clear();
      void host.client.stop().catch(() => undefined);
    };

    const releaseHostIfIdle = (key: string): void => {
      const host = hosts.get(key);
      if (!host || host.devices.size > 0) return;
      stopHost(key);
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
          run.snapshot = completeTask(run.snapshot, action.taskId, Date.now());
          emitRun(run);
          break;
        case "task-failed":
          run.snapshot = failTask(run.snapshot, action.taskId, action.message, Date.now());
          emitRun(run);
          break;
        case "run-stopped":
          finishRun(deviceId, "stopped");
          break;
        case "queue-finished": {
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
        const adbPath = profile.adbPath || settingsCache?.adbPath || "adb";
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
        return run.snapshot;
      });

    /** Append a batch of tasks to the device's session and start it. */
    const launchTasks = (deviceId: string, tasks: ReadonlyArray<TaskConfig>, planId?: string) =>
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
        const run: RunState = { snapshot, taskConfigIds: new Map(), hostKey: host.key };
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
    const startCopilot = (deviceId: string) =>
      Effect.gen(function* () {
        yield* ensureDeviceIdle(deviceId);
        const setup = yield* copilotSetup.get;
        if (setup.items.length === 0) return yield* maaxError("请先添加作业");
        const task = createCopilotTask(setup);
        const missing = firstMissingField(task);
        if (missing) return yield* maaxError(`任务「${task.name || task.type}」缺少必备设置`, missing.zh);
        return yield* launchTasks(deviceId, [task]);
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
      return {
        runtime: readRuntimeInfo(),
        settings: settingsCache,
        cores,
        devices: views(),
        plans,
        engine,
        copilot: yield* copilotSetup.get,
      } satisfies Bootstrap;
    });

    const updateSettings = (patch: AppSettingsPatch) =>
      Effect.gen(function* () {
        const next = yield* settings.update(patch);
        settingsCache = next;
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

    const releaseCoreHosts = (coreId: string): void => {
      let stopped = false;
      for (const [key, host] of hosts) {
        if (host.core.id !== coreId) continue;
        stopHost(key);
        stopped = true;
      }
      if (stopped) emitEngine();
    };

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
        releaseCoreHosts(coreId);
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
        releaseCoreHosts(coreId);
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
          warning:
            locale === "zh-CN"
              ? "活动关卡获取失败，已显示常驻推荐关卡。"
              : "Could not load event stages; showing permanent recommendations.",
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
        detachDevice(id);
        profiles.delete(id);
        runtime.delete(id);
        runs.delete(id);
        plans = [...(yield* workspace.getPlans)];
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

    const shutdown = Effect.gen(function* () {
      shuttingDown = true;
      for (const deviceId of reconnectTimers.keys()) cancelReconnect(deviceId);
      for (const host of hosts.values()) {
        yield* Effect.tryPromise({ try: () => host.client.stop(), catch: () => undefined }).pipe(Effect.ignore);
      }
      hosts.clear();
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
      setActiveCore,
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
      searchCopilot: prts.search,
      copilotLevels: prts.levels,
      copilotOperators,
      updateCopilotOptions: (patch) =>
        copilotSetup.updateOptions(patch).pipe(Effect.tap((setup) => Effect.sync(() => emitCopilot(setup)))),
      setCopilotItems: (items) =>
        copilotSetup.setItems(items).pipe(Effect.tap((setup) => Effect.sync(() => emitCopilot(setup)))),
      startCopilot,
      startRun,
      stopRun,
      resourceStatus,
      checkResourceUpdate,
      updateResource,
      rollbackResource,
      shutdown,
    };
    return api;
  }),
);
