import { Show, createEffect, createMemo, createSignal, onSettled, untrack, type Component } from "solid-js";
import type {
  AppSettingsPatch,
  Bootstrap,
  CoreReleaseCheck,
  DeviceDraft,
  DeviceView,
  DownloadProgress,
  Locale,
  ResourceStatus,
  StageCatalogEntry,
  RunSnapshot,
  TaskPlan,
  TaskType,
} from "../../../shared/schemas";
import { COMMANDS, type CommandName, type CommandPayloads, type CommandResults } from "../../../shared/ipc";
import { formatResourceStamp } from "../../../shared/resource-version";
import { createTask } from "../../../shared/tasks";
import { AddDeviceDialog } from "../components/AddDeviceDialog";
import { CopilotBrowser } from "../components/CopilotBrowser";
import { Icon } from "../components/ui/Icon";
import { ProgressBar } from "../components/ui/ProgressBar";
import { notify } from "../components/ui/Toaster";
import { StatusPill } from "../components/ui/StatusPill";
import { DesktopBridgeError, bootstrap as loadBootstrap, command, subscribeEvents } from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { enginePhaseKey, t } from "../i18n/i18n";
import { formatCoreCallback, formatLogTime, type UiLogEntry } from "../log-format";
import { Copilot } from "../pages/Copilot";
import { Devices } from "../pages/Devices";
import { Overview } from "../pages/Overview";
import { Settings } from "../pages/Settings";
import { Tasks } from "../pages/Tasks";

type View = "overview" | "tasks" | "copilot" | "devices" | "settings";

interface AppShellProps {
  readonly initial: Bootstrap;
}

const NAV: ReadonlyArray<{
  view: View;
  icon: string;
  key: "nav.overview" | "nav.tasks" | "nav.copilot" | "nav.devices" | "nav.settings";
}> = [
  { view: "overview", icon: "dashboard", key: "nav.overview" },
  { view: "tasks", icon: "list-todo", key: "nav.tasks" },
  // Clearing a stage with a copilot is a one-off action, so it sits beside the
  // daily queue instead of inside it.
  { view: "copilot", icon: "swords", key: "nav.copilot" },
  { view: "devices", icon: "smartphone", key: "nav.devices" },
  { view: "settings", icon: "settings", key: "nav.settings" },
];

/** Rows kept in memory; also the hard cap on the rendered log list. */
const LOG_LIMIT = 750;
/** Core callbacks arrive in bursts, so line appends are coalesced per flush. */
const LOG_FLUSH_MS = 60;

const statusText = (status: DeviceView["status"], locale: Locale): string => {
  switch (status) {
    case "online":
      return t(locale, "status.online");
    case "connecting":
      return t(locale, "status.connecting");
    case "running":
      return t(locale, "status.running");
    case "error":
      return t(locale, "status.error");
    default:
      return t(locale, "status.offline");
  }
};

