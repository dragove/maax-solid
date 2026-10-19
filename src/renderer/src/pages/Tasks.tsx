import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import type {
  Bootstrap,
  DeviceView,
  Locale,
  RunSnapshot,
  StageCatalogEntry,
  TaskPlan,
  TaskType,
} from "../../../shared/schemas";
import type { UiLogEntry } from "../log-format";
import { TASK_DEFINITIONS, TASK_TYPE_ORDER } from "../../../shared/tasks";
import { pick, runStatusKey, runTaskStatusKey, t } from "../i18n/i18n";
import { TaskCard } from "../components/TaskCard";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";

interface TasksProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly device: DeviceView | undefined;
  readonly plan: TaskPlan | undefined;
  readonly run: RunSnapshot | undefined;
  readonly logs: ReadonlyArray<UiLogEntry>;
  readonly stages: ReadonlyArray<StageCatalogEntry>;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly onConnect: () => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onAddTask: (type: TaskType) => void;
  readonly onRemoveTask: (taskId: string) => void;
  readonly onEnabledChange: (taskId: string, enabled: boolean) => void;
  readonly onParamChange: (taskId: string, key: string, value: unknown) => void;
  readonly onMoveTask: (from: number, to: number) => void;
  readonly onClearLogs: () => void;
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

