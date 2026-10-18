import { Show, createEffect, createMemo, createSignal, onSettled, type Component } from "solid-js";
import type {
  AppSettingsPatch,
  Bootstrap,
  DeviceDraft,
  DeviceView,
  DownloadProgress,
  Locale,
  RunSnapshot,
  TaskPlan,
  TaskType,
  Theme,
} from "../../../shared/schemas";
import {
  COMMANDS,
  type CommandName,
  type CommandPayloads,
  type CommandResults,
} from "../../../shared/ipc";
import { createTask } from "../../../shared/tasks";
import { AddDeviceDialog } from "../components/AddDeviceDialog";
import { Icon } from "../components/ui/Icon";
import { notify } from "../components/ui/Toaster";
import { StatusPill } from "../components/ui/StatusPill";
import {
  DesktopBridgeError,
  bootstrap as loadBootstrap,
  command,
  subscribeEvents,
} from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { enginePhaseKey, t } from "../i18n/i18n";
import { formatCoreCallback, type UiLogEntry } from "../log-format";
import { Devices } from "../pages/Devices";
import { Overview } from "../pages/Overview";
import { Settings } from "../pages/Settings";
import { Tasks } from "../pages/Tasks";

type View = "overview" | "tasks" | "devices" | "settings";

interface AppShellProps {
  readonly initial: Bootstrap;
}

const NAV: ReadonlyArray<{
  view: View;
  icon: string;
  key: "nav.overview" | "nav.tasks" | "nav.devices" | "nav.settings";
}> = [
  { view: "overview", icon: "dashboard", key: "nav.overview" },
  { view: "tasks", icon: "list-todo", key: "nav.tasks" },
  { view: "devices", icon: "smartphone", key: "nav.devices" },
  { view: "settings", icon: "settings", key: "nav.settings" },
];

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

const nextTheme = (theme: Theme): Theme => {
  if (theme === "dark") return "light";
  if (theme === "light") return "system";
  return "dark";
};