export const AppShell: Component<AppShellProps> = (props) => {
  const runtime = useAppRuntime();
  // The shell owns its state after mount: `initial` is a one-time seed, so read it
  // once instead of leaving an untracked reactive read in the component body.
  const initial = untrack(() => props.initial);
  const [data, setData] = createSignal<Bootstrap>(initial);
  const [view, setView] = createSignal<View>("overview");
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | undefined>(
    initial.devices.find((device) => device.status === "online" || device.status === "running")?.profile.id ??
      initial.devices[0]?.profile.id,
  );
  const [runs, setRuns] = createSignal<Record<string, RunSnapshot>>({});
  const [logs, setLogs] = createSignal<ReadonlyArray<UiLogEntry>>([]);
  const [screenshots, setScreenshots] = createSignal<
    Record<string, { url: string; width: number; height: number; durationMs: number }>
  >({});
  const [busy, setBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [addDeviceOpen, setAddDeviceOpen] = createSignal(false);
  const [systemDark, setSystemDark] = createSignal(window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [download, setDownload] = createSignal<DownloadProgress>();
  const [resourceProgress, setResourceProgress] = createSignal<DownloadProgress>();
  const [resourceStatuses, setResourceStatuses] = createSignal<Readonly<Record<string, ResourceStatus>>>({});
  const [resourceBusy, setResourceBusy] = createSignal(false);
  const [coreRelease, setCoreRelease] = createSignal<CoreReleaseCheck>();
  const [browserTaskId, setBrowserTaskId] = createSignal<string | null>(null);
  const [copilotBrowseOpen, setCopilotBrowseOpen] = createSignal(false);
  let progressTick = 0;
  const [stages, setStages] = createSignal<ReadonlyArray<StageCatalogEntry>>([]);

  let logId = 0;
  let pendingLogs: UiLogEntry[] = [];
  let logTimer: number | undefined;
  let themePending = false;
  let contentRef: HTMLElement | undefined;
  let saveTimer: number | undefined;
  let pendingPlan: TaskPlan | undefined;
  let saveChain: Promise<void> = Promise.resolve();
  // Solid batches the disabled state until the next microtask, so a second
  // click in the same tick would still reach these handlers. These flags make
  // the in-flight command own the action: repeated clicks are ignored instead
  // of racing a second connect/start/stop and surfacing an "already running"
  // error. Starting also flushes the pending plan before the global busy flag
  // is set, which is another window for a duplicate start.
  let connectPending = false;
  let runActionPending = false;

  const locale = () => data().settings.locale;
  const tr = (key: Parameters<typeof t>[1]) => t(locale(), key);
  const effectiveDeviceId = () => selectedDeviceId() ?? data().devices[0]?.profile.id;
  const selectedDevice = createMemo(() => {
    const id = effectiveDeviceId();
    return id ? data().devices.find((device) => device.profile.id === id) : undefined;
  });
  const selectedPlan = createMemo(() => {
    const device = selectedDevice();
    if (!device) return undefined;
    return (
      data().plans.find((plan) => plan.id === device.profile.activePlanId) ??
      data().plans.find((plan) => plan.deviceId === device.profile.id)
    );
  });
  const devicePlans = createMemo(() => {
    const id = effectiveDeviceId();
    return id ? data().plans.filter((plan) => plan.deviceId === id) : [];
  });
  const selectedRun = createMemo(() => {
    const id = effectiveDeviceId();
    return id ? runs()[id] : undefined;
  });
  const activeCore = createMemo(
    () => data().cores.find((core) => core.id === data().settings.activeCoreId) ?? data().cores[0],
  );
  const deviceLogs = createMemo(() => {
    const id = effectiveDeviceId();
    if (!id) return logs();
    return logs().filter((entry) => !entry.deviceId || entry.deviceId === id);
  });

  const resolvedTheme = createMemo<"dark" | "light">(() => {
    const theme = data().settings.theme;
    if (theme !== "system") return theme;
    return systemDark() ? "dark" : "light";
  });

  // A theme swap cross-fades instead of snapping, so light/dark does not flash.
  // The first application is the boot palette and lands instantly.
  let themeApplied = false;
  createEffect(
    () => resolvedTheme(),
    (theme) => {
      const root = document.documentElement;
      const booting = !themeApplied;
      themeApplied = true;
      if (root.dataset.theme === theme) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (booting || reduced || typeof document.startViewTransition !== "function") {
        root.dataset.theme = theme;
        return;
      }
      document.startViewTransition(() => {
        root.dataset.theme = theme;
      });
    },
  );
  createEffect(
    () => locale(),
    (nextLocale) => {
      document.documentElement.lang = nextLocale;
    },
  );
  createEffect(
    () => view(),
    () => {
      contentRef?.scrollTo({ top: 0, behavior: "instant" });
    },
  );

  const flushLogs = (): void => {
    logTimer = undefined;
    if (pendingLogs.length === 0) return;
    const batch = pendingLogs;
    pendingLogs = [];
    setLogs((current) => {
      const next = current.concat(batch);
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  };

  const appendLog = (entry: Omit<UiLogEntry, "id" | "time">): void => {
    pendingLogs.push({ ...entry, id: ++logId, time: formatLogTime(entry.at) });
    logTimer ??= window.setTimeout(flushLogs, LOG_FLUSH_MS);
  };

  const applyEvent = (event: import("../../../shared/schemas").MaaxEvent): void => {
    switch (event._tag) {
      case "device-updated": {
        setData((current) => {
          const exists = current.devices.some((device) => device.profile.id === event.device.profile.id);
          return {
            ...current,
            devices: exists
              ? current.devices.map((device) => (device.profile.id === event.device.profile.id ? event.device : device))
              : [...current.devices, event.device],
          };
        });
        if (!selectedDeviceId()) setSelectedDeviceId(event.device.profile.id);
        break;
      }
      case "engine-updated":
        setData((current) => ({ ...current, engine: event.engine }));
        break;
      case "cores-updated":
        setData((current) => ({ ...current, cores: [...event.cores] }));
        break;
      case "plans-updated":
        setData((current) => ({ ...current, plans: [...event.plans] }));
        break;
      case "copilot-updated":
        setData((current) => ({ ...current, copilot: event.copilot }));
        break;
      case "settings-updated":
        setData((current) => ({ ...current, settings: event.settings }));
        break;
      case "run-updated": {
        const previous = runs()[event.run.deviceId];
        setRuns((current) => ({ ...current, [event.run.deviceId]: event.run }));
        // A launch failure arrives together with the start command's error
        // toast; that failed event only clears the preparing state.
        const launchFailure =
          event.run.status === "failed" && event.run.tasks.every((task) => task.startedAt === undefined);
        if (
          previous &&
          previous.status !== event.run.status &&
          !launchFailure &&
          (event.run.status === "completed" || event.run.status === "failed" || event.run.status === "stopped")
        ) {
          notify({
            kind: event.run.status === "completed" ? "success" : event.run.status === "failed" ? "error" : "info",
            title:
              event.run.status === "completed"
                ? tr("tasks.completed")
                : event.run.status === "failed"
                  ? tr("tasks.failed")
                  : tr("toast.runStopped"),
            message: selectedDevice()?.profile.name,
          });
        }
        break;
      }
      case "log":
        appendLog({ level: event.level, message: event.message, at: event.at });
        break;
      case "toast":
        notify({ kind: event.kind, title: event.title, message: event.message });
        break;
      case "download-progress": {
        // Terminal phases clear themselves; the caller cannot know which event
        // arrives last, so the bar owns its own lifetime.
        const tick = ++progressTick;
        const clear = (reset: () => void): void => {
          window.setTimeout(
            () => {
              if (progressTick === tick) reset();
            },
            event.phase === "done" ? 1600 : 4000,
          );
        };
        if (event.source === "resource") {
          setResourceProgress(event);
          if (event.phase === "done" || event.phase === "failed") clear(() => setResourceProgress(undefined));
        } else {
          setDownload(event);
          if (event.phase === "done" || event.phase === "failed") clear(() => setDownload(undefined));
        }
        break;
      }
      case "core-callback": {
        const formatted = formatCoreCallback(event, locale());
        if (!formatted) break;
        if (formatted.level === "debug" && !data().settings.developerMode) break;
        appendLog({ ...formatted, at: event.at, deviceId: event.deviceId });
        break;
      }
    }
  };

  const fail = (error: unknown): void => {
    notify({
      kind: "error",
      title: tr("toast.error"),
      message:
        error instanceof DesktopBridgeError ? error.reason : error instanceof Error ? error.message : String(error),
    });
  };

  async function send<C extends CommandName>(
    name: C,
    payload: CommandPayloads[C],
    options: { busy?: boolean } = {},
  ): Promise<CommandResults[C] | undefined> {
    if (options.busy !== false) setBusy(true);
    try {
      return await runtime.runPromise(command(name, payload));
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      if (options.busy !== false) setBusy(false);
    }
  }

  const reload = async (): Promise<void> => {
    try {
      const next = await runtime.runPromise(loadBootstrap);
      setData(next);
      if (!next.devices.some((device) => device.profile.id === selectedDeviceId())) {
        setSelectedDeviceId(next.devices[0]?.profile.id);
      }
    } catch (error) {
      fail(error);
    }
  };

  onSettled(() => {
    void runtime
      .runPromise(command(COMMANDS.stageCatalog, undefined))
      .then((catalog) => setStages(catalog.entries))
      .catch((error: unknown) => console.warn("Stage catalog unavailable", error));
    const unsubscribe = subscribeEvents(applyEvent);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", onMedia);
    return () => {
      unsubscribe();
      media.removeEventListener("change", onMedia);
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      if (logTimer !== undefined) window.clearTimeout(logTimer);
      for (const shot of Object.values(screenshots())) URL.revokeObjectURL(shot.url);
    };
  });

  const persistPlan = (plan: TaskPlan): Promise<void> => {
    saveChain = saveChain.then(async () => {
      try {
        await runtime.runPromise(command(COMMANDS.savePlan, { plan }));
      } catch (error) {
        fail(error);
      }
    });
    return saveChain;
  };

  const scheduleSave = (plan: TaskPlan): void => {
    pendingPlan = plan;
    setSaving(true);
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      const latest = pendingPlan;
      pendingPlan = undefined;
      if (!latest) {
        setSaving(false);
        return;
      }
      void persistPlan(latest).finally(() => {
        if (pendingPlan) {
          scheduleSave(pendingPlan);
        } else {
          setSaving(false);
        }
      });
    }, 450);
  };

  const flushSave = async (): Promise<void> => {
    if (saveTimer !== undefined) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const latest = pendingPlan;
    pendingPlan = undefined;
    if (latest) {
      await persistPlan(latest);
    } else {
      await saveChain;
    }
    setSaving(false);
  };

  const updatePlan = (updater: (plan: TaskPlan) => TaskPlan): void => {
    const plan = selectedPlan();
    if (!plan) return;
    const next = updater(plan);
    setData((current) => ({
      ...current,
      plans: current.plans.map((item) => (item.id === next.id ? next : item)),
    }));
    scheduleSave(next);
  };

  const updateSettings = async (patch: AppSettingsPatch): Promise<void> => {
    const next = await send(COMMANDS.updateSettings, patch, { busy: false });
    if (next) {
      setData((current) => ({ ...current, settings: next }));
    }
  };

  const importCore = async (): Promise<void> => {
    const core = await send(COMMANDS.pickAndAddCore, undefined);
    if (!core) return;
    notify({ kind: "success", title: tr("toast.coreAdded"), message: core.version });
    await reload();
  };

  const addDevice = async (draft: DeviceDraft): Promise<void> => {
    const device = await send(COMMANDS.addDevice, draft);
    if (!device) return;
    setAddDeviceOpen(false);
    notify({ kind: "success", title: tr("toast.deviceAdded"), message: device.profile.name });
    await reload();
    setSelectedDeviceId(device.profile.id);
    setView("tasks");
  };

  const removeDevice = async (id: string): Promise<void> => {
    const device = data().devices.find((item) => item.profile.id === id);
    if (!device) return;
    if (!window.confirm(tr("devices.removeConfirm"))) return;
    const devices = await send(COMMANDS.removeDevice, { id });
    if (!devices) return;
    setData((current) => ({
      ...current,
      devices: [...devices],
      plans: current.plans.filter((plan) => plan.deviceId !== id),
    }));
    if (selectedDeviceId() === id) setSelectedDeviceId(devices[0]?.profile.id);
    notify({ kind: "info", title: tr("toast.deviceRemoved"), message: device.profile.name });
  };

  const connectDevice = async (id?: string): Promise<void> => {
    const deviceId = id ?? effectiveDeviceId();
    if (!deviceId) {
      setAddDeviceOpen(true);
      return;
    }
    // A retry or a second click must not restart an attempt that is already in
    // flight; it owns the waiter and the connecting badge.
    if (connectPending) return;
    if (data().devices.find((item) => item.profile.id === deviceId)?.status === "connecting") return;
    connectPending = true;
    try {
      const device = await send(COMMANDS.connectDevice, { id: deviceId });
      if (!device) return;
      setData((current) => ({
        ...current,
        devices: current.devices.map((item) => (item.profile.id === device.profile.id ? device : item)),
      }));
      notify({ kind: "success", title: tr("toast.connected"), message: device.profile.name });
    } finally {
      connectPending = false;
    }
  };

  const disconnectDevice = async (id: string): Promise<void> => {
    const device = await send(COMMANDS.disconnectDevice, { id });
    if (!device) return;
    setData((current) => ({
      ...current,
      devices: current.devices.map((item) => (item.profile.id === device.profile.id ? device : item)),
    }));
    notify({ kind: "info", title: tr("toast.disconnected"), message: device.profile.name });
  };

  const screenshotDevice = async (id: string): Promise<void> => {
    const shot = await send(COMMANDS.screenshotDevice, { id }, { busy: false });
    if (!shot) return;
    const blob = new Blob([new Uint8Array(shot.png)], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    setScreenshots((current) => {
      const previous = current[id];
      if (previous) URL.revokeObjectURL(previous.url);
      return {
        ...current,
        [id]: { url, width: shot.width, height: shot.height, durationMs: shot.durationMs },
      };
    });
  };

  const setActiveCore = async (id: string): Promise<void> => {
    const result = await send(COMMANDS.setActiveCore, { coreId: id });
    if (!result) return;
    setData((current) => ({ ...current, settings: result.settings, cores: [...result.cores] }));
    notify({ kind: "success", title: tr("settings.setActive") });
  };

  const removeCore = async (id: string): Promise<void> => {
    if (!window.confirm(tr("settings.removeCoreConfirm"))) return;
    const cores = await send(COMMANDS.removeCore, { coreId: id });
    if (!cores) return;
    setData((current) => ({ ...current, cores: [...cores] }));
    notify({ kind: "info", title: tr("toast.coreRemoved") });
    await reload();
  };

  const downloadCore = async (): Promise<void> => {
    setDownload({ _tag: "download-progress", phase: "metadata", received: 0, total: 0 });
    const core = await send(COMMANDS.downloadCore, undefined);
    if (core) {
      notify({ kind: "success", title: tr("toast.coreAdded"), message: core.version });
      await reload();
      await loadCoreRelease();
    }
  };

  const refreshCores = async (): Promise<void> => {
    const cores = await send(COMMANDS.refreshCores, undefined, { busy: false });
    if (cores) setData((current) => ({ ...current, cores: [...cores] }));
  };

  const loadResourceStatus = async (coreId: string): Promise<void> => {
    try {
      const status = await runtime.runPromise(command(COMMANDS.resourceStatus, { coreId }));
      setResourceStatuses((current) => ({ ...current, [coreId]: status }));
    } catch (error) {
      console.warn("Resource status unavailable", error);
    }
  };

  const loadCoreRelease = async (): Promise<void> => {
    try {
      setCoreRelease(await runtime.runPromise(command(COMMANDS.checkCoreUpdate, undefined)));
    } catch (error) {
      console.warn("Core release check failed", error);
    }
  };

  // Resource rows and the release banner live on the settings page; refresh them
  // when it opens or the core list changes, and never poll in the background.
  createEffect(
    () =>
      view() === "settings"
        ? data()
            .cores.map((core) => core.id)
            .join("|")
        : "",
    (coreIds) => {
      if (coreIds === "") return;
      void loadCoreRelease();
      for (const coreId of coreIds.split("|")) void loadResourceStatus(coreId);
    },
  );

  const checkResource = async (coreId: string): Promise<void> => {
    const result = await send(COMMANDS.checkResourceUpdate, { coreId }, { busy: false });
    if (!result) return;
    notify({
      kind: result.available ? "info" : "success",
      title: tr(result.available ? "resource.available" : "resource.upToDate"),
      message: result.remote ? formatResourceStamp(result.remote, locale()) : undefined,
    });
  };

  const updateResource = async (coreId: string): Promise<void> => {
    setResourceBusy(true);
    setResourceProgress({ _tag: "download-progress", phase: "metadata", received: 0, total: 0, source: "resource" });
    const result = await send(COMMANDS.updateResource, { coreId }, { busy: false });
    setResourceBusy(false);
    if (result) {
      notify({
        kind: "success",
        title: tr("resource.updated"),
        message: formatResourceStamp(result.stamp, locale()),
      });
      await reload();
      await loadResourceStatus(coreId);
    }
  };

  const rollbackResource = async (coreId: string, backupId: string): Promise<void> => {
    if (!window.confirm(tr("resource.rollback"))) return;
    setResourceBusy(true);
    const result = await send(COMMANDS.rollbackResource, { coreId, backupId }, { busy: false });
    setResourceBusy(false);
    if (result) {
      notify({
        kind: "info",
        title: tr("resource.rolledBack"),
        message: formatResourceStamp(result.stamp, locale()),
      });
      await reload();
      await loadResourceStatus(coreId);
    }
  };

  const startRun = async (): Promise<void> => {
    if (runActionPending) return;
    const device = selectedDevice();
    const plan = selectedPlan();
    if (!device) {
      setAddDeviceOpen(true);
      return;
    }
    const activeRun = selectedRun();
    if (device.status === "running" || activeRun?.status === "preparing" || activeRun?.status === "running") {
      return;
    }
    // A silent return here is what made the overview button look dead. Send the
    // user to the page where the missing piece lives and say what is missing.
    if (!plan) {
      setView("tasks");
      notify({ kind: "info", title: tr("tasks.noPlan"), message: tr("overview.noPlanHint") });
      return;
    }
    if (!plan.tasks.some((task) => task.enabled)) {
      setView("tasks");
      notify({ kind: "info", title: tr("tasks.noEnabled"), message: tr("overview.noEnabledHint") });
      return;
    }
    runActionPending = true;
    // Disable the CTA before the plan flush, not after it; otherwise the button
    // still looks idle during a pending save and invites another click.
    setBusy(true);
    try {
      await flushSave();
      const run = await send(COMMANDS.startRun, { deviceId: device.profile.id, planId: plan.id }, { busy: false });
      if (!run) return;
      setRuns((current) => ({ ...current, [run.deviceId]: run }));
      notify({ kind: "success", title: tr("toast.runStarted"), message: device.profile.name });
    } finally {
      setBusy(false);
      runActionPending = false;
    }
  };

  const stopRun = async (): Promise<void> => {
    if (runActionPending) return;
    const device = selectedDevice();
    if (!device) return;
    runActionPending = true;
    try {
      const run = await send(COMMANDS.stopRun, { deviceId: device.profile.id });
      if (!run) return;
      setRuns((current) => ({ ...current, [run.deviceId]: run }));
      // The terminal run-updated event owns the stop notification; notifying
      // here too produced two toasts for one click.
    } finally {
      runActionPending = false;
    }
  };

  const updateTaskParam = (taskId: string, key: string, value: unknown): void => {
    updatePlan((plan) => ({
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === taskId ? { ...task, params: { ...task.params, [key]: value } } : task,
      ),
    }));
  };

  const toggleTask = (taskId: string, enabled: boolean): void => {
    updatePlan((plan) => ({
      ...plan,
      tasks: plan.tasks.map((task) => (task.id === taskId ? { ...task, enabled } : task)),
    }));
  };

  const addTask = (type: TaskType): void => {
    const task = createTask(type);
    updatePlan((plan) => ({ ...plan, tasks: [...plan.tasks, task] }));
  };

  const removeTask = (taskId: string): void => {
    updatePlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => task.id !== taskId) }));
  };

  const createPlan = async (): Promise<void> => {
    const device = selectedDevice();
    if (!device) return;
    await flushSave();
    const plan = await send(COMMANDS.createPlan, { deviceId: device.profile.id, name: tr("plans.defaultName") });
    if (!plan) return;
    await reload();
    notify({ kind: "success", title: tr("plans.created"), message: plan.name });
  };

  const selectPlan = async (planId: string): Promise<void> => {
    const device = selectedDevice();
    if (!device || device.profile.activePlanId === planId) return;
    await flushSave();
    const view = await send(COMMANDS.setActivePlan, { deviceId: device.profile.id, planId });
    if (!view) return;
    setData((current) => ({
      ...current,
      devices: current.devices.map((item) => (item.profile.id === view.profile.id ? view : item)),
    }));
  };

  const duplicatePlan = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan) return;
    await flushSave();
    const copy = await send(COMMANDS.duplicatePlan, { planId: plan.id });
    if (!copy) return;
    await reload();
    notify({ kind: "success", title: tr("plans.duplicated"), message: copy.name });
  };

  const renamePlan = async (name: string): Promise<void> => {
    const plan = selectedPlan();
    if (!plan || name.trim() === "" || name.trim() === plan.name) return;
    const saved = await send(COMMANDS.renamePlan, { planId: plan.id, name });
    if (!saved) return;
    setData((current) => ({
      ...current,
      plans: current.plans.map((item) => (item.id === saved.id ? saved : item)),
    }));
  };

  const importPlan = async (): Promise<void> => {
    const device = selectedDevice();
    if (!device) return;
    const plan = await send(COMMANDS.importPlan, { deviceId: device.profile.id });
    if (!plan) return;
    await reload();
    notify({ kind: "success", title: tr("plans.imported"), message: plan.name });
  };

  const exportPlan = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan) return;
    const path = await send(COMMANDS.exportPlan, { planId: plan.id });
    if (!path) return;
    notify({ kind: "success", title: tr("plans.exported"), message: path });
  };

  const deletePlan = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan) return;
    if (!window.confirm(tr("plans.deleteConfirm"))) return;
    const next = await send(COMMANDS.removePlan, { id: plan.id });
    if (!next) return;
    await reload();
    notify({ kind: "info", title: tr("plans.deleted"), message: plan.name });
  };

  const resolveCopilotFor = async (taskId: string, input: string): Promise<boolean> => {
    const result = await send(COMMANDS.resolveCopilot, { input }, { busy: false });
    if (!result) return false;
    const plan = selectedPlan();
    const task = plan?.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    const existing = Array.isArray(task.params.copilot_list) ? task.params.copilot_list : [];
    updateTaskParam(taskId, "copilot_list", [...existing, ...result.items]);
    notify({
      kind: "success",
      title: tr(result.kind === "set" ? "copilot.setAdded" : "copilot.added"),
      message: result.title,
    });
    return true;
  };

  const updateCopilotOptions = async (
    patch: Partial<import("../../../shared/schemas").CopilotOptions>,
  ): Promise<void> => {
    const setup = await send(COMMANDS.updateCopilotOptions, patch, { busy: false });
    if (!setup) return;
    setData((current) => ({ ...current, copilot: setup }));
  };

  const setCopilotItems = async (
    items: ReadonlyArray<import("../../../shared/schemas").CopilotItem>,
  ): Promise<void> => {
    const setup = await send(COMMANDS.setCopilotItems, { items }, { busy: false });
    if (!setup) return;
    setData((current) => ({ ...current, copilot: setup }));
  };

  const resolveCopilotGlobal = async (input: string): Promise<boolean> => {
    const result = await send(COMMANDS.resolveCopilot, { input }, { busy: false });
    if (!result) return false;
    await setCopilotItems([...data().copilot.items, ...result.items]);
    notify({
      kind: "success",
      title: tr(result.kind === "set" ? "copilot.setAdded" : "copilot.added"),
      message: result.title,
    });
    return true;
  };

  const addBrowsedCopilotGlobal = async (id: number): Promise<boolean> => resolveCopilotGlobal(String(id));

  const startCopilot = async (): Promise<void> => {
    if (runActionPending) return;
    const device = selectedDevice();
    if (!device) return;
    runActionPending = true;
    try {
      const run = await send(COMMANDS.startCopilot, { deviceId: device.profile.id });
      if (!run) return;
      setRuns((current) => ({ ...current, [run.deviceId]: run }));
      notify({ kind: "success", title: tr("copilotPage.started"), message: device.profile.name });
    } finally {
      runActionPending = false;
    }
  };

  const addBrowsedCopilot = async (id: number): Promise<boolean> => {
    const taskId = browserTaskId();
    if (taskId === null) return false;
    return await resolveCopilotFor(taskId, String(id));
  };

  const pickCopilotFile = async (taskId: string, key: string): Promise<void> => {
    const file = await send(COMMANDS.importCopilot, undefined, { busy: false });
    if (!file) return;
    const plan = selectedPlan();
    const task = plan?.tasks.find((item) => item.id === taskId);
    const batch = Array.isArray(task?.params.copilot_list) ? task.params.copilot_list : [];
    if (batch.length === 0) {
      updateTaskParam(taskId, key, file.filename);
      return;
    }
    // A batch is already running the show; a local file joins it instead of
    // silently replacing the legacy single-file parameter.
    updateTaskParam(taskId, "copilot_list", [
      ...batch,
      { id: crypto.randomUUID(), copilotId: 0, filename: file.filename, stage: "", title: file.name, isRaid: false },
    ]);
  };

  const moveTask = (from: number, to: number): void => {
    updatePlan((plan) => {
      const tasks = [...plan.tasks];
      const [moved] = tasks.splice(from, 1);
      if (!moved) return plan;
      tasks.splice(to, 0, moved);
      return { ...plan, tasks };
    });
  };

  // The topbar control is a two-state switch (the Settings page owns "system");
  // a third cycle step made light look "stuck" until a second click.
  const toggleTheme = async (): Promise<void> => {
    if (themePending) return;
    themePending = true;
    try {
      await updateSettings({ theme: resolvedTheme() === "dark" ? "light" : "dark" });
    } finally {
      themePending = false;
    }
  };

  const clearLogs = (): void => {
    pendingLogs = [];
    if (logTimer !== undefined) {
      window.clearTimeout(logTimer);
      logTimer = undefined;
    }
    setLogs([]);
  };

  return (
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark">
            <span>M</span>
          </span>
          <span class="brand-lockup">
            <strong>{tr("app.name")}</strong>
          </span>
        </div>

        <nav class="sidebar-nav" aria-label="Main navigation">
          {NAV.map((item) => (
            <button
              type="button"
              class={view() === item.view ? "nav-item nav-item--active" : "nav-item"}
              onClick={() => {
                setView(item.view);
              }}
            >
              <Icon name={item.icon} />
              <span>{tr(item.key)}</span>
            </button>
          ))}
        </nav>

        <div class="sidebar-foot">
          <button type="button" class="core-status" onClick={() => setView("settings")}>
            <div>
              <span class="mono-label">MaaCore</span>
              <strong>{activeCore()?.version ?? tr("overview.noCore")}</strong>
            </div>
            <span class="engine-mini">{tr(enginePhaseKey(data().engine.phase))}</span>
          </button>
        </div>
      </aside>

      <div class="shell-main">
        <header class="topbar">
          <div class="topbar-crumb">
            <span>{tr(NAV.find((item) => item.view === view())?.key ?? "nav.overview")}</span>
          </div>
          <div class="topbar-actions">
            <button type="button" class="device-pill" onClick={() => setView("devices")}>
              <span>{selectedDevice()?.profile.name ?? tr("overview.noDevice")}</span>
              <StatusPill
                status={selectedDevice()?.status ?? "offline"}
                label={statusText(selectedDevice()?.status ?? "offline", locale())}
                compact
              />
            </button>
            <button type="button" class="icon-button" onClick={() => void toggleTheme()} title={tr("settings.theme")}>
              <Icon name={resolvedTheme() === "dark" ? "sun" : "moon"} />
            </button>
          </div>
        </header>

        <main
          class="content"
          ref={(element) => {
            contentRef = element;
          }}
        >
          <Show when={view() === "overview"}>
            <Overview
              data={data()}
              locale={locale()}
              device={selectedDevice()}
              plan={selectedPlan()}
              run={selectedRun()}
              logs={deviceLogs()}
              onNavigate={(next) => setView(next)}
              onImportCore={() => void importCore()}
              onAddDevice={() => setAddDeviceOpen(true)}
              onConnect={() => void connectDevice()}
              onStart={() => void startRun()}
              onStop={() => void stopRun()}
              busy={busy()}
            />
          </Show>
          <Show when={view() === "tasks"}>
            <Tasks
              data={data()}
              locale={locale()}
              device={selectedDevice()}
              plan={selectedPlan()}
              run={selectedRun()}
              logs={deviceLogs()}
              stages={stages()}
              busy={busy()}
              saving={saving()}
              onConnect={() => void connectDevice()}
              onStart={() => void startRun()}
              onStop={() => void stopRun()}
              onAddTask={addTask}
              onRemoveTask={removeTask}
              onEnabledChange={toggleTask}
              onParamChange={updateTaskParam}
              onMoveTask={moveTask}
              plans={devicePlans()}
              onSelectPlan={(id) => void selectPlan(id)}
              onCreatePlan={() => void createPlan()}
              onDuplicatePlan={() => void duplicatePlan()}
              onRenamePlan={(name) => void renamePlan(name)}
              onImportPlan={() => void importPlan()}
              onExportPlan={() => void exportPlan()}
              onDeletePlan={() => void deletePlan()}
              onPickFile={(taskId, key) => void pickCopilotFile(taskId, key)}
              onResolveCopilot={(taskId, input) => resolveCopilotFor(taskId, input)}
              onBrowseCopilot={(taskId) => setBrowserTaskId(taskId)}
              onClearLogs={clearLogs}
            />
          </Show>
          <Show when={view() === "copilot"}>
            <Copilot
              device={selectedDevice()}
              run={selectedRun()}
              items={data().copilot.items}
              options={data().copilot.options}
              locale={locale()}
              busy={busy()}
              onConnect={() => void connectDevice()}
              onStart={() => void startCopilot()}
              onStop={() => void stopRun()}
              onOptions={(patch) => void updateCopilotOptions(patch)}
              onItems={(items) => void setCopilotItems(items)}
              onResolve={resolveCopilotGlobal}
              onBrowse={() => setCopilotBrowseOpen(true)}
            />
          </Show>
          <Show when={view() === "devices"}>
            <Devices
              data={data()}
              locale={locale()}
              screenshots={screenshots()}
              busy={busy()}
              onAdd={() => setAddDeviceOpen(true)}
              onConnect={(id) => void connectDevice(id)}
              onDisconnect={(id) => void disconnectDevice(id)}
              onScreenshot={(id) => void screenshotDevice(id)}
              onRemove={(id) => void removeDevice(id)}
            />
          </Show>
          <Show when={view() === "settings"}>
            <Settings
              data={data()}
              locale={locale()}
              busy={busy()}
              onUpdateSettings={(patch) => void updateSettings(patch)}
              download={download()}
              onImportCore={() => void importCore()}
              onDownloadCore={() => void downloadCore()}
              onSetActiveCore={(id) => void setActiveCore(id)}
              onRemoveCore={(id) => void removeCore(id)}
              onRefreshCores={() => void refreshCores()}
              coreRelease={coreRelease()}
              onCheckCoreUpdate={() => void loadCoreRelease()}
              resourceStatuses={resourceStatuses()}
              resourceBusy={resourceBusy()}
              onCheckResource={(id) => void checkResource(id)}
              onUpdateResource={(id) => void updateResource(id)}
              onRollbackResource={(id, backupId) => void rollbackResource(id, backupId)}
            />
          </Show>
        </main>
      </div>

      <Show when={download()}>
        {(progress) => <ProgressBar title={tr("download.title")} progress={progress()} locale={locale()} />}
      </Show>

      <Show when={resourceProgress()}>
        {(progress) => <ProgressBar title={tr("resource.title")} progress={progress()} locale={locale()} />}
      </Show>

      <CopilotBrowser
        open={browserTaskId() !== null}
        locale={locale()}
        onClose={() => setBrowserTaskId(null)}
        onAdd={addBrowsedCopilot}
      />

      <CopilotBrowser
        open={copilotBrowseOpen()}
        locale={locale()}
        onClose={() => setCopilotBrowseOpen(false)}
        onAdd={addBrowsedCopilotGlobal}
      />

      <AddDeviceDialog
        open={addDeviceOpen()}
        locale={locale()}
        settings={data().settings}
        onClose={() => setAddDeviceOpen(false)}
        onSubmit={(draft) => void addDevice(draft)}
      />
    </div>
  );
};
