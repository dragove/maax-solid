import { For, Show, createSignal, type Component } from "solid-js";
import type {
  CopilotItem,
  CopilotKind,
  CopilotOptions,
  DeviceView,
  Locale,
  RunSnapshot,
} from "../../../shared/schemas";
import type { UiLogEntry } from "../log-format";
import { t } from "../i18n/i18n";
import { LogStream } from "../components/LogStream";
import { Button } from "../components/ui/Button";
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
  readonly onStart: () => void;
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

  const connected = () => props.device?.status === "online" || props.device?.status === "running";
  const running = () => props.run?.status === "running" || props.run?.status === "preparing";
  const current = () => props.run?.tasks[0];

  /** A batch can only drive one MaaCore task family at a time. */
  const kind = (): CopilotKind | "mixed" => {
    const kinds = new Set(props.items.map((item) => item.kind ?? "normal"));
    if (kinds.size === 0) return "normal";
    return kinds.size === 1 ? [...kinds][0]! : "mixed";
  };

  const prerequisite = (): string => {
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
                  disabled={props.busy || props.items.length === 0 || kind() === "mixed"}
                  onClick={props.onStart}
                >
                  <Icon name="play" />
                  {t(props.locale, "copilotPage.start")}
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
                  <li class="copilot-item">
                    <span class="copilot-index">{index() + 1}</span>
                    <span class={["copilot-mode", { "copilot-mode--raid": item().isRaid }]}>
                      {t(props.locale, item().isRaid ? "copilot.raid" : "copilot.normal")}
                    </span>
                    <Show when={(item().kind ?? "normal") !== "normal"}>
                      <span class={["copilot-kind", `copilot-kind--${item().kind}`]}>
                        {kindLabel(item().kind ?? "normal")}
                      </span>
                    </Show>
                    <span class="copilot-title">{item().title || item().stage || item().filename}</span>
                    <span class="copilot-stage">{item().stage}</span>
                    <button
                      type="button"
                      class="icon-button"
                      title={t(props.locale, "common.remove")}
                      disabled={running()}
                      onClick={() => remove(item().id)}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
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
