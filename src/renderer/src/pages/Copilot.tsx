import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";
import type {
  CopilotItem,
  CopilotKind,
  CopilotOptions,
  DeviceView,
  Locale,
  RunSnapshot,
} from "../../../shared/schemas";
import { copilotEntryMode, copilotModeLabelKey } from "../../../shared/copilot-mode";
import type { UiLogEntry } from "../log-format";
import { t } from "../i18n/i18n";
import { CopilotDetailBody, createCopilotDetails } from "../components/CopilotDetail";
import { LogStream } from "../components/LogStream";
import { Button } from "../components/ui/Button";
import { Collapse } from "../components/ui/Collapse";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";
import { Switch } from "../components/ui/Switch";

interface CopilotPageProps {
  readonly device: DeviceView | undefined;
  readonly run: RunSnapshot | undefined;
  readonly items: ReadonlyArray<CopilotItem>;
  readonly options: CopilotOptions;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly connectBusy: boolean;
  readonly logs: ReadonlyArray<UiLogEntry>;
  readonly onClearLogs: () => void;
  readonly onConnect: () => void;
  readonly onStart: (itemId?: string) => void;
  readonly onStop: () => void;
  readonly onOptions: (patch: Partial<CopilotOptions>) => void;
  readonly onItems: (items: ReadonlyArray<CopilotItem>) => void;
  readonly onResolve: (input: string) => Promise<boolean>;
  readonly onBrowse: () => void;
}

const SUPPORT_USAGE: ReadonlyArray<0 | 1 | 2 | 3> = [0, 1, 2, 3];

/**
 * Copilot tab: clear a stage once with an assignment, outside the daily queue.
 *
 * Nothing here is a plan — the batch and its options are saved on their own and
 * a run appends exactly one Copilot task to the connected session.
 */
