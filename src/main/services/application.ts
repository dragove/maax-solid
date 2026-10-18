import { Context, Effect, Layer } from "effect";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";
import type {
  AppSettings,
  AppSettingsPatch,
  Bootstrap,
  CoreInfo,
  DeviceDraft,
  DeviceProfile,
  DeviceStatus,
  DeviceView,
  EngineInfo,
  Resolution,
  RunSnapshot,
  Screenshot,
  TaskPlan,
  RuntimeInfo,
} from "../../shared/schemas";
import type {
  AppendTaskResult,
  ConnectResult,
  EngineCallback,
  InitResult,
} from "../../shared/engine";
import { buildMaaTaskParams } from "../../shared/tasks";
import { CoreHostClient } from "../core-host-client";
import { CoreRegistry } from "./core-registry";
import { CoreInstaller } from "./core-installer";
import { maaxError, type MaaxError } from "../errors";
import { EventBus } from "../events";
import { AppPaths } from "./paths";
import { Settings } from "./settings";
import { Workspace } from "./workspace";

interface HostEntry {
  readonly key: string;
  readonly core: CoreInfo;
  readonly server: string;
  readonly client: CoreHostClient;
  version: string;
  refs: number;
}

interface RuntimeDevice {
  status: DeviceStatus;
  sessionId?: string;
  hostKey?: string;
  engineVersion?: string;
  resolution?: Resolution;
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
  readonly setActiveCore: (
    id: string,
  ) => Effect.Effect<{ settings: AppSettings; cores: ReadonlyArray<CoreInfo> }, MaaxError>;
  readonly addDevice: (draft: DeviceDraft) => Effect.Effect<DeviceView, MaaxError>;
  readonly updateDevice: (
    id: string,
    patch: Partial<DeviceDraft>,
  ) => Effect.Effect<DeviceView, MaaxError>;
  readonly removeDevice: (id: string) => Effect.Effect<ReadonlyArray<DeviceView>>;
  readonly connectDevice: (id: string) => Effect.Effect<DeviceView, MaaxError>;
  readonly disconnectDevice: (id: string) => Effect.Effect<DeviceView, MaaxError>;
  readonly screenshotDevice: (id: string) => Effect.Effect<Screenshot, MaaxError>;
  readonly savePlan: (plan: TaskPlan) => Effect.Effect<TaskPlan, MaaxError>;
  readonly removePlan: (id: string) => Effect.Effect<ReadonlyArray<TaskPlan>>;
  readonly startRun: (deviceId: string, planId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly stopRun: (deviceId: string) => Effect.Effect<RunSnapshot, MaaxError>;
  readonly shutdown: Effect.Effect<void>;
}

export class Application extends Context.Service<Application, ApplicationApi>()(
  "maax/Application",
) {}

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
  AppPaths | CoreRegistry | CoreInstaller | EventBus | Settings | Workspace
> = Layer.effect(
  Application,
  Effect.gen(function* () {
    const paths = yield* AppPaths;
    const settings = yield* Settings;
    const workspace = yield* Workspace;
    const registry = yield* CoreRegistry;
    const installer = yield* CoreInstaller;
    const bus = yield* EventBus;

    const hosts = new Map<string, HostEntry>();
    const runtime = new Map<string, RuntimeDevice>();
    const runs = new Map<string, RunState>();
    interface ConnectWaiter {
      readonly resolve: (result: { ok: boolean; message?: string }) => void;
      readonly timer: NodeJS.Timeout;
    }
    const connectWaiters = new Map<string, ConnectWaiter>();
    let profiles: Map<string, DeviceProfile> = new Map();
    let plans: TaskPlan[] = [];
    let engine: EngineInfo = { phase: "idle", sessionCount: 0 };
    let shuttingDown = false;

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
      const phase =
        hosts.size === 0 ? "idle" : running ? "running" : anyStarting ? "starting" : "ready";
      const message = phase === "starting" ? "正在加载 MaaCore…" : undefined;
      return {
        phase,
        ...(activeHost
          ? { coreId: activeHost.core.id, coreVersion: activeHost.version || undefined }
          : {}),
        sessionCount: [...runtime.values()].filter((device) => device.sessionId !== undefined)
          .length,
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
      if (
        !run ||
        run.snapshot.status === "completed" ||
        run.snapshot.status === "failed" ||
        run.snapshot.status === "stopped"
      ) {
        return;
      }
      run.snapshot = {
        ...run.snapshot,
        status,
        endedAt: Date.now(),
        ...(message ? { message } : {}),
        tasks: run.snapshot.tasks.map((task) =>
          task.status === "running" || task.status === "pending"
            ? { ...task, status: status === "failed" ? "failed" : "stopped", endedAt: Date.now() }
            : task,
        ),
      };
      emitRun(run);
      setDeviceState(deviceId, { status: "online", lastError: message });
      emitDevice(deviceId);
      emitEngine();
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

      const run = runs.get(deviceId);
      if (!run) return;
      const taskId = Number(payload.taskid ?? 0);

      if (item.msg === 10001) {
        run.snapshot = {
          ...run.snapshot,
          status: "running",
          currentTaskId: taskId,
          tasks: run.snapshot.tasks.map((entry) =>
            entry.taskId === taskId
              ? { ...entry, status: "running", startedAt: Date.now() }
              : entry,
          ),
        };
        setDeviceState(deviceId, { status: "running" });
        emitDevice(deviceId);
        emitRun(run);
        emitEngine();
      } else if (item.msg === 10002) {
        run.snapshot = {
          ...run.snapshot,
          tasks: run.snapshot.tasks.map((entry) =>
            entry.taskId === taskId
              ? { ...entry, status: "completed", endedAt: Date.now() }
              : entry,
          ),
        };
        emitRun(run);
      } else if (item.msg === 10000) {
        const message = typeof payload.why === "string" ? payload.why : "任务出错";
        run.snapshot = {
          ...run.snapshot,
          message,
          tasks: run.snapshot.tasks.map((entry) =>
            entry.taskId === taskId
              ? { ...entry, status: "failed", endedAt: Date.now(), message }
              : entry,
          ),
        };
        emitRun(run);
      } else if (item.msg === 10004) {
        finishRun(deviceId, "stopped");
      } else if (item.msg === 3) {
        const failed = run.snapshot.tasks.some((task) => task.status === "failed");
        finishRun(deviceId, failed ? "failed" : "completed");
      }
    };

    const handleHostExit = (key: string, reason: string): void => {
      const host = hosts.get(key);
      if (!host) return;
      hosts.delete(key);
      engine = { ...engine, phase: "crashed", message: reason };
      for (const [deviceId, state] of runtime) {
        if (state.hostKey === key) {
          runtime.set(deviceId, {
            status: "error",
            lastError: reason,
          });
          const run = runs.get(deviceId);
          if (run && (run.snapshot.status === "running" || run.snapshot.status === "preparing")) {
            finishRun(deviceId, "failed", reason);
          }
          emitDevice(deviceId);
        }
      }
      bus.emit({ _tag: "engine-updated", engine });
      if (!shuttingDown) {
        bus.emit({ _tag: "toast", kind: "error", title: "MaaCore 已退出", message: reason });
      }
    };

    const ensureActiveCore = (): Effect.Effect<CoreInfo, MaaxError> =>
      Effect.gen(function* () {
        const currentSettings = yield* settings.get;
        const cores = yield* registry.list;
        const ready = cores.filter((core) => core.status === "ready");
        if (ready.length === 0) {
          return yield* Effect.fail(maaxError("还没有可用的 MaaCore，请先在设置中导入或下载核心"));
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
        if (existing && existing.version !== "") {
          existing.refs += 1;
          return existing;
        }

        if (existing) {
          return yield* Effect.fail(maaxError("核心正在启动，请稍候"));
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

        const entry: HostEntry = { key, core, server, client, version: "", refs: 1 };
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

    const ensureSession = (
      device: DeviceProfile,
      host: HostEntry,
    ): Effect.Effect<string, MaaxError> =>
      Effect.gen(function* () {
        const state = runtime.get(device.id);
        if (state?.sessionId && state.hostKey === host.key) return state.sessionId;
        if (state?.sessionId) {
          const old = hosts.get(state.hostKey ?? "");
          if (old) {
            yield* Effect.tryPromise({
              try: () =>
                old.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
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
          timer,
        });
      });

    const cancelConnectWaiter = (deviceId: string): void => {
      const waiter = connectWaiters.get(deviceId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      connectWaiters.delete(deviceId);
    };

    const getConnectedDevice = (deviceId: string) =>
      Effect.gen(function* () {
        const profile = profiles.get(deviceId);
        if (!profile) return yield* Effect.fail(maaxError("设备不存在"));
        const state = runtime.get(deviceId);
        if (!state?.sessionId || !state.hostKey) {
          return yield* Effect.fail(maaxError("设备未连接"));
        }
        const host = hosts.get(state.hostKey);
        if (!host) return yield* Effect.fail(maaxError("MaaCore 会话已失效，请重新连接"));
        return { profile, state, host };
      });

    const connectDevice = (deviceId: string) =>
      Effect.gen(function* () {
        const profile = profiles.get(deviceId);
        if (!profile) return yield* Effect.fail(maaxError("设备不存在"));
        const current = runtime.get(deviceId);
        if (current?.status === "online" || current?.status === "running") {
          const view = viewFor(deviceId);
          if (view) return view;
        }
        setDeviceState(deviceId, { status: "connecting", lastError: undefined });
        emitDevice(deviceId);
        const core = yield* ensureActiveCore();
        const server = serverForClient(profile.clientType);
        const host = yield* ensureHost(core, server);
        const sessionId = yield* ensureSession(profile, host);
        const adbPath = profile.adbPath || settingsCache?.adbPath || "adb";
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
          cancelConnectWaiter(deviceId);
          setDeviceState(deviceId, { status: "error", lastError: "连接请求被 MaaCore 拒绝" });
          emitDevice(deviceId);
          return yield* Effect.fail(maaxError("连接请求被 MaaCore 拒绝"));
        }
        const result = yield* Effect.tryPromise({
          try: () => waiter,
          catch: (cause) => maaxError("连接失败", cause),
        });
        if (!result.ok) {
          const message = result.message || "ADB 连接失败";
          setDeviceState(deviceId, { status: "error", lastError: message });
          emitDevice(deviceId);
          return yield* Effect.fail(maaxError("连接失败", message));
        }
        const nextProfile = yield* workspace.markConnected(deviceId);
        profiles.set(deviceId, nextProfile);
        setDeviceState(deviceId, {
          status: "online",
          engineVersion: host.version,
          lastError: undefined,
        });
        emitDevice(deviceId);
        engine = computeEngine();
        bus.emit({ _tag: "engine-updated", engine });
        const view = viewFor(deviceId);
        if (!view) return yield* Effect.fail(maaxError("设备状态丢失"));
        return view;
      });

    const disconnectDevice = (deviceId: string) =>
      Effect.gen(function* () {
        const state = runtime.get(deviceId);
        const run = runs.get(deviceId);
        if (run && (run.snapshot.status === "running" || run.snapshot.status === "preparing")) {
          yield* stopRunInternal(deviceId);
        }
        if (state?.sessionId && state.hostKey) {
          const host = hosts.get(state.hostKey);
          if (host) {
            yield* Effect.tryPromise({
              try: () =>
                host.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
        }
        runtime.set(deviceId, { status: "offline" });
        emitDevice(deviceId);
        emitEngine();
        const view = viewFor(deviceId);
        if (!view) return yield* Effect.fail(maaxError("设备不存在"));
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
        if (!run) return yield* Effect.fail(maaxError("当前没有运行中的任务"));
        const { host } = yield* getConnectedDevice(deviceId);
        if (run.hostKey !== host.key) {
          return yield* Effect.fail(maaxError("运行中的核心已经切换，请重新连接"));
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

    const startRun = (deviceId: string, planId: string) =>
      Effect.gen(function* () {
        const existing = runs.get(deviceId);
        if (
          existing &&
          (existing.snapshot.status === "running" || existing.snapshot.status === "preparing")
        ) {
          return yield* Effect.fail(maaxError("这个设备已经在运行任务"));
        }
        const plan = yield* workspace.getPlan(planId);
        if (!plan || plan.deviceId !== deviceId)
          return yield* Effect.fail(maaxError("任务计划不存在"));
        const tasks = plan.tasks.filter((task) => task.enabled);
        if (tasks.length === 0)
          return yield* Effect.fail(maaxError("没有启用的任务，请至少启用一个"));
        const { state, host } = yield* getConnectedDevice(deviceId);
        const sessionId = state.sessionId!;
        const runId = randomUUID();
        const startedAt = Date.now();
        const snapshot: RunSnapshot = {
          id: runId,
          deviceId,
          planId,
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
              runs.delete(deviceId);
              return maaxError(`任务「${task.name || task.type}」参数被拒绝`, message);
            },
          });
          const { taskId } = raw as AppendTaskResult;
          run.taskConfigIds.set(taskId, task.id);
          run.snapshot = {
            ...run.snapshot,
            tasks: run.snapshot.tasks.map((item) =>
              item.configId === task.id ? { ...item, taskId } : item,
            ),
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
          runs.delete(deviceId);
          return yield* Effect.fail(maaxError("MaaCore 拒绝启动任务"));
        }
        run.snapshot = { ...run.snapshot, status: "running" };
        setDeviceState(deviceId, { status: "running" });
        emitDevice(deviceId);
        emitRun(run);
        emitEngine();
        return run.snapshot;
      });

    const stopRun = (deviceId: string) =>
      Effect.gen(function* () {
        const run = runs.get(deviceId);
        if (!run) return yield* Effect.fail(maaxError("当前没有运行中的任务"));
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
        const cores = yield* registry.remove(id);
        const current = yield* settings.get;
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

    const downloadCore = Effect.gen(function* () {
      const core = yield* installer.downloadStable;
      if (core) {
        const cores = yield* registry.list;
        bus.emit({ _tag: "cores-updated", cores });
      }
      return core;
    });

    const setActiveCore = (id: string) =>
      Effect.gen(function* () {
        const cores = yield* registry.list;
        if (!cores.some((core) => core.id === id && core.status === "ready")) {
          return yield* Effect.fail(maaxError("核心不可用"));
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
        if (!view) return yield* Effect.fail(maaxError("创建设备失败"));
        return view;
      });

    const updateDevice = (id: string, patch: Partial<DeviceDraft>) =>
      Effect.gen(function* () {
        const profile = yield* workspace.updateDevice(id, patch);
        profiles.set(id, profile);
        emitDevice(id);
        const view = viewFor(id);
        if (!view) return yield* Effect.fail(maaxError("设备不存在"));
        return view;
      });

    const removeDevice = (id: string) =>
      Effect.gen(function* () {
        const state = runtime.get(id);
        if (state?.sessionId && state.hostKey) {
          const host = hosts.get(state.hostKey);
          if (host) {
            yield* Effect.tryPromise({
              try: () =>
                host.client.request({ id: 0, op: "destroy-session", sessionId: state.sessionId! }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
        }
        yield* workspace.removeDevice(id);
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
        return saved;
      });

    const removePlan = (id: string) =>
      Effect.gen(function* () {
        const next = yield* workspace.removePlan(id);
        plans = [...next];
        return next;
      });

    const shutdown = Effect.gen(function* () {
      shuttingDown = true;
      for (const host of hosts.values()) {
        yield* Effect.tryPromise({ try: () => host.client.stop(), catch: () => undefined }).pipe(
          Effect.ignore,
        );
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
      setActiveCore,
      addDevice,
      updateDevice,
      removeDevice,
      connectDevice,
      disconnectDevice,
      screenshotDevice,
      savePlan,
      removePlan,
      startRun,
      stopRun,
      shutdown,
    };
    return api;
  }),
);
