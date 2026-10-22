import { Errored, For, Loading, Show, createMemo, createSignal, type Component } from "solid-js";
import type {
  Bootstrap,
  DeviceView,
  DepotItem,
  Locale,
  OperBoxEntry,
  RecruitmentData,
  RecruitmentOperator,
  RunSnapshot,
  ToolKind,
} from "../../../shared/schemas";
import { COMMANDS } from "../../../shared/ipc";
import { matchRecruitment, recruitmentTagLabel, type RecruitmentMatch } from "../../../shared/recruitment";
import { command } from "../effect/desktop";
import { runEffect } from "../effect/solid-effect";
import { t } from "../i18n/i18n";
import { Icon } from "../components/ui/Icon";
import { Segmented } from "../components/ui/Segmented";
import { StatusPill } from "../components/ui/StatusPill";

type ToolTab = "recruitment" | "operbox" | "depot";

interface ToolsProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly device: DeviceView | undefined;
  readonly run: RunSnapshot | undefined;
  readonly busy: boolean;
  readonly connectBusy: boolean;
  readonly onConnect: () => void;
  readonly onScan: (kind: ToolKind) => void;
}

const rarityLabel = (rarity: number): string => (rarity > 0 ? String(rarity) + "★" : "—");

const scanActive = (run: RunSnapshot | undefined, type: "OperBox" | "Depot"): boolean =>
  run !== undefined &&
  (run.status === "preparing" || run.status === "running") &&
  run.tasks.some((task) => task.type === type);

const canScan = (device: DeviceView | undefined, run: RunSnapshot | undefined): boolean => {
  if (!device) return false;
  if (device.status !== "online" && device.status !== "running") return false;
  return !(run && (run.status === "preparing" || run.status === "running"));
};