export const Tasks: Component<TasksProps> = (props) => {
  const [expandedId, setExpandedId] = createSignal<string | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  let logRef: HTMLDivElement | undefined;

  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const enabledTasks = () => props.plan?.tasks.filter((task) => task.enabled) ?? [];
  const isRunning = () => props.run?.status === "running" || props.run?.status === "preparing";
  const completedCount = () =>
    props.run?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const progress = () =>
    props.run && props.run.tasks.length > 0
      ? Math.round((completedCount() / props.run.tasks.length) * 100)
      : 0;

  createEffect(
    () => props.logs.length,
    () => {
      queueMicrotask(() => {
        if (logRef) logRef.scrollTop = logRef.scrollHeight;
      });
    },
  );

  const addTask = (type: TaskType): void => {
    props.onAddTask(type);
    setPaletteOpen(false);
  };

  return (
    <div class="page page--tasks">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "tasks.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "tasks.subtitle")}</p>
        </div>
        <div class="page-actions">
          <Show
            when={connected()}
            fallback={
              <Button
                variant="secondary"
                disabled={!props.device || props.busy}
                onClick={props.onConnect}
              >
                <Icon name={props.device?.status === "connecting" ? "loader" : "wifi"} />
                {props.device?.status === "connecting"
                  ? t(props.locale, "status.connecting")
                  : t(props.locale, "tasks.connect")}
              </Button>
            }
          >
            <Show
              when={isRunning()}
              fallback={
                <Button
                  variant="primary"
                  disabled={!props.device || props.busy || enabledTasks().length === 0}
                  onClick={props.onStart}
                >
                  <Icon name="play" />
                  {t(props.locale, "tasks.run")}
                </Button>
              }
            >
              <Button variant="danger" disabled={props.busy} onClick={props.onStop}>
                <Icon name="square" />
                {t(props.locale, "tasks.stop")}
              </Button>
            </Show>
          </Show>
        </div>
      </header>

      <div class="task-layout">
        <section class="task-main">
          <div class="queue-toolbar">
            <div class="queue-title">
              <span class="queue-device-icon">
                <Icon name="smartphone" />
              </span>
              <div>
                <strong>
                  {props.device?.profile.name ?? t(props.locale, "overview.noDevice")}
                </strong>
                <span class="queue-meta">
                  {props.device
                    ? statusText(props.device.status, props.locale)
                    : t(props.locale, "status.offline")}
                  <span class="dot-sep">·</span>
                  {enabledTasks().length} {t(props.locale, "tasks.tasksCount")}
                  <Show when={props.saving}>
                    <span class="dot-sep">·</span>
                    <span class="mono-label">{t(props.locale, "common.saving")}</span>
                  </Show>
                </span>
              </div>
            </div>
            <div class="queue-tools">
              <Show when={props.device}>
                {(device) => (
                  <StatusPill
                    status={device().status}
                    label={statusText(device().status, props.locale)}
                    compact
                  />
                )}
              </Show>
              <Button size="sm" variant="ghost" onClick={() => setPaletteOpen((open) => !open)}>
                <Icon name="plus" />
                {t(props.locale, "tasks.addTask")}
              </Button>
            </div>
          </div>

          <Show when={paletteOpen()}>
            <div class="task-palette">
              <div class="palette-head">
                <strong>{t(props.locale, "tasks.addTask")}</strong>
                <button
                  type="button"
                  class="icon-button"
                  onClick={() => setPaletteOpen(false)}
                  aria-label={t(props.locale, "common.close")}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div class="palette-grid">
                <For each={TASK_TYPE_ORDER}>
                  {(type) => {
                    const definition = TASK_DEFINITIONS[type];
                    return (
                      <button type="button" class="palette-item" onClick={() => addTask(type)}>
                        <span class="palette-icon">
                          <Icon name={definition.icon} />
                        </span>
                        <span>
                          <strong>{pick(props.locale, definition.name)}</strong>
                          <small>{pick(props.locale, definition.description)}</small>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>

          <Show
            when={props.plan && props.plan.tasks.length > 0}
            fallback={
              <div class="empty-state empty-state--queue">
                <span class="empty-icon">
                  <Icon name="list-todo" />
                </span>
                <h3>{t(props.locale, "tasks.noTasks")}</h3>
                <p>{t(props.locale, "tasks.noTasksHint")}</p>
                <Button variant="primary" onClick={() => setPaletteOpen(true)}>
                  <Icon name="plus" />
                  {t(props.locale, "tasks.addTask")}
                </Button>
              </div>
            }
          >
            <div class="task-list">
              <For each={props.plan!.tasks} keyed={false}>
                {(taskAccessor, index) => {
                  const task = () => taskAccessor();
                  const runTask = () =>
                    props.run?.tasks.find((item) => item.configId === task().id);
                  return (
                    <div
                      class="task-slot"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from = dragFrom();
                        if (from !== null && from !== index) props.onMoveTask(from, index);
                        setDragFrom(null);
                      }}
                    >
                      <TaskCard
                        task={task()}
                        locale={props.locale}
                        stages={props.stages}
                        expanded={expandedId() === task().id}
                        runTask={runTask()}
                        disabled={isRunning()}
                        onToggleExpanded={() =>
                          setExpandedId((current) => (current === task().id ? null : task().id))
                        }
                        onEnabledChange={(enabled) => props.onEnabledChange(task().id, enabled)}
                        onParamChange={(key, value) => props.onParamChange(task().id, key, value)}
                        onRemove={() => props.onRemoveTask(task().id)}
                        onDragStart={() => setDragFrom(index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => undefined}
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </section>

        <aside class="task-side">
          <section class="panel run-panel">
            <div class="panel-head">
              <div>
                <p class="panel-kicker">{t(props.locale, "tasks.live")}</p>
                <h3>
                  {props.run
                    ? t(props.locale, runStatusKey(props.run.status))
                    : t(props.locale, "tasks.noLogs")}
                </h3>
              </div>
            </div>
            <Show
              when={props.run}
              fallback={
                <p class="muted">
                  {connected()
                    ? t(props.locale, "tasks.noLogs")
                    : t(props.locale, "tasks.offlineHint")}
                </p>
              }
            >
              {(run) => (
                <>
                  <div class="run-meter">
                    <div class="run-meter-fill" style={{ width: `${progress()}%` }} />
                  </div>
                  <div class="panel-meta">
                    <span>
                      {completedCount()}/{run().tasks.length} {t(props.locale, "tasks.tasksCount")}
                    </span>
                    <span>{progress()}%</span>
                  </div>
                  <ul class="run-task-list">
                    <For each={run().tasks}>
                      {(task) => (
                        <li class={`run-task run-task--${task.status}`}>
                          <span class="run-task-name">
                            {task.name && task.name !== task.type
                              ? task.name
                              : pick(props.locale, TASK_DEFINITIONS[task.type].name)}
                          </span>
                          <span class="run-task-state">
                            {t(props.locale, runTaskStatusKey(task.status))}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </>
              )}
            </Show>
          </section>

          <section class="panel log-panel">
            <div class="panel-head">
              <div>
                <h3>{t(props.locale, "tasks.logs")}</h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={props.onClearLogs}
                disabled={props.logs.length === 0}
              >
                <Icon name="trash-2" />
                {t(props.locale, "tasks.clearLogs")}
              </Button>
            </div>
            <div
              class="log-stream"
              ref={(element) => {
                logRef = element;
              }}
            >
              <Show
                when={props.logs.length > 0}
                fallback={<p class="muted log-empty">{t(props.locale, "tasks.noLogs")}</p>}
              >
                <For each={props.logs}>
                  {(entry) => (
                    <div class={`log-line log-line--${entry.level}`}>
                      <span class="log-time">
                        {new Date(entry.at).toLocaleTimeString(props.locale, { hour12: false })}
                      </span>
                      <span class="log-message">{entry.message}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