export const Copilot: Component<CopilotPageProps> = (props) => {
  const [input, setInput] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  // The batch only stores file paths; the notes and operator plan come back
  // from the downloaded JSON, once per entry.
  const details = createCopilotDetails(() => props.items);
  // A transient single-assignment target. It never changes the saved batch or
  // options: selecting a row only changes what the Start button launches.
  const [singleId, setSingleId] = createSignal<string | null>(null);
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [dragOver, setDragOver] = createSignal<number | null>(null);
  const singleItem = createMemo(() => props.items.find((item) => item.id === singleId()));
  const enabledItems = createMemo(() => props.items.filter((item) => item.enabled !== false));
  const toggleItem = (id: string, enabled: boolean): void => {
    props.onItems(props.items.map((item) => (item.id === id ? { ...item, enabled } : item)));
  };
  const moveItem = (from: number, to: number): void => {
    if (from === to) return;
    const items = [...props.items];
    const [moved] = items.splice(from, 1);
    if (moved === undefined) return;
    items.splice(to, 0, moved);
    props.onItems(items);
  };
  const toggleSingle = (id: string): void => {
    setSingleId((current) => (current === id ? null : id));
  };

  // Removing the selected entry drops the selection so Start cannot silently
  // fall back to the whole batch.
  createEffect(
    () => (singleId() === null ? false : !props.items.some((item) => item.id === singleId())),
    (missing) => {
      if (missing) setSingleId(null);
    },
  );

  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const running = () => props.run?.status === "running" || props.run?.status === "preparing";
  const current = () => props.run?.tasks[0];

  /** A batch can only drive one MaaCore task family at a time. */
  const kind = (): CopilotKind | "mixed" => {
    const kinds = new Set(enabledItems().map((item) => item.kind ?? "normal"));
    if (kinds.size === 0) return "normal";
    return kinds.size === 1 ? [...kinds][0]! : "mixed";
  };

  const prerequisite = (): string => {
    if (singleItem() !== undefined) {
      return t(props.locale, "copilotPage.prerequisiteManual");
    }
    if (props.items.length > 0 && enabledItems().length === 0) {
      return t(props.locale, "copilotPage.allDisabled");
    }
    switch (kind()) {
      case "sss":
        return t(props.locale, "copilotPage.prerequisiteSss");
      case "paradox":
        return t(props.locale, "copilotPage.prerequisiteParadox");
      case "mixed":
        return t(props.locale, "copilotPage.prerequisiteMixed");
      default:
        return t(props.locale, "copilotPage.prerequisite");
    }
  };

  const kindLabel = (value: CopilotKind): string => {
    switch (value) {
      case "sss":
        return t(props.locale, "copilot.kind.sss");
      case "paradox":
        return t(props.locale, "copilot.kind.paradox");
      default:
        return t(props.locale, "copilot.kind.normal");
    }
  };

  const add = async (): Promise<void> => {
    const value = input().trim();
    if (value === "" || adding()) return;
    setAdding(true);
    try {
      if (await props.onResolve(value)) setInput("");
    } finally {
      setAdding(false);
    }
  };

  const remove = (id: string): void => props.onItems(props.items.filter((item) => item.id !== id));

  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "copilotPage.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "copilotPage.subtitle")}</p>
        </div>
        <div class="page-actions">
          <Show when={props.device}>
            {(device) => <StatusPill status={device().status} label={device().profile.name} compact />}
          </Show>
          <Show
            when={connected()}
            fallback={
              <Button
                variant="secondary"
                disabled={!props.device || props.busy || props.connectBusy}
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
              when={running()}
              fallback={
                <Button
                  variant="primary"
                  disabled={
                    props.busy ||
                    props.items.length === 0 ||
                    (singleItem() === undefined && (kind() === "mixed" || enabledItems().length === 0))
                  }
                  onClick={() => props.onStart(singleItem()?.id)}
                >
                  <Icon name="play" />
                  {singleItem() ? t(props.locale, "copilotPage.startSingle") : t(props.locale, "copilotPage.start")}
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

      <p class={["copilot-prereq", { "copilot-prereq--mixed": kind() === "mixed" }]}>
        <Icon name={kind() === "mixed" ? "alert-triangle" : "info"} />
        {prerequisite()}
      </p>

      <div class="copilot-grid">
        <section class="copilot-panel">
          <header class="copilot-panel-head">
            <span class="field-label">{t(props.locale, "copilot.list")}</span>
            <Button size="sm" variant="ghost" disabled={props.busy || running()} onClick={props.onBrowse}>
              <Icon name="search" />
              {t(props.locale, "copilot.browse")}
            </Button>
          </header>

          <div class="copilot-add">
            <input
              class="input"
              placeholder={t(props.locale, "copilot.addPlaceholder")}
              value={input()}
              disabled={running() || adding()}
              onInput={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void add();
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={running() || adding() || input().trim() === ""}
              onClick={() => void add()}
            >
              {adding() ? t(props.locale, "common.working") : t(props.locale, "copilot.add")}
            </Button>
          </div>

          <Show
            when={props.items.length > 0}
            fallback={<p class="copilot-empty">{t(props.locale, "copilot.empty")}</p>}
          >
            <ul class="copilot-items">
              {/* Entries keep their id across saves, so keying by it stops the row
                  entrance animation from replaying whenever the batch is rewritten. */}
              <For each={props.items} keyed={(item) => item.id}>
                {(item, index) => (
                  <li
                    class={[
                      "copilot-item",
                      {
                        "copilot-item--disabled": item().enabled === false,
                        "copilot-item--dragging": dragFrom() === index(),
                        "copilot-item--drop": dragOver() === index() && dragFrom() !== index(),
                      },
                    ]}
                    draggable={!running() ? "true" : "false"}
                    onDragStart={(event) => {
                      setDragFrom(index());
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item().id);
                      }
                    }}
                    onDragOver={(event) => {
                      if (dragFrom() === null) return;
                      event.preventDefault();
                      setDragOver(index());
                      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragFrom();
                      const to = index();
                      setDragFrom(null);
                      setDragOver(null);
                      if (from !== null) moveItem(from, to);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  >
                    <div class="copilot-item-row">
                      <span class="copilot-order">
                        <span class="drag-handle" title={t(props.locale, "copilotPage.dragHint")}>
                          <Icon name="grip-vertical" />
                        </span>
                        <span class="copilot-index">{index() + 1}</span>
                      </span>
                      <Switch
                        checked={item().enabled !== false}
                        disabled={running()}
                        onChange={(value) => toggleItem(item().id, value)}
                        label={t(props.locale, "copilotPage.enableItem")}
                        title={t(props.locale, "copilotPage.enableItem")}
                      />
                      <span class={["copilot-mode", { "copilot-mode--raid": copilotEntryMode(item()) === "raid" }]}>
                        {t(props.locale, copilotModeLabelKey(copilotEntryMode(item()) === "raid", item().stage))}
                      </span>
                      <Show when={(item().kind ?? "normal") !== "normal"}>
                        <span class={["copilot-kind", `copilot-kind--${item().kind}`]}>
                          {kindLabel(item().kind ?? "normal")}
                        </span>
                      </Show>
                      <span class="copilot-title">{item().title || item().stage || item().filename}</span>
                      <span class="copilot-stage">{item().stage}</span>
                      <Show when={details.hasDetail(item().id)}>
                        <Button size="sm" variant="ghost" onClick={() => details.toggle(item().id)}>
                          {t(props.locale, "browser.detail")}
                        </Button>
                      </Show>
                      <Show when={(item().kind ?? "normal") === "normal"}>
                        <Button
                          size="sm"
                          variant={singleId() === item().id ? "secondary" : "ghost"}
                          disabled={running()}
                          title={t(props.locale, "copilotPage.singleRunHint")}
                          onClick={() => toggleSingle(item().id)}
                        >
                          <Icon name={singleId() === item().id ? "check" : "play"} />
                          {t(props.locale, "copilotPage.singleRun")}
                        </Button>
                      </Show>
                      <button
                        type="button"
                        class="icon-button"
                        title={t(props.locale, "common.remove")}
                        disabled={running()}
                        onClick={() => remove(item().id)}
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                    <Collapse open={details.isOpen(item().id)}>
                      {() => <CopilotDetailBody detail={details.detail(item().id)} locale={props.locale} />}
                    </Collapse>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={props.items.length > 0}>
            <p class="copilot-hint">{t(props.locale, "copilotPage.autoDisableHint")}</p>
          </Show>

          <Show when={props.items.length > 0 && !running()}>
            <div class="copilot-foot">
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onItems([])}>
                <Icon name="trash-2" />
                {t(props.locale, "copilot.clear")}
              </Button>
            </div>
          </Show>
        </section>

        <section class="copilot-panel">
          <header class="copilot-panel-head">
            <span class="field-label">{t(props.locale, "copilotPage.options")}</span>
          </header>
          <div class="copilot-options">
            <Show when={singleItem()}>
              {(item) => (
                <div class="copilot-option-note copilot-option-note--single">
                  <span>
                    {t(props.locale, "copilotPage.singleRunNote")} · {item().title || item().stage || item().filename}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setSingleId(null)}>
                    {t(props.locale, "copilotPage.clearSingle")}
                  </Button>
                </div>
              )}
            </Show>
            <Show when={kind() === "normal"}>
              <label class="field field--switch">
                <span class="field-label">{t(props.locale, "copilotPage.formation")}</span>
                <Switch
                  checked={props.options.formation}
                  disabled={running()}
                  onChange={(value) => props.onOptions({ formation: value })}
                  label={t(props.locale, "copilotPage.formation")}
                />
              </label>
              <label class="field field--switch">
                <span class="field-label">{t(props.locale, "copilotPage.addTrust")}</span>
                <Switch
                  checked={props.options.addTrust}
                  disabled={running()}
                  onChange={(value) => props.onOptions({ addTrust: value })}
                  label={t(props.locale, "copilotPage.addTrust")}
                />
              </label>
              <label class="field field--switch">
                <span class="field-label">{t(props.locale, "copilotPage.ignoreRequirements")}</span>
                <Switch
                  checked={props.options.ignoreRequirements}
                  disabled={running()}
                  onChange={(value) => props.onOptions({ ignoreRequirements: value })}
                  label={t(props.locale, "copilotPage.ignoreRequirements")}
                />
              </label>
              <label class="field field--switch">
                <span class="field-label">{t(props.locale, "copilotPage.useSanityPotion")}</span>
                <Switch
                  checked={props.options.useSanityPotion}
                  disabled={running()}
                  onChange={(value) => props.onOptions({ useSanityPotion: value })}
                  label={t(props.locale, "copilotPage.useSanityPotion")}
                />
              </label>
              <label class="field">
                <span class="field-label">{t(props.locale, "copilotPage.supportUnit")}</span>
                <select
                  class="input"
                  value={String(props.options.supportUnitUsage)}
                  disabled={running()}
                  onChange={(event) => props.onOptions({ supportUnitUsage: Number(event.currentTarget.value) })}
                >
                  <For each={SUPPORT_USAGE}>
                    {(value) => (
                      <option value={String(value)} selected={props.options.supportUnitUsage === value}>
                        {t(props.locale, `copilotPage.support${value}` as Parameters<typeof t>[1])}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <Show when={kind() === "normal" || kind() === "sss"}>
              <label class="field">
                <span class="field-label">{t(props.locale, "copilotPage.loopTimes")}</span>
                <input
                  class="input input--number"
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={props.options.loopTimes}
                  disabled={running()}
                  onInput={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    props.onOptions({ loopTimes: Number.isFinite(next) ? Math.max(1, Math.trunc(next)) : 1 });
                  }}
                />
              </label>
            </Show>
            <Show when={kind() === "normal"}>
              <label class="field">
                <span class="field-label">{t(props.locale, "copilotPage.formationIndex")}</span>
                <input
                  class="input input--number"
                  type="number"
                  min={0}
                  max={4}
                  step={1}
                  value={props.options.formationIndex}
                  disabled={running()}
                  onInput={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    props.onOptions({
                      formationIndex: Number.isFinite(next) ? Math.min(4, Math.max(0, Math.trunc(next))) : 0,
                    });
                  }}
                />
              </label>
            </Show>
            <Show when={kind() === "sss"}>
              <p class="copilot-option-note">{t(props.locale, "copilotPage.sssOptionsHint")}</p>
            </Show>
            <Show when={kind() === "paradox"}>
              <p class="copilot-option-note">{t(props.locale, "copilotPage.paradoxOptionsHint")}</p>
            </Show>
            <Show when={kind() === "mixed"}>
              <p class="copilot-option-note copilot-option-note--warning">
                <Icon name="alert-triangle" />
                {t(props.locale, "copilotPage.prerequisiteMixed")}
              </p>
            </Show>
          </div>

          <Show when={props.run}>
            {(run) => (
              <div class="copilot-run">
                <span class="field-label">{t(props.locale, "copilotPage.status")}</span>
                <div class="copilot-run-row">
                  <span class={`task-state task-state--${current()?.status ?? run().status}`}>
                    {t(props.locale, "tasks.running")}
                  </span>
                  <span class="mono-label">
                    {run().status} · {current()?.status ?? "—"}
                  </span>
                </div>
                <Show when={current()?.message ?? run().message}>
                  {(message) => <p class="copilot-empty">{message()}</p>}
                </Show>
              </div>
            )}
          </Show>
        </section>
      </div>

      <section class="panel log-panel copilot-log">
        <div class="panel-head">
          <div>
            <h3>{t(props.locale, "copilotPage.logs")}</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={props.onClearLogs} disabled={props.logs.length === 0}>
            <Icon name="trash-2" />
            {t(props.locale, "tasks.clearLogs")}
          </Button>
        </div>
        <LogStream entries={props.logs} locale={props.locale} empty={t(props.locale, "tasks.noLogs")} />
      </section>
    </div>
  );
};
