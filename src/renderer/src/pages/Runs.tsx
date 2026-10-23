import { For, Show, createEffect, createSignal, untrack, type Component } from "solid-js";
import type {
  Bootstrap,
  DeviceView,
  Locale,
  RunHistory,
  RunHistoryEntry,
  RunSnapshot,
  Schedule,
  TaskPlan,
} from "../../../shared/schemas";
import { defaultSchedule, nextScheduledAt, WEEKDAYS } from "../../../shared/schedule";
import { t } from "../i18n/i18n";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";
import { Switch } from "../components/ui/Switch";

interface RunsProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly device: DeviceView | undefined;
  readonly plans: ReadonlyArray<TaskPlan>;
  readonly run: RunSnapshot | undefined;
  readonly history: RunHistory;
  readonly schedules: ReadonlyArray<Schedule>;
  readonly busy: boolean;
  readonly connectBusy: boolean;
  readonly onSaveSchedule: (schedule: Schedule) => Promise<boolean>;
  readonly onRunNow: (planId?: string) => void;
  readonly onClearHistory: () => void;
}

const weekdayLabel = (day: number, locale: Locale): string => {
  // 2024-01-07 is a Sunday, so adding the JS weekday reaches the right name.
  const date = new Date(2024, 0, 7 + day);
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
};

const durationText = (ms: number, locale: Locale): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0)
    return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "narrow" }).format(minutes);
  return `${hours} h ${minutes} min`;
};

const dateTimeText = (at: number, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);

const statusTone = (status: RunHistoryEntry["status"]): "ok" | "bad" | "busy" =>
  status === "completed" ? "ok" : status === "failed" ? "bad" : "busy";

const statusLabel = (status: RunHistoryEntry["status"], locale: Locale): string => {
  switch (status) {
    case "completed":
      return t(locale, "tasks.completed");
    case "failed":
      return t(locale, "tasks.failed");
    case "stopped":
      return t(locale, "tasks.stopped");
    default:
      return t(locale, "status.running");
  }
};

