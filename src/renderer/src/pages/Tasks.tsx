import { For, Show, createSignal, type Component } from "solid-js";
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
import { TASK_DEFINITIONS, TASK_PALETTE_ORDER } from "../../../shared/tasks";
import { pick, runStatusKey, runTaskStatusKey, t } from "../i18n/i18n";
import { LogStream } from "../components/LogStream";
import { TaskCard } from "../components/TaskCard";
import { Button } from "../components/ui/Button";
import { Collapse } from "../components/ui/Collapse";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";
import { SwapStack } from "../components/ui/SwapStack";

interface TasksProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly device: DeviceView | undefined;
  readonly plan: TaskPlan | undefined;
  readonly run: RunSnapshot | undefined;
  readonly logs: ReadonlyArray<UiLogEntry>;
  readonly stages: ReadonlyArray<StageCatalogEntry>;
  readonly plans: ReadonlyArray<TaskPlan>;
  readonly onSelectPlan: (planId: string) => void;
  readonly onCreatePlan: () => void;
  readonly onDuplicatePlan: () => void;
  readonly onRenamePlan: (name: string) => void;
  readonly onImportPlan: () => void;
  readonly onExportPlan: () => void;
  readonly onDeletePlan: () => void;
  readonly onPickFile: (taskId: string, key: string) => void;
  readonly onResolveCopilot: (taskId: string, input: string) => Promise<boolean>;
  readonly onBrowseCopilot: (taskId: string) => void;
  readonly busy: boolean;
  readonly connectBusy: boolean;
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
  const [renaming, setRenaming] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");

  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const enabledTasks = () => props.plan?.tasks.filter((task) => task.enabled) ?? [];
  const isRunning = () => props.run?.status === "running" || props.run?.status === "preparing";
  const completedCount = () => props.run?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const progress = () =>
    props.run && props.run.tasks.length > 0 ? Math.round((completedCount() / props.run.tasks.length) * 100) : 0;

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
          <SwapStack
            current={connected() ? (isRunning() ? "stop" : "run") : "connect"}
            items={[
              {
                id: "connect",
                node: (
                  <Button
                    variant="secondary"
                    disabled={!props.device || props.busy || props.connectBusy}
                    onClick={props.onConnect}
                  >
                    <Icon
                      name={props.device?.status === "connecting" ? "loader" : "wifi"}
                      class={props.device?.status === "connecting" ? "spin" : undefined}
                    />
                    {props.device?.status === "connecting"
                      ? t(props.locale, "status.connecting")
                      : t(props.locale, "tasks.connect")}
                  </Button>
                ),
              },
              {
                id: "run",
                node: (
                  <Button
                    variant="primary"
                    disabled={!props.device || props.busy || enabledTasks().length === 0}
                    onClick={props.onStart}
                  >
                    <Icon name="play" />
                    {t(props.locale, "tasks.run")}
                  </Button>
                ),
              },
              {
                id: "stop",
                node: (
                  <Button variant="danger" disabled={props.busy} onClick={props.onStop}>
                    <Icon name="square" />
                    {t(props.locale, "tasks.stop")}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </header>

      <div class="plan-bar">
        <Icon name="list-todo" />
        <span class="plan-label">{t(props.locale, "plans.select")}</span>
        <select
          class="input plan-select"
          value={props.plan?.id ?? ""}
          disabled={!props.device || props.busy}
          onChange={(event) => props.onSelectPlan(event.currentTarget.value)}
        >
          <For each={props.plans}>
            {(item) => (
              <option value={item.id} selected={item.id === props.plan?.id}>
                {item.name}
              </option>
            )}
          </For>
        </select>
        <Show
          when={renaming()}
          fallback={
            <div class="plan-actions">
              <Button
                size="sm"
                variant="ghost"
                disabled={!props.device || props.busy}
                onClick={() => {
                  setDraftName(props.plan?.name ?? "");
                  setRenaming(true);
                }}
              >
                {t(props.locale, "plans.rename")}
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.device || props.busy} onClick={props.onCreatePlan}>
                {t(props.locale, "plans.new")}
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.plan || props.busy} onClick={props.onDuplicatePlan}>
                {t(props.locale, "plans.duplicate")}
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.device || props.busy} onClick={props.onImportPlan}>
                {t(props.locale, "plans.import")}
              </Button>
              <Button size="sm" variant="ghost" disabled={!props.plan || props.busy} onClick={props.onExportPlan}>
                {t(props.locale, "plans.export")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!props.plan || props.busy || props.plans.length <= 1}
                onClick={props.onDeletePlan}
              >
                <Icon name="trash-2" />
              </Button>
            </div>
          }
        >
          <input
            class="input plan-name"
            value={draftName()}
            onInput={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onRenamePlan(draftName());
                setRenaming(false);
              } else if (event.key === "Escape") {
                setRenaming(false);
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              props.onRenamePlan(draftName());
              setRenaming(false);
            }}
          >
            {t(props.locale, "common.save")}
          </Button>
        </Show>
      </div>

      <div class="task-layout">
        <section class="task-main">
          <div class="queue-toolbar">
            <div class="queue-title">
              <span class="queue-device-icon">
                <Icon name="smartphone" />
              </span>
              <div>
                <strong>{props.device?.profile.name ?? t(props.locale, "overview.noDevice")}</strong>
                <span class="queue-meta">
                  {props.device ? statusText(props.device.status, props.locale) : t(props.locale, "status.offline")}
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
                  <StatusPill status={device().status} label={statusText(device().status, props.locale)} compact />
                )}
              </Show>
              <Button size="sm" variant="ghost" onClick={() => setPaletteOpen((open) => !open)}>
                <Icon name="plus" />
                {t(props.locale, "tasks.addTask")}
              </Button>
            </div>
          </div>

          <Collapse open={paletteOpen()}>
            {() => (
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
                  <For each={TASK_PALETTE_ORDER}>
                    {(type, index) => {
                      const definition = TASK_DEFINITIONS[type];
                      return (
                        <button
                          type="button"
                          class="palette-item"
                          style={{ "animation-delay": `${Math.min(index(), 8) * 14}ms` }}
                          onClick={() => addTask(type)}
                        >
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
            )}
          </Collapse>

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
                  const runTask = () => props.run?.tasks.find((item) => item.configId === task().id);
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
                        onToggleExpanded={() => setExpandedId((current) => (current === task().id ? null : task().id))}
                        onEnabledChange={(enabled) => props.onEnabledChange(task().id, enabled)}
                        onParamChange={(key, value) => props.onParamChange(task().id, key, value)}
                        onPickFile={(key) => props.onPickFile(task().id, key)}
                        onResolveCopilot={(input) => props.onResolveCopilot(task().id, input)}
                        onBrowseCopilot={() => props.onBrowseCopilot(task().id)}
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
                <h3>{props.run ? t(props.locale, runStatusKey(props.run.status)) : t(props.locale, "tasks.noLogs")}</h3>
              </div>
            </div>
            <Show
              when={props.run}
              fallback={
                <p class="muted">
                  {connected() ? t(props.locale, "tasks.noLogs") : t(props.locale, "tasks.offlineHint")}
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
                        <li class="run-task">
                          <span class="run-task-name">
                            {task.name && task.name !== task.type
                              ? task.name
                              : pick(props.locale, TASK_DEFINITIONS[task.type].name)}
                          </span>
                          <span class="run-task-state">{t(props.locale, runTaskStatusKey(task.status))}</span>
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
              <Button size="sm" variant="ghost" onClick={props.onClearLogs} disabled={props.logs.length === 0}>
                <Icon name="trash-2" />
                {t(props.locale, "tasks.clearLogs")}
              </Button>
            </div>
            <LogStream entries={props.logs} locale={props.locale} empty={t(props.locale, "tasks.noLogs")} />
          </section>
        </aside>
      </div>
    </div>
  );
};