const RecruitmentPanel: Component<{ locale: Locale; data: RecruitmentData }> = (props) => {
  const [selected, setSelected] = createSignal<ReadonlyArray<string>>([]);
  const match = createMemo<RecruitmentMatch>(() => matchRecruitment(selected(), props.data.operators));
  const toggle = (tag: string): void => {
    setSelected((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      return current.length >= 5 ? current : [...current, tag];
    });
  };

  return (
    <div class="tool-panel">
      <div class="tool-panel-head">
        <div>
          <h2>{t(props.locale, "tools.recruitment")}</h2>
          <p>{t(props.locale, "tools.recruitmentHint")}</p>
        </div>
        <span class="panel-kicker">{selected().length}/5</span>
      </div>

      <div class="tool-section">
        <div class="tool-section-head">
          <span class="mono-label">{t(props.locale, "tools.tags")}</span>
          <Show when={selected().length > 0}>
            <button type="button" class="link-button" onClick={() => setSelected([])}>
              {t(props.locale, "tools.clearTags")}
            </button>
          </Show>
        </div>
        <div class="tag-grid">
          <For each={props.data.tags}>
            {(tag) => (
              <button
                type="button"
                class={selected().includes(tag.name) ? "chip chip--on" : "chip"}
                aria-pressed={selected().includes(tag.name) ? "true" : "false"}
                onClick={() => toggle(tag.name)}
              >
                {recruitmentTagLabel(tag.name, props.locale)}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show
        when={!match().empty}
        fallback={
          <div class="tool-empty">
            <Icon name="search" />
            <p>
              {selected().length === 0
                ? t(props.locale, "tools.recruitmentEmpty")
                : t(props.locale, "tools.recruitmentNoMatch")}
            </p>
          </div>
        }
      >
        <div class="recruit-summary">
          <div class="recruit-guarantee">
            <span>{t(props.locale, "tools.recruitmentGuaranteed")}</span>
            <strong class={match().guaranteedRarity >= 4 ? "rarity-badge rarity-badge--good" : "rarity-badge"}>
              {rarityLabel(match().guaranteedRarity)}
            </strong>
          </div>
          <div>
            <span>{t(props.locale, "tools.recruitmentTop")}</span>
            <strong>{rarityLabel(match().topRarity)}</strong>
          </div>
          <div>
            <span>{t(props.locale, "tools.recruitmentCandidates")}</span>
            <strong>{match().candidates.length}</strong>
          </div>
        </div>

        <Show when={match().guaranteedRarity > 0 && match().guaranteedRarity < 4}>
          <p class="tool-warning">
            <Icon name="alert-triangle" />
            {t(props.locale, "tools.recruitmentWarning")}
          </p>
        </Show>

        <div class="recruit-rarities">
          <For each={match().rarityCounts}>
            {(count) => (
              <span class="tag">
                {rarityLabel(count.rarity)} · {count.count}
              </span>
            )}
          </For>
        </div>

        <div class="recruit-list">
          <For each={match().candidates.slice(0, 48)}>
            {(operator: RecruitmentOperator) => (
              <div class="recruit-oper">
                <div>
                  <strong>{props.locale === "en-US" ? operator.nameEn : operator.name}</strong>
                  <span class="recruit-oper-alt">{props.locale === "en-US" ? operator.name : operator.nameEn}</span>
                </div>
                <span class={operator.rarity >= 4 ? "rarity-badge rarity-badge--good" : "rarity-badge"}>
                  {rarityLabel(operator.rarity)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const OperatorPanel: Component<{
  locale: Locale;
  device: DeviceView | undefined;
  run: RunSnapshot | undefined;
  entries: ReadonlyArray<OperBoxEntry> | undefined;
  onScan: () => void;
  onConnect: () => void;
}> = (props) => {
  const [query, setQuery] = createSignal("");
  const filtered = () =>
    (props.entries ?? []).filter((entry) => {
      const needle = query().trim().toLowerCase();
      if (needle === "") return true;
      return entry.name.toLowerCase().includes(needle) || entry.nameEn.toLowerCase().includes(needle);
    });
  const scanning = () => scanActive(props.run, "OperBox");

  return (
    <div class="tool-panel">
      <div class="tool-panel-head">
        <div>
          <h2>{t(props.locale, "tools.operators")}</h2>
          <p>{t(props.locale, "tools.scanHint")}</p>
        </div>
        <div class="tool-scan-actions">
          <Show when={props.entries}>
            {(entries) => (
              <span class="panel-kicker">
                {t(props.locale, "tools.owned")} · {entries().length}
              </span>
            )}
          </Show>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            disabled={!canScan(props.device, props.run) || scanning()}
            onClick={props.onScan}
          >
            <Icon name={scanning() ? "loader" : "scan-line"} class={scanning() ? "spin" : undefined} />
            {scanning() ? t(props.locale, "tools.scanning") : t(props.locale, "tools.scan")}
          </button>
        </div>
      </div>

      <Show
        when={props.device}
        fallback={
          <div class="tool-empty">
            <Icon name="smartphone" />
            <p>{t(props.locale, "tools.noDevice")}</p>
            <button type="button" class="btn btn--secondary btn--sm" onClick={props.onConnect}>
              {t(props.locale, "setup.connect")}
            </button>
          </div>
        }
      >
        <Show
          when={(props.entries?.length ?? 0) > 0}
          fallback={
            <div class="tool-empty">
              <Icon name="users" />
              <p>{t(props.locale, "tools.operatorEmpty")}</p>
            </div>
          }
        >
          <div class="tool-toolbar">
            <label class="field field--wide">
              <span class="field-label">{t(props.locale, "tools.operatorSearch")}</span>
              <input
                class="input"
                value={query()}
                placeholder={t(props.locale, "tools.operatorSearch")}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Show when={props.entries}>
              {(entries) => (
                <span class="panel-meta">
                  {entries()[0]?.name !== undefined
                    ? scanning()
                      ? t(props.locale, "tools.operatorsPartial")
                      : t(props.locale, "tools.operatorsDone")
                    : t(props.locale, "tools.neverScanned")}
                </span>
              )}
            </Show>
          </div>
          <div class="oper-grid">
            <For each={filtered()}>
              {(entry) => (
                <article class="oper-card">
                  <div class="oper-card-top">
                    <strong>{props.locale === "en-US" ? entry.nameEn : entry.name}</strong>
                    <span class={entry.rarity >= 4 ? "rarity-badge rarity-badge--good" : "rarity-badge"}>
                      {rarityLabel(entry.rarity)}
                    </span>
                  </div>
                  <span class="oper-card-alt">{props.locale === "en-US" ? entry.name : entry.nameEn}</span>
                  <div class="oper-card-meta">
                    <span>
                      {t(props.locale, "tools.elite")} {entry.elite ?? 0}
                    </span>
                    <span>
                      {t(props.locale, "tools.level")} {entry.level ?? "—"}
                    </span>
                    <span>
                      {t(props.locale, "tools.potential")} {entry.potential ?? "—"}
                    </span>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const DepotPanel: Component<{
  locale: Locale;
  device: DeviceView | undefined;
  run: RunSnapshot | undefined;
  items: ReadonlyArray<DepotItem> | undefined;
  onScan: () => void;
  onConnect: () => void;
}> = (props) => {
  const [query, setQuery] = createSignal("");
  const filtered = () =>
    (props.items ?? []).filter((item) => {
      const needle = query().trim().toLowerCase();
      if (needle === "") return true;
      return item.name.toLowerCase().includes(needle) || item.itemId.includes(needle);
    });
  const scanning = () => scanActive(props.run, "Depot");
  const totalKinds = () => props.items?.length ?? 0;

  return (
    <div class="tool-panel">
      <div class="tool-panel-head">
        <div>
          <h2>{t(props.locale, "tools.depot")}</h2>
          <p>{t(props.locale, "tools.scanHint")}</p>
        </div>
        <div class="tool-scan-actions">
          <Show when={props.items}>
            {(items) => (
              <span class="panel-kicker">
                {t(props.locale, "tools.items")} · {items().length}
              </span>
            )}
          </Show>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            disabled={!canScan(props.device, props.run) || scanning()}
            onClick={props.onScan}
          >
            <Icon name={scanning() ? "loader" : "scan-line"} class={scanning() ? "spin" : undefined} />
            {scanning() ? t(props.locale, "tools.scanning") : t(props.locale, "tools.scan")}
          </button>
        </div>
      </div>

      <Show
        when={props.device}
        fallback={
          <div class="tool-empty">
            <Icon name="smartphone" />
            <p>{t(props.locale, "tools.noDevice")}</p>
            <button type="button" class="btn btn--secondary btn--sm" onClick={props.onConnect}>
              {t(props.locale, "setup.connect")}
            </button>
          </div>
        }
      >
        <Show
          when={totalKinds() > 0}
          fallback={
            <div class="tool-empty">
              <Icon name="box" />
              <p>{t(props.locale, "tools.depotEmpty")}</p>
            </div>
          }
        >
          <div class="tool-toolbar">
            <label class="field field--wide">
              <span class="field-label">{t(props.locale, "tools.depotSearch")}</span>
              <input
                class="input"
                value={query()}
                placeholder={t(props.locale, "tools.depotSearch")}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <span class="panel-meta">
              {scanning() ? t(props.locale, "tools.depotPartial") : t(props.locale, "tools.depotDone")}
            </span>
          </div>
          <ul class="depot-list">
            <For each={filtered()}>
              {(item) => (
                <li class="depot-row">
                  <div class="depot-main">
                    <strong>{item.name}</strong>
                    <span class="mono-line">#{item.itemId}</span>
                  </div>
                  <span class="tag">{item.group}</span>
                  <span class="depot-count">
                    {t(props.locale, "tools.count")} <strong>{item.count}</strong>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
};

export const Tools: Component<ToolsProps> = (props) => {
  const [tab, setTab] = createSignal<ToolTab>("recruitment");
  const recruitment = createMemo(() => runEffect(command(COMMANDS.recruitmentData, undefined)));
  const toolSnapshot = () => (props.device ? props.data.tools[props.device.profile.id] : undefined);
  const statusLabel = (status: DeviceView["status"]): string => {
    switch (status) {
      case "online":
        return t(props.locale, "status.online");
      case "connecting":
        return t(props.locale, "status.connecting");
      case "running":
        return t(props.locale, "status.running");
      case "error":
        return t(props.locale, "status.error");
      default:
        return t(props.locale, "status.offline");
    }
  };

  return (
    <div class="page page--tools">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "tools.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "tools.subtitle")}</p>
        </div>
        <div class="page-actions">
          <Show when={props.device}>
            {(device) => (
              <button type="button" class="device-pill" onClick={props.onConnect}>
                <span>{device().profile.name}</span>
                <StatusPill status={device().status} label={statusLabel(device().status)} compact />
              </button>
            )}
          </Show>
        </div>
      </header>

      <div class="tool-tabs">
        <Segmented
          value={tab()}
          options={[
            { value: "recruitment", label: t(props.locale, "tools.recruitment") },
            { value: "operbox", label: t(props.locale, "tools.operators") },
            { value: "depot", label: t(props.locale, "tools.depot") },
          ]}
          onChange={setTab}
        />
      </div>

      <Show when={tab() === "recruitment"}>
        <Loading
          fallback={
            <div class="tool-empty">
              <Icon name="loader" class="spin" />
              <p>{t(props.locale, "tools.loading")}</p>
            </div>
          }
        >
          <Errored
            fallback={(error: unknown) => (
              <div class="tool-empty">
                <Icon name="alert-triangle" />
                <p>{t(props.locale, "tools.noCore")}</p>
                <span class="mono-line">{error instanceof Error ? error.message : String(error)}</span>
              </div>
            )}
          >
            <Show when={recruitment()}>{(data) => <RecruitmentPanel locale={props.locale} data={data()} />}</Show>
          </Errored>
        </Loading>
      </Show>

      <Show when={tab() === "operbox"}>
        <OperatorPanel
          locale={props.locale}
          device={props.device}
          run={props.run}
          entries={toolSnapshot()?.operbox?.entries}
          onScan={() => props.onScan("operbox")}
          onConnect={props.onConnect}
        />
      </Show>

      <Show when={tab() === "depot"}>
        <DepotPanel
          locale={props.locale}
          device={props.device}
          run={props.run}
          items={toolSnapshot()?.depot?.items}
          onScan={() => props.onScan("depot")}
          onConnect={props.onConnect}
        />
      </Show>
    </div>
  );
};