export const Runs: Component<RunsProps> = (props) => {
  const [draft, setDraft] = createSignal<Schedule>();
  const [deviceOnly, setDeviceOnly] = createSignal(true);
  const [timeError, setTimeError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  let lastDeviceId: string | undefined;

  const savedFor = (deviceId: string | undefined): Schedule | undefined => {
    if (!deviceId) return undefined;
    return props.schedules.find((schedule) => schedule.deviceId === deviceId) ?? defaultSchedule(deviceId);
  };

  // Reset the editable draft when the selected device changes. The apply phase
  // is not tracked, so the schedule snapshot is read through untrack.
  createEffect(
    () => props.device?.profile.id,
    (deviceId) => {
      if (deviceId === lastDeviceId) return;
      lastDeviceId = deviceId;
      setTimeError("");
      setDraft(untrack(() => savedFor(deviceId)));
    },
  );

  const schedule = (): Schedule => {
    const current = draft();
    if (current) return current;
    const device = props.device;
    return device
      ? defaultSchedule(device.profile.id)
      : { deviceId: "", enabled: false, time: "09:00", weekdays: [...WEEKDAYS] };
  };

  const updateDraft = (patch: Partial<Schedule>): void => {
    setDraft({ ...schedule(), ...patch });
  };

  const save = async (patch: Partial<Schedule> = {}): Promise<void> => {
    const next = { ...schedule(), ...patch };
    if (next.deviceId === "") return;
    if (next.weekdays.length === 0) {
      setTimeError(t(props.locale, "runs.weekdayRequired"));
      return;
    }
    setTimeError("");
    setSaving(true);
    const ok = await props.onSaveSchedule(next);
    setSaving(false);
    // A device switch while the save was in flight owns the new draft; do not
    // write the old device's schedule over it.
    if (ok && props.device?.profile.id === next.deviceId) setDraft(next);
  };

  const toggleDay = (day: number): void => {
    const current = schedule().weekdays;
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
    if (next.length === 0) {
      setTimeError(t(props.locale, "runs.weekdayRequired"));
      return;
    }
    setTimeError("");
    updateDraft({ weekdays: next });
    void save({ weekdays: next });
  };

  const nextRun = () => {
    if (!schedule().enabled) return t(props.locale, "runs.never");
    const next = nextScheduledAt(schedule());
    return next === undefined ? t(props.locale, "runs.never") : dateTimeText(next, props.locale);
  };

  const liveSchedule = () => props.schedules.find((item) => item.deviceId === props.device?.profile.id) ?? schedule();

  const nextStatus = (status: Schedule["lastStatus"]): string => {
    switch (status) {
      case "started":
        return t(props.locale, "runs.statusStarted");
      case "skipped":
        return t(props.locale, "runs.statusSkipped");
      case "failed":
        return t(props.locale, "runs.statusFailed");
      default:
        return "—";
    }
  };

  const stats = () => props.history.stats;
  const entries = () =>
    deviceOnly() && props.device
      ? props.history.entries.filter((entry) => entry.deviceId === props.device?.profile.id)
      : props.history.entries;
  const successRate = () => {
    const value = stats();
    const settled = value.completed + value.failed;
    return settled === 0 ? "—" : `${Math.round((value.completed / settled) * 100)}%`;
  };
  const maxDay = () => Math.max(1, ...stats().byDay.map((day) => day.total));

  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "runs.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "runs.subtitle")}</p>
        </div>
        <div class="page-actions">
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            disabled={props.busy || !props.device}
            onClick={() => props.onRunNow(schedule().planId)}
          >
            <Icon name="play" />
            {t(props.locale, "runs.runNow")}
          </button>
        </div>
      </header>

      <div class="runs-layout">
        <div class="runs-column">
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="clock" />
              </span>
              <div>
                <h2>{t(props.locale, "runs.schedule")}</h2>
                <p>{t(props.locale, "runs.scheduleHint")}</p>
              </div>
            </header>
            <Show
              when={props.device}
              fallback={
                <div class="tool-empty">
                  <p>{t(props.locale, "devices.empty")}</p>
                </div>
              }
            >
              <div class="switch-row">
                <span>{t(props.locale, "runs.enabled")}</span>
                <Switch
                  checked={schedule().enabled}
                  onChange={(enabled) => {
                    updateDraft({ enabled });
                    void save({ enabled });
                  }}
                />
              </div>
              <div class="schedule-grid">
                <label class="field">
                  <span class="field-label">{t(props.locale, "runs.time")}</span>
                  <input
                    class="input"
                    type="time"
                    value={schedule().time}
                    onChange={(event) => {
                      const time = event.currentTarget.value;
                      if (time === "") {
                        setTimeError(t(props.locale, "runs.invalidTime"));
                        return;
                      }
                      updateDraft({ time });
                      void save({ time });
                    }}
                  />
                </label>
                <label class="field">
                  <span class="field-label">{t(props.locale, "runs.plan")}</span>
                  <select
                    class="input"
                    value={schedule().planId ?? ""}
                    onChange={(event) => {
                      const planId = event.currentTarget.value || undefined;
                      updateDraft({ planId });
                      void save({ planId });
                    }}
                  >
                    <option value="" selected={!schedule().planId}>
                      {t(props.locale, "runs.activePlan")}
                    </option>
                    <For each={props.plans}>
                      {(plan) => (
                        <option value={plan.id} selected={plan.id === (schedule().planId ?? "")}>
                          {plan.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </div>
              <div class="field">
                <span class="field-label">{t(props.locale, "runs.weekdays")}</span>
                <div class="weekday-row">
                  <For each={WEEKDAYS}>
                    {(day) => (
                      <button
                        type="button"
                        class={["weekday", { "weekday--on": schedule().weekdays.includes(day) }]}
                        aria-pressed={schedule().weekdays.includes(day) ? "true" : "false"}
                        onClick={() => toggleDay(day)}
                      >
                        {weekdayLabel(day, props.locale)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={timeError()}>
                <p class="tool-warning">
                  <Icon name="alert-triangle" />
                  {timeError()}
                </p>
              </Show>
              <div class="schedule-footer">
                <span class="panel-kicker">
                  {t(props.locale, "runs.next")} · {nextRun()}
                </span>
                <span class="panel-kicker">
                  {t(props.locale, "runs.lastResult")} · {nextStatus(liveSchedule().lastStatus)}
                </span>
                <button type="button" class="btn btn--primary btn--sm" disabled={saving()} onClick={() => void save()}>
                  <Icon name="check" />
                  {t(props.locale, "runs.save")}
                </button>
              </div>
            </Show>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="activity" />
              </span>
              <div>
                <h2>{t(props.locale, "runs.stats")}</h2>
                <p>{t(props.locale, "runs.byDay")}</p>
              </div>
            </header>
            <div class="runs-stats">
              <div class="stat-card">
                <span>{t(props.locale, "runs.totalRuns")}</span>
                <strong>{stats().total}</strong>
              </div>
              <div class="stat-card">
                <span>{t(props.locale, "runs.successRate")}</span>
                <strong>{successRate()}</strong>
              </div>
              <div class="stat-card">
                <span>{t(props.locale, "runs.today")}</span>
                <strong>{stats().today}</strong>
              </div>
              <div class="stat-card">
                <span>{t(props.locale, "runs.totalTime")}</span>
                <strong>{durationText(stats().totalDurationMs, props.locale)}</strong>
              </div>
            </div>
            <div class="bars">
              <For each={stats().byDay}>
                {(day) => (
                  <div class="bar">
                    <div class="bar-track">
                      <div
                        class="bar-fill"
                        style={{ height: day.total === 0 ? "0%" : `${Math.max(4, (day.total / maxDay()) * 100)}%` }}
                      />
                    </div>
                    <span>{day.date.slice(5)}</span>
                    <strong>{day.total}</strong>
                  </div>
                )}
              </For>
            </div>
            <div class="taskstat-list">
              <For each={stats().byTask.slice(0, 6)}>
                {(task) => (
                  <div class="taskstat-row">
                    <span>{task.type}</span>
                    <div class="taskstat-track">
                      <div
                        class="taskstat-fill"
                        style={{ width: `${Math.round((task.completed / Math.max(1, task.total)) * 100)}%` }}
                      />
                    </div>
                    <strong>
                      {task.completed}/{task.total}
                    </strong>
                  </div>
                )}
              </For>
            </div>
          </section>
        </div>

        <div class="runs-column">
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="list-todo" />
              </span>
              <div>
                <h2>{t(props.locale, "runs.history")}</h2>
                <p>{t(props.locale, "runs.historyFilter")}</p>
              </div>
              <div class="settings-head-actions">
                <Switch checked={deviceOnly()} onChange={setDeviceOnly} />
                <button type="button" class="btn btn--ghost btn--sm" onClick={props.onClearHistory}>
                  <Icon name="trash-2" />
                  {t(props.locale, "runs.clearHistory")}
                </button>
              </div>
            </header>
            <Show
              when={entries().length > 0}
              fallback={
                <div class="tool-empty">
                  <Icon name="clock" />
                  <p>{t(props.locale, "runs.noHistory")}</p>
                </div>
              }
            >
              <div class="history-list">
                {/* History arrives as a whole decoded list, so key by the entry id: an
                    appended run must not remount every row above it. */}
                <For each={entries()} keyed={(entry) => entry.id}>
                  {(entry) => (
                    <article class="history-row">
                      <div class="history-main">
                        <div class="history-title">
                          <strong>{entry().planName ?? entry().tasks[0]?.name ?? entry().id.slice(0, 8)}</strong>
                          <span class="tag">{entry().deviceName}</span>
                        </div>
                        <div class="history-meta">
                          <span>{dateTimeText(entry().startedAt, props.locale)}</span>
                          <span>{durationText(entry().endedAt - entry().startedAt, props.locale)}</span>
                          <span>
                            {entry().tasks.length} {t(props.locale, "runs.tasks")}
                          </span>
                        </div>
                      </div>
                      <StatusPill
                        status={
                          statusTone(entry().status) === "ok"
                            ? "online"
                            : statusTone(entry().status) === "bad"
                              ? "error"
                              : "running"
                        }
                        label={statusLabel(entry().status, props.locale)}
                        compact
                      />
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </div>
    </div>
  );
};
