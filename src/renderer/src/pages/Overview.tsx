import { For, Show, type Component } from "solid-js";
import type { Bootstrap, DeviceView, Locale, RunSnapshot, TaskPlan } from "../../../shared/schemas";
import { firstLine, type UiLogEntry } from "../log-format";
import { enginePhaseKey, formatClock, pick, runStatusKey, runTaskStatusKey, t } from "../i18n/i18n";
import { SetupPanel } from "../components/SetupPanel";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";
import { TASK_DEFINITIONS } from "../../../shared/tasks";

interface OverviewProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly device: DeviceView | undefined;
  readonly plan: TaskPlan | undefined;
  readonly run: RunSnapshot | undefined;
  readonly logs: ReadonlyArray<UiLogEntry>;
  readonly onNavigate: (view: "overview" | "tasks" | "devices" | "settings") => void;
  readonly onImportCore: () => void;
  readonly onAddDevice: () => void;
  readonly onConnect: () => void;
  readonly onStart: () => void;
}

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

export const Overview: Component<OverviewProps> = (props) => {
  const enabledTasks = () => props.plan?.tasks.filter((task) => task.enabled) ?? [];
  const activeCore = () =>
    props.data.cores.find((core) => core.id === props.data.settings.activeCoreId) ?? props.data.cores[0];
  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const lastLogs = () => props.logs.slice(-80).reverse();
  const completedCount = () => props.run?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const primaryLabel = () => {
    if (!props.device) return t(props.locale, "devices.add");
    if (!connected()) return t(props.locale, "overview.connectFirst");
    return t(props.locale, "overview.startTasks");
  };
  const primaryIcon = () => (!props.device ? "plus" : connected() ? "play" : "wifi");
  const primaryAction = () => {
    if (!props.device) {
      props.onAddDevice();
      return;
    }
    if (!connected()) {
      props.onConnect();
      return;
    }
    props.onStart();
  };

  return (
    <div class="page page--overview">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "nav.overview")}</h1>
          <p class="page-subtitle">{t(props.locale, "overview.subtitle")}</p>
        </div>
        <div class="page-actions">
          <Button variant="primary" onClick={primaryAction} disabled={!activeCore()}>
            <Icon name={primaryIcon()} />
            {primaryLabel()}
          </Button>
        </div>
      </header>

      <section class="status-strip">
        <div class="status-cell">
          <span class="status-cell-label">{t(props.locale, "overview.currentDevice")}</span>
          <span class="status-cell-value">
            <span>{props.device?.profile.name ?? t(props.locale, "overview.noDevice")}</span>
            <Show when={props.device}>
              {(device) => <StatusPill status={device().status} label={statusText(device().status, props.locale)} />}
            </Show>
          </span>
          <span class="status-cell-meta">
            {props.device?.profile.address ?? t(props.locale, "overview.noDeviceHint")}
          </span>
        </div>

        <div class="status-cell">
          <span class="status-cell-label">{t(props.locale, "overview.core")}</span>
          <span class="status-cell-value">
            <span>{activeCore()?.version ?? t(props.locale, "overview.noCore")}</span>
          </span>
          <span class="status-cell-meta">{t(props.locale, enginePhaseKey(props.data.engine.phase))}</span>
        </div>

        <div class="status-cell">
          <span class="status-cell-label">{t(props.locale, "overview.planSummary")}</span>
          <span class="status-cell-value">
            <span>{props.plan?.name ?? t(props.locale, "overview.noRun")}</span>
          </span>
          <span class="status-cell-meta">
            {enabledTasks().length} {t(props.locale, "overview.enabledTasks")}
          </span>
        </div>

        <div class="status-cell">
          <span class="status-cell-label">{t(props.locale, "overview.lastRun")}</span>
          <span class="status-cell-value">
            <span>
              {props.run ? t(props.locale, runStatusKey(props.run.status)) : t(props.locale, "overview.noRun")}
            </span>
          </span>
          <span class="status-cell-meta">
            {props.run
              ? `${completedCount()}/${props.run.tasks.length} ${t(props.locale, "tasks.tasksCount")} · ${formatClock(props.run.startedAt, props.locale)}`
              : "—"}
          </span>
        </div>
      </section>

      <Show when={!activeCore() || !props.device}>
        <SetupPanel
          locale={props.locale}
          hasCore={Boolean(activeCore())}
          hasDevice={Boolean(props.device)}
          connected={connected()}
          onImportCore={props.onImportCore}
          onAddDevice={props.onAddDevice}
          onConnect={props.onConnect}
        />
      </Show>

      <section class="workspace">
        <article class="panel panel--queue">
          <div class="panel-head">
            <div>
              <h3>{props.plan?.name ?? t(props.locale, "overview.planSummary")}</h3>
              <p class="panel-kicker">
                {enabledTasks().length} {t(props.locale, "overview.enabledTasks")}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => props.onNavigate("tasks")}>
              {t(props.locale, "tasks.addTask")}
              <Icon name="chevron-right" />
            </Button>
          </div>
          <Show
            when={enabledTasks().length > 0}
            fallback={<p class="panel-note">{t(props.locale, "tasks.noEnabled")}</p>}
          >
            <ul class="queue-preview">
              <For each={enabledTasks()}>
                {(task, index) => {
                  const runTask = () => props.run?.tasks.find((item) => item.configId === task.id);
                  return (
                    <li>
                      <span class="queue-index">{String(index() + 1).padStart(2, "0")}</span>
                      <span class="queue-name">
                        {task.name || pick(props.locale, TASK_DEFINITIONS[task.type].name)}
                      </span>
                      <span class="queue-type">{task.type}</span>
                      <Show when={runTask()} fallback={<span class="queue-state" />}>
                        {(entry) => (
                          <span class="queue-state">{t(props.locale, runTaskStatusKey(entry().status))}</span>
                        )}
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </article>

        <article class="panel panel--activity">
          <div class="panel-head">
            <div>
              <h3>{t(props.locale, "overview.activity")}</h3>
              <p class="panel-kicker">{t(props.locale, enginePhaseKey(props.data.engine.phase))}</p>
            </div>
          </div>
          <Show
            when={lastLogs().length > 0}
            fallback={<p class="panel-note">{t(props.locale, "overview.activityEmpty")}</p>}
          >
            <ul class="activity-list">
              <For each={lastLogs()}>
                {(entry) => (
                  <li class={`activity-line activity-line--${entry.level}`}>
                    <span class="activity-time">{entry.time}</span>
                    <span>{firstLine(entry.message)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </article>
      </section>
    </div>
  );
};
