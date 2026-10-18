import { For, Show, type Component } from "solid-js";
import type { Bootstrap, DeviceView, Locale, RunSnapshot, TaskPlan } from "../../../shared/schemas";
import type { UiLogEntry } from "../log-format";
import { enginePhaseKey, formatClock, pick, runStatusKey, t } from "../i18n/i18n";
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

const EngineCard: Component<{ data: Bootstrap; locale: Locale; onOpenSettings: () => void }> = (
  props,
) => {
  const core = () =>
    props.data.cores.find((item) => item.id === props.data.settings.activeCoreId) ??
    props.data.cores[0];
  return (
    <article class="panel panel--core">
      <div class="panel-head">
        <span class="panel-icon">
          <Icon name="cpu" />
        </span>
        <div>
          <p class="panel-kicker">{t(props.locale, "overview.core")}</p>
          <h3>{core()?.version ?? t(props.locale, "overview.noCore")}</h3>
        </div>
        <StatusPill
          status={
            props.data.engine.phase === "ready" || props.data.engine.phase === "running"
              ? "ready"
              : props.data.engine.phase
          }
          label={t(props.locale, enginePhaseKey(props.data.engine.phase))}
        />
      </div>
      <Show when={core()} fallback={<p class="muted">{t(props.locale, "overview.noCoreHint")}</p>}>
        {(item) => (
          <>
            <p class="mono-line">{item().root}</p>
            <div class="panel-meta">
              <span>{item().channel}</span>
              <span>{item().status}</span>
              <span>{item().managed ? "managed" : "external"}</span>
            </div>
          </>
        )}
      </Show>
      <Button size="sm" variant="ghost" onClick={props.onOpenSettings}>
        {t(props.locale, "nav.settings")}
        <Icon name="chevron-right" />
      </Button>
    </article>
  );
};