export const AppShell: Component<AppShellProps> = (props) => {
  const runtime = useAppRuntime();
  const [data, setData] = createSignal<Bootstrap>(props.initial);
  const [view, setView] = createSignal<View>(
    props.initial.cores.length === 0 || props.initial.devices.length === 0
      ? "overview"
      : "overview",
  );
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | undefined>(
    props.initial.devices.find(
      (device) => device.status === "online" || device.status === "running",
    )?.profile.id ?? props.initial.devices[0]?.profile.id,
  );
  const [runs, setRuns] = createSignal<Record<string, RunSnapshot>>({});
  const [logs, setLogs] = createSignal<ReadonlyArray<UiLogEntry>>([]);
  const [screenshots, setScreenshots] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [addDeviceOpen, setAddDeviceOpen] = createSignal(false);
  const [systemDark, setSystemDark] = createSignal(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [download, setDownload] = createSignal<DownloadProgress>();

  let logId = 0;
  let contentRef: HTMLElement | undefined;
  let saveTimer: number | undefined;
  let pendingPlan: TaskPlan | undefined;
  let saveChain: Promise<void> = Promise.resolve();

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
  const selectedRun = createMemo(() => {
    const id = effectiveDeviceId();
    return id ? runs()[id] : undefined;
  });
  const activeCore = createMemo(
    () => data().cores.find((core) => core.id === data().settings.activeCoreId) ?? data().cores[0],
  );
  const connected = () =>
    selectedDevice()?.status === "online" || selectedDevice()?.status === "running";
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

  createEffect(
    () => resolvedTheme(),
    (theme) => {
      document.documentElement.dataset.theme = theme;
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

  const appendLog = (entry: Omit<UiLogEntry, "id">): void => {
    setLogs((current) => {
      const next = [...current, { ...entry, id: ++logId }];
      return next.length > 1500 ? next.slice(next.length - 1500) : next;
    });
  };

  const applyEvent = (event: import("../../../shared/schemas").MaaxEvent): void => {
    switch (event._tag) {
      case "device-updated": {
        setData((current) => {
          const exists = current.devices.some(
            (device) => device.profile.id === event.device.profile.id,
          );
          return {
            ...current,
            devices: exists
              ? current.devices.map((device) =>
                  device.profile.id === event.device.profile.id ? event.device : device,
                )
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
      case "settings-updated":
        setData((current) => ({ ...current, settings: event.settings }));
        break;
      case "run-updated": {
        const previous = runs()[event.run.deviceId];
        setRuns((current) => ({ ...current, [event.run.deviceId]: event.run }));
        if (
          previous &&
          previous.status !== event.run.status &&
          (event.run.status === "completed" ||
            event.run.status === "failed" ||
            event.run.status === "stopped")
        ) {
          notify({
            kind:
              event.run.status === "completed"
                ? "success"
                : event.run.status === "failed"
                  ? "error"
                  : "info",
            title:
              event.run.status === "completed"
                ? tr("tasks.completed")
                : event.run.status === "failed"
                  ? tr("tasks.failed")
                  : tr("tasks.stopped"),
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
      case "download-progress":
        setDownload(event);
        break;
      case "core-callback": {
        const formatted = formatCoreCallback(event, locale());
        if (!formatted) break;
        if (formatted.level === "debug" && !data().settings.developerMode) break;
        appendLog({
          level: formatted.level,
          message: formatted.message,
          at: event.at,
          deviceId: event.deviceId,
        });
        break;
      }
    }
  };

  const fail = (error: unknown): void => {
    notify({
      kind: "error",
      title: tr("toast.error"),
      message:
        error instanceof DesktopBridgeError
          ? error.reason
          : error instanceof Error
            ? error.message
            : String(error),
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
      for (const url of Object.values(screenshots())) URL.revokeObjectURL(url);
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
    const device = await send(COMMANDS.connectDevice, { id: deviceId });
    if (!device) return;
    setData((current) => ({
      ...current,
      devices: current.devices.map((item) =>
        item.profile.id === device.profile.id ? device : item,
      ),
    }));
    notify({ kind: "success", title: tr("toast.connected"), message: device.profile.name });
  };

  const disconnectDevice = async (id: string): Promise<void> => {
    const device = await send(COMMANDS.disconnectDevice, { id });
    if (!device) return;
    setData((current) => ({
      ...current,
      devices: current.devices.map((item) =>
        item.profile.id === device.profile.id ? device : item,
      ),
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
      if (previous) URL.revokeObjectURL(previous);
      return { ...current, [id]: url };
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
    }
    window.setTimeout(() => setDownload(undefined), core ? 1800 : 0);
  };

  const refreshCores = async (): Promise<void> => {
    const cores = await send(COMMANDS.refreshCores, undefined, { busy: false });
    if (cores) setData((current) => ({ ...current, cores: [...cores] }));
  };

  const startRun = async (): Promise<void> => {
    const device = selectedDevice();
    const plan = selectedPlan();
    if (!device || !plan) return;
    await flushSave();
    const run = await send(COMMANDS.startRun, { deviceId: device.profile.id, planId: plan.id });
    if (!run) return;
    setRuns((current) => ({ ...current, [run.deviceId]: run }));
    notify({ kind: "success", title: tr("toast.runStarted"), message: device.profile.name });
  };

  const stopRun = async (): Promise<void> => {
    const device = selectedDevice();
    if (!device) return;
    const run = await send(COMMANDS.stopRun, { deviceId: device.profile.id });
    if (!run) return;
    setRuns((current) => ({ ...current, [run.deviceId]: run }));
    notify({ kind: "info", title: tr("toast.runStopped") });
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

  const moveTask = (from: number, to: number): void => {
    updatePlan((plan) => {
      const tasks = [...plan.tasks];
      const [moved] = tasks.splice(from, 1);
      if (!moved) return plan;
      tasks.splice(to, 0, moved);
      return { ...plan, tasks };
    });
  };

  const cycleTheme = async (): Promise<void> => {
    await updateSettings({ theme: nextTheme(data().settings.theme) });
  };

  const clearLogs = (): void => {
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
            <small>{tr("app.tagline")}</small>
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
          <div class="core-status">
            <span class={`core-status-orb core-status-orb--${activeCore()?.status ?? "missing"}`} />
            <div>
              <span class="mono-label">MaaCore</span>
              <strong>{activeCore()?.version ?? tr("overview.noCore")}</strong>
            </div>
            <span class="engine-mini">{tr(enginePhaseKey(data().engine.phase))}</span>
          </div>
          <div class="sidebar-version">
            <span>v{data().runtime.app.version}</span>
            <span>·</span>
            <span>AGPL</span>
          </div>
        </div>
      </aside>

      <div class="shell-main">
        <header class="topbar">
          <div class="topbar-crumb">
            <span class="mono-label">MAAX</span>
            <span class="crumb-slash">/</span>
            <span>{tr(NAV.find((item) => item.view === view())?.key ?? "nav.overview")}</span>
          </div>
          <div class="topbar-actions">
            <button type="button" class="device-pill" onClick={() => setView("devices")}>
              <span class={`connection-dot ${connected() ? "is-online" : ""}`} />
              <span>{selectedDevice()?.profile.name ?? tr("overview.noDevice")}</span>
              <StatusPill
                status={selectedDevice()?.status ?? "offline"}
                label={statusText(selectedDevice()?.status ?? "offline", locale())}
                compact
              />
            </button>
            <button type="button" class="engine-pill" onClick={() => setView("settings")}>
              <Icon name="cpu" />
              <span>{tr(enginePhaseKey(data().engine.phase))}</span>
            </button>
            <button
              type="button"
              class="icon-button theme-button"
              onClick={() => void cycleTheme()}
              title={tr("settings.theme")}
            >
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
              onClearLogs={clearLogs}
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
            />
          </Show>
        </main>
      </div>

      <Show when={download()}>
        {(progress) => (
          <div class="download-bar">
            <span class="download-icon">
              <Icon
                name={
                  progress().phase === "done"
                    ? "check"
                    : progress().phase === "failed"
                      ? "alert-triangle"
                      : "download"
                }
              />
            </span>
            <div class="download-copy">
              <div class="download-head">
                <strong>{tr("download.title")}</strong>
                <span>
                  {progress().phase === "downloading" && progress().total > 0
                    ? `${Math.round((progress().received / progress().total) * 100)}%`
                    : t(locale(), `download.${progress().phase}` as Parameters<typeof t>[1])}
                </span>
              </div>
              <div class="download-track">
                <span
                  style={{
                    width:
                      progress().total > 0
                        ? `${Math.min(100, Math.round((progress().received / progress().total) * 100))}%`
                        : "12%",
                  }}
                />
              </div>
              <span class="download-meta">
                {progress().phase === "downloading"
                  ? `${(progress().received / 1024 / 1024).toFixed(1)} / ${(progress().total / 1024 / 1024).toFixed(1)} MB`
                  : t(locale(), `download.${progress().phase}` as Parameters<typeof t>[1])}
              </span>
            </div>
          </div>
        )}
      </Show>

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