export const Overview: Component<OverviewProps> = (props) => {
  const enabledTasks = () => props.plan?.tasks.filter((task) => task.enabled) ?? [];
  const activeCore = () =>
    props.data.cores.find((core) => core.id === props.data.settings.activeCoreId) ??
    props.data.cores[0];
  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const lastLogs = () => props.logs.slice(-7).reverse();
  const primaryLabel = () => {
    if (!props.device) return t(props.locale, "overview.noDevice");
    if (!connected()) return t(props.locale, "overview.connectFirst");
    return t(props.locale, "overview.startTasks");
  };
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
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">
            <span class="eyebrow-line" />
            {t(props.locale, "overview.kicker")} ·{" "}
            {new Intl.DateTimeFormat(props.locale, { month: "short", day: "2-digit" }).format(
              Date.now(),
            )}
          </p>
          <h1 class="hero-title">{t(props.locale, "overview.title")}</h1>
          <p class="hero-lede">{t(props.locale, "overview.subtitle")}</p>
          <div class="hero-actions">
            <Button variant="primary" size="lg" onClick={primaryAction} disabled={!activeCore()}>
              <Icon name={connected() ? "play" : props.device ? "wifi" : "plus"} />
              {primaryLabel()}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => props.onNavigate("tasks")}>
              <Icon name="list-todo" />
              {t(props.locale, "nav.tasks")}
            </Button>
          </div>
          <div class="hero-tags">
            <span class="version-tag">
              <b>Core</b>
              <span>{activeCore()?.version ?? "—"}</span>
            </span>
            <span class="version-tag">
              <b>{t(props.locale, "overview.enabledTasks")}</b>
              <span>{enabledTasks().length}</span>
            </span>
            <span class="version-tag">
              <b>{t(props.locale, "engine.ready")}</b>
              <span>{t(props.locale, enginePhaseKey(props.data.engine.phase))}</span>
            </span>
          </div>
        </div>

        <aside class="device-console">
          <div class="console-top">
            <span class="mono-label">{t(props.locale, "overview.currentDevice")}</span>
            <span class={`connection-dot ${connected() ? "is-online" : ""}`} />
          </div>
          <Show
            when={props.device}
            fallback={
              <div class="console-empty">
                <Icon name="smartphone" />
                <h3>{t(props.locale, "overview.noDevice")}</h3>
                <p>{t(props.locale, "overview.noDeviceHint")}</p>
                <Button size="sm" variant="secondary" onClick={props.onAddDevice}>
                  <Icon name="plus" />
                  {t(props.locale, "devices.add")}
                </Button>
              </div>
            }
          >
            {(device) => (
              <>
                <div class="console-device">
                  <span class="device-avatar">
                    <Icon name="smartphone" />
                  </span>
                  <div>
                    <h2>{device().profile.name}</h2>
                    <p class="mono-line">{device().profile.address}</p>
                  </div>
                </div>
                <div class="console-stats">
                  <div>
                    <span>{t(props.locale, "common.status")}</span>
                    <strong>{statusText(device().status, props.locale)}</strong>
                  </div>
                  <div>
                    <span>{t(props.locale, "common.clientType")}</span>
                    <strong>{device().profile.clientType}</strong>
                  </div>
                  <div>
                    <span>{t(props.locale, "common.touchMode")}</span>
                    <strong>{props.data.settings.touchMode}</strong>
                  </div>
                </div>
                <div class="console-footer">
                  <StatusPill
                    status={device().status}
                    label={statusText(device().status, props.locale)}
                  />
                  <Show when={!connected()}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={props.onConnect}
                      disabled={device().status === "connecting"}
                    >
                      <Icon name="power" />
                      {t(props.locale, "common.connect")}
                    </Button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </aside>
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

      <section class="overview-grid">
        <article class="panel panel--queue">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">{t(props.locale, "overview.planSummary")}</p>
              <h3>{props.plan?.name ?? t(props.locale, "overview.noRun")}</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={() => props.onNavigate("tasks")}>
              {t(props.locale, "tasks.addTask")}
              <Icon name="chevron-right" />
            </Button>
          </div>
          <Show
            when={enabledTasks().length > 0}
            fallback={<p class="muted">{t(props.locale, "tasks.noEnabled")}</p>}
          >
            <ul class="queue-preview">
              <For each={enabledTasks().slice(0, 6)}>
                {(task, index) => {
                  const runTask = () => props.run?.tasks.find((item) => item.configId === task.id);
                  return (
                    <li>
                      <span class="queue-index">{String(index() + 1).padStart(2, "0")}</span>
                      <span class="queue-name">
                        {task.name || pick(props.locale, TASK_DEFINITIONS[task.type].name)}
                      </span>
                      <span class="queue-type">{task.type}</span>
                      <span class={`dot dot--${runTask()?.status ?? "pending"}`} />
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
              <p class="panel-kicker">{t(props.locale, "overview.activity")}</p>
              <h3>
                {props.run
                  ? t(props.locale, runStatusKey(props.run.status))
                  : connected()
                    ? t(props.locale, "engine.ready")
                    : t(props.locale, "overview.noRun")}
              </h3>
            </div>
            <span class={connected() ? "live-dot is-on" : "live-dot"} />
          </div>
          <Show
            when={lastLogs().length > 0}
            fallback={<p class="muted">{t(props.locale, "overview.activityEmpty")}</p>}
          >
            <ul class="activity-list">
              <For each={lastLogs()}>
                {(entry) => (
                  <li class={`activity-line activity-line--${entry.level}`}>
                    <span class="activity-time">{formatClock(entry.at, props.locale)}</span>
                    <span>{entry.message}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </article>
      </section>

      <section class="overview-grid overview-grid--three">
        <EngineCard
          data={props.data}
          locale={props.locale}
          onOpenSettings={() => props.onNavigate("settings")}
        />
        <article class="panel">
          <div class="panel-head">
            <span class="panel-icon">
              <Icon name="activity" />
            </span>
            <div>
              <p class="panel-kicker">{t(props.locale, "overview.lastRun")}</p>
              <h3>
                {props.run
                  ? t(props.locale, runStatusKey(props.run.status))
                  : connected()
                    ? t(props.locale, "engine.ready")
                    : t(props.locale, "overview.noRun")}
              </h3>
            </div>
          </div>
          <Show
            when={props.run}
            fallback={<p class="muted">{t(props.locale, "overview.noRun")}</p>}
          >
            {(run) => (
              <>
                <div class="run-progress">
                  <span
                    style={{
                      width: `${Math.round((run().tasks.filter((task) => task.status === "completed").length / Math.max(run().tasks.length, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <div class="panel-meta">
                  <span>
                    {run().tasks.filter((task) => task.status === "completed").length}/
                    {run().tasks.length} {t(props.locale, "tasks.tasksCount")}
                  </span>
                  <span>{formatClock(run().startedAt, props.locale)}</span>
                </div>
              </>
            )}
          </Show>
        </article>
        <article class="panel">
          <div class="panel-head">
            <span class="panel-icon">
              <Icon name="sparkles" />
            </span>
            <div>
              <p class="panel-kicker">{t(props.locale, "tasks.plan")}</p>
              <h3>{props.plan?.name ?? "—"}</h3>
            </div>
          </div>
          <p class="muted">{t(props.locale, "tasks.saveHint")}</p>
          <Button size="sm" variant="ghost" onClick={() => props.onNavigate("tasks")}>
            <Icon name="list-todo" />
            {t(props.locale, "tasks.title")}
          </Button>
        </article>
      </section>
    </div>
  );
};
