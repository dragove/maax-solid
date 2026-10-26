import { For, Show, createEffect, createSignal, onCleanup, untrack, type Component } from "solid-js";
import { copilotKindFromStageId } from "../../../shared/copilot-kind";
import {
  copilotItemActive,
  copilotItemModes,
  copilotModeLabelKey,
  copilotModes,
  type CopilotMode,
} from "../../../shared/copilot-mode";
import type {
  CopilotGroup,
  CopilotItem,
  CopilotLevel,
  CopilotSearchItem,
  CopilotSearchResult,
  CopilotSet,
  CopilotSetSearchResult,
  Locale,
  OperatorEntry,
} from "../../../shared/schemas";
import { COMMANDS } from "../../../shared/ipc";
import { command } from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { t } from "../i18n/i18n";
import { CopilotDetailBody, CopilotGroups, CopilotOperators, createCopilotDetails } from "./CopilotDetail";
import { Button } from "./ui/Button";
import { Collapse } from "./ui/Collapse";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";

interface CopilotBrowserProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly onClose: () => void;
  /** The batch this browser adds to; rows read it so their state stays in sync. */
  readonly added: ReadonlyArray<CopilotItem>;
  /**
   * Check or uncheck one difficulty of one assignment. Checking downloads the
   * file when the row is not in the batch yet; resolves after the batch is saved.
   */
  readonly onToggleMode: (id: number, mode: CopilotMode, enabled: boolean) => Promise<boolean>;
  /** Download every assignment of a set and append the batch. */
  readonly onAddSet: (setId: number) => Promise<boolean>;
  /** Drop one batch entry; the batch list in the panel behind the dialog owns it. */
  readonly onRemoveItem: (item: CopilotItem) => void;
}

const PAGE_SIZE = 12;
const SET_PAGE_SIZE = 8;
const SUGGESTION_DEBOUNCE_MS = 400;

/**
 * Group names in the compact result row. The expanded detail lists the
 * candidates; here the icon and dashed pill are enough to distinguish a group
 * from a fixed operator without adding the word "组".
 */
const GroupNameChips: Component<{
  readonly groups: ReadonlyArray<CopilotGroup>;
  readonly locale: Locale;
}> = (props) => (
  <Show when={props.groups.length > 0}>
    <ul class="browser-group-names">
      <For each={props.groups}>
        {(group) => (
          <li class="browser-group-name" title={t(props.locale, "browser.groupOneOf")}>
            <Icon name="users" />
            <span>{group.name || "—"}</span>
          </li>
        )}
      </For>
    </ul>
  </Show>
);

type BrowserTab = "copilot" | "set";

/**
 * Copilot browser.
 *
 * Every request goes through the main process, which serialises calls and
 * caches them, so this panel never spams the community API: searches happen on
 * an explicit action, and stage suggestions are debounced.
 *
 * Two tabs share the panel: assignments, and the sets PRTS users curate. A set
 * only stores assignment ids, so expanding one asks the main process for the
 * summaries behind them, and adding it downloads every file.
 */
export const CopilotBrowser: Component<CopilotBrowserProps> = (props) => {
  const runtime = useAppRuntime();
  const [tab, setTab] = createSignal<BrowserTab>("copilot");
  const [keyword, setKeyword] = createSignal("");
  const [stage, setStage] = createSignal("");
  const [orderBy, setOrderBy] = createSignal<"hot" | "views" | "upload_time">("hot");
  const [uploaderId, setUploaderId] = createSignal("");
  const [operator, setOperator] = createSignal("");
  const [operatorQuery, setOperatorQuery] = createSignal("");
  const [operatorHits, setOperatorHits] = createSignal<ReadonlyArray<OperatorEntry>>([]);
  const [page, setPage] = createSignal(1);
  const [result, setResult] = createSignal<CopilotSearchResult>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  // Details are independent: comparing several assignments must not close the
  // one opened before them.
  const [openDetails, setOpenDetails] = createSignal<ReadonlySet<number>>(new Set());
  const [suggestions, setSuggestions] = createSignal<ReadonlyArray<CopilotLevel>>([]);
  const [adding, setAdding] = createSignal<string | null>(null);

  const [setQuery, applySetQuery] = createSignal("");
  const [setAuthorId, applySetAuthorId] = createSignal("");
  const [setAuthorLabel, applySetAuthorLabel] = createSignal("");
  const [setPageNumber, applySetPage] = createSignal(1);
  const [setMatches, applySetMatches] = createSignal<CopilotSetSearchResult>();
  const [setBusy, applySetBusy] = createSignal(false);
  const [setFailure, applySetFailure] = createSignal("");
  const [openSets, applyOpenSets] = createSignal<ReadonlySet<number>>(new Set());
  // Summaries are fetched once per set and kept while the dialog stays open.
  const [setSummaries, applySetSummaries] = createSignal<ReadonlyMap<number, ReadonlyArray<CopilotSearchItem>>>(
    new Map(),
  );
  const [readingSets, applyReadingSets] = createSignal<ReadonlySet<number>>(new Set());

  // The summary entries read their downloaded JSON through the shared
  // controller, only while this dialog is open.
  const addedDetails = createCopilotDetails(
    () => props.added,
    () => props.open,
  );
  let suggestionTimer: number | undefined;
  let operatorTimer: number | undefined;
  let searched = false;
  let setSearched = false;

  onCleanup(() => {
    if (suggestionTimer !== undefined) window.clearTimeout(suggestionTimer);
    if (operatorTimer !== undefined) window.clearTimeout(operatorTimer);
  });

  interface Filters {
    readonly keyword: string;
    readonly stage: string;
    readonly operator: string;
    readonly uploaderId: string;
    readonly orderBy: "hot" | "views" | "upload_time";
  }

  interface SetFilters {
    readonly keyword: string;
    readonly creatorId: string;
  }

  const currentFilters = (): Filters => ({
    keyword: keyword(),
    stage: stage(),
    operator: operator(),
    uploaderId: uploaderId(),
    orderBy: orderBy(),
  });

  const currentSetFilters = (): SetFilters => ({ keyword: setQuery(), creatorId: setAuthorId() });

  /**
   * Search with an explicit filter snapshot.
   *
   * Solid batches signal writes inside an event handler, so a signal read right
   * after `setX()` still yields the previous value. Handlers build the next
   * snapshot themselves and pass it here instead of re-reading state they just
   * changed — otherwise selecting a filter silently searches with the old one.
   */
  const search = async (nextPage: number, filters: Filters): Promise<void> => {
    if (loading()) return;
    setLoading(true);
    setError("");
    try {
      const value = await runtime.runPromise(
        command(COMMANDS.searchCopilot, {
          ...(filters.keyword.trim() === "" ? {} : { document: filters.keyword.trim() }),
          ...(filters.stage.trim() === "" ? {} : { stage: filters.stage.trim() }),
          ...(filters.uploaderId === "" ? {} : { uploaderId: filters.uploaderId }),
          ...(filters.operator === "" ? {} : { operator: filters.operator }),
          orderBy: filters.orderBy,
          desc: true,
          page: nextPage,
          limit: PAGE_SIZE,
        }),
      );
      setResult(value);
      setPage(nextPage);
      setOpenDetails(new Set<number>());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const searchSets = async (nextPage: number, filters: SetFilters): Promise<void> => {
    if (setBusy()) return;
    applySetBusy(true);
    applySetFailure("");
    try {
      const value = await runtime.runPromise(
        command(COMMANDS.searchCopilotSets, {
          ...(filters.keyword.trim() === "" ? {} : { keyword: filters.keyword.trim() }),
          ...(filters.creatorId === "" ? {} : { creatorId: filters.creatorId }),
          page: nextPage,
          limit: SET_PAGE_SIZE,
        }),
      );
      applySetMatches(value);
      applySetPage(nextPage);
      applyOpenSets(new Set<number>());
    } catch (cause) {
      applySetFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      applySetBusy(false);
    }
  };

  /** Apply a filter change, mirror it into the inputs, then search page 1. */
  const commit = (patch: Partial<Filters>, nextPage = 1): void => {
    const next = { ...currentFilters(), ...patch };
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    if (patch.stage !== undefined) setStage(patch.stage);
    if (patch.operator !== undefined) {
      setOperator(patch.operator);
      setOperatorQuery(patch.operator);
      setOperatorHits([]);
    }
    if (patch.uploaderId !== undefined) setUploaderId(patch.uploaderId);
    if (patch.orderBy !== undefined) setOrderBy(patch.orderBy);
    void search(nextPage, next);
  };

  const commitSet = (patch: Partial<SetFilters>, nextPage = 1): void => {
    const next = { ...currentSetFilters(), ...patch };
    if (patch.keyword !== undefined) applySetQuery(patch.keyword);
    if (patch.creatorId !== undefined) applySetAuthorId(patch.creatorId);
    void searchSets(nextPage, next);
  };

  // The first search of each tab runs when the dialog opens or the tab is
  // switched to; afterwards only user actions do.
  createEffect(
    () => (props.open ? tab() : "closed"),
    (state) => {
      if (state === "closed") {
        searched = false;
        setSearched = false;
        return;
      }
      if (state === "copilot" && !searched) {
        searched = true;
        // The apply phase is not a tracking scope, so the initial filter
        // snapshot (and the `loading()` guard inside `search`) is an explicit
        // untracked read.
        void untrack(() => search(1, currentFilters()));
      }
      if (state === "set" && !setSearched) {
        setSearched = true;
        void untrack(() => searchSets(1, currentSetFilters()));
      }
    },
  );

  const updateStage = (value: string): void => {
    setStage(value);
    if (suggestionTimer !== undefined) window.clearTimeout(suggestionTimer);
    if (value.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    suggestionTimer = window.setTimeout(() => {
      void runtime
        .runPromise(command(COMMANDS.searchCopilotLevels, { query: value.trim() }))
        .then((levels) => setSuggestions(levels))
        .catch(() => setSuggestions([]));
    }, SUGGESTION_DEBOUNCE_MS);
  };

  const updateOperatorQuery = (value: string): void => {
    setOperatorQuery(value);
    if (operatorTimer !== undefined) window.clearTimeout(operatorTimer);
    if (value.trim() === "") {
      setOperatorHits([]);
      return;
    }
    operatorTimer = window.setTimeout(() => {
      void runtime
        .runPromise(command(COMMANDS.searchOperators, { query: value.trim() }))
        .then((hits) => setOperatorHits(hits))
        .catch(() => setOperatorHits([]));
    }, SUGGESTION_DEBOUNCE_MS);
  };

  const stageLabel = (item: CopilotSearchItem): string => item.stageCode || item.stage || "—";

  /** The batch row of one PRTS assignment, whichever difficulties it carries. */
  const addedRow = (id: number): CopilotItem | undefined =>
    props.added.find((entry) => entry.copilotId === id && (entry.kind ?? "normal") === "normal");

  const addedKind = (id: number): CopilotItem | undefined => props.added.find((entry) => entry.copilotId === id);

  const isModeAdded = (id: number, mode: CopilotMode): boolean => {
    const row = addedRow(id);
    return row !== undefined && copilotItemModes(row)[mode];
  };

  const isDetailOpen = (id: number): boolean => openDetails().has(id);

  const toggleDetail = (id: number): void => {
    setOpenDetails((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMode = async (id: number, mode: CopilotMode): Promise<void> => {
    const key = `${id}:${mode}`;
    if (adding() !== null) return;
    setAdding(key);
    try {
      await props.onToggleMode(id, mode, !isModeAdded(id, mode));
    } finally {
      setAdding(null);
    }
  };

  /**
   * SSS and paradox files have one entry and no difficulty. Their add button
   * mirrors the normal rows: add when missing, drop the row when present.
   */
  const toggleKind = async (id: number): Promise<void> => {
    const entry = addedKind(id);
    if (entry !== undefined) {
      props.onRemoveItem(entry);
      return;
    }
    if (adding() !== null) return;
    setAdding(`${id}:normal`);
    try {
      await props.onToggleMode(id, "normal", true);
    } finally {
      setAdding(null);
    }
  };

  const addSet = async (set: CopilotSet): Promise<void> => {
    const key = `set:${set.id}`;
    if (adding() !== null) return;
    setAdding(key);
    try {
      await props.onAddSet(set.id);
    } finally {
      setAdding(null);
    }
  };

  const isSetOpen = (id: number): boolean => openSets().has(id);

  /**
   * A set only lists ids, so its assignment summaries are fetched on first
   * expand and then reused. One request per 50 ids, serialised by the client.
   */
  const loadSet = async (set: CopilotSet): Promise<void> => {
    if (setSummaries().has(set.id) || readingSets().has(set.id)) return;
    applyReadingSets((current) => new Set(current).add(set.id));
    try {
      const items = await runtime.runPromise(command(COMMANDS.copilotSetItems, { ids: set.copilotIds }));
      applySetSummaries((current) => new Map(current).set(set.id, items));
    } catch (cause) {
      applySetFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      applyReadingSets((current) => {
        const next = new Set(current);
        next.delete(set.id);
        return next;
      });
    }
  };

  const toggleSet = (set: CopilotSet): void => {
    const next = new Set(openSets());
    if (next.has(set.id)) next.delete(set.id);
    else {
      next.add(set.id);
      void loadSet(set);
    }
    applyOpenSets(next);
  };

  /** One button per difficulty the stage offers, showing whether it is queued. */
  const modeButtons = (item: CopilotSearchItem, modes: ReadonlyArray<CopilotMode>) => (
    <For each={modes}>
      {(mode) => {
        const key = `${item.id}:${mode}`;
        const isAdded = () => isModeAdded(item.id, mode);
        return (
          <Button
            size="sm"
            variant={isAdded() ? "ghost" : "secondary"}
            disabled={adding() !== null}
            title={isAdded() ? t(props.locale, "browser.removeMode") : undefined}
            onClick={() => void toggleMode(item.id, mode)}
          >
            <Icon name={adding() === key ? "loader" : isAdded() ? "check" : "plus"} />
            {t(props.locale, copilotModeLabelKey(mode === "raid", item.stage))}
          </Button>
        );
      }}
    </For>
  );

  const kindButton = (item: CopilotSearchItem) => {
    // Read the batch inside every accessor: the row is created once, so a
    // captured entry would keep saying "Add" after the file was added.
    const isAdded = (): boolean => addedKind(item.id) !== undefined;
    return (
      <Button
        size="sm"
        variant={isAdded() ? "ghost" : "secondary"}
        disabled={adding() !== null}
        title={isAdded() ? t(props.locale, "browser.removeAdded") : undefined}
        onClick={() => void toggleKind(item.id)}
      >
        <Icon name={adding() === `${item.id}:normal` ? "loader" : isAdded() ? "check" : "plus"} />
        {isAdded() ? t(props.locale, "browser.added") : t(props.locale, "browser.add")}
      </Button>
    );
  };

  const availableModes = (item: CopilotSearchItem): ReadonlyArray<CopilotMode> =>
    copilotModes(item.difficulty, item.stage, item.stageCode);

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case "sss":
        return t(props.locale, "copilot.kind.sss");
      case "paradox":
        return t(props.locale, "copilot.kind.paradox");
      default:
        return t(props.locale, "copilot.kind.normal");
    }
  };

  /** A compact row for the assignments inside an expanded set. */
  const setRow = (item: CopilotSearchItem) => {
    const kind = copilotKindFromStageId(item.stage);
    return (
      <li class="browser-set-row">
        <span class="browser-batch-title" title={item.title || item.stage}>
          {item.title || item.stage}
        </span>
        <span class="browser-code">{stageLabel(item)}</span>
        <Show when={kind === "normal"} fallback={<span class="copilot-kind">{kindLabel(kind)}</span>}>
          <span class="browser-actions">{modeButtons(item, availableModes(item))}</span>
        </Show>
        <Show when={kind !== "normal"}>
          <span class="browser-actions">{kindButton(item)}</span>
        </Show>
      </li>
    );
  };

  return (
    <Modal
      open={props.open}
      title={t(props.locale, "browser.title")}
      description={t(props.locale, "browser.hint")}
      onClose={props.onClose}
      wide
    >
      <div class="browser-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab() === "copilot" ? "true" : "false"}
          class={["browser-tab", { "browser-tab--active": tab() === "copilot" }]}
          onClick={() => setTab("copilot")}
        >
          <Icon name="swords" />
          {t(props.locale, "browser.tabCopilot")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab() === "set" ? "true" : "false"}
          class={["browser-tab", { "browser-tab--active": tab() === "set" }]}
          onClick={() => setTab("set")}
        >
          <Icon name="list-todo" />
          {t(props.locale, "browser.tabSet")}
        </button>
      </div>

      <Show when={tab() === "copilot"}>
        <div class="browser-search">
          <input
            class="input"
            placeholder={t(props.locale, "browser.keywordPlaceholder")}
            value={keyword()}
            onInput={(event) => setKeyword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit({ keyword: event.currentTarget.value });
            }}
          />
          <div class="browser-stage">
            <input
              class="input"
              placeholder={t(props.locale, "browser.stagePlaceholder")}
              value={stage()}
              onInput={(event) => updateStage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSuggestions([]);
                  commit({ stage: event.currentTarget.value });
                }
              }}
            />
            <Show when={suggestions().length > 0}>
              <ul class="browser-suggestions">
                <For each={suggestions()}>
                  {(level) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setSuggestions([]);
                          commit({ stage: level.code || level.stageId });
                        }}
                      >
                        <strong>{level.code || level.stageId}</strong>
                        <span>{level.name}</span>
                        <small>{level.category}</small>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <div class="browser-stage">
            <input
              class="input"
              placeholder={t(props.locale, "browser.operatorPlaceholder")}
              value={operatorQuery()}
              onInput={(event) => updateOperatorQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setOperatorHits([]);
                  commit({ operator: event.currentTarget.value });
                }
              }}
            />
            <Show when={operatorHits().length > 0}>
              <ul class="browser-suggestions">
                <For each={operatorHits()}>
                  {(oper) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          // The PRTS filter is keyed on the Chinese name.
                          commit({ operator: oper.name });
                        }}
                      >
                        <strong>{oper.name}</strong>
                        <span>{oper.nameEn}</span>
                        <small>
                          {oper.rarity}★ {oper.profession}
                        </small>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <select
            class="input browser-sort"
            value={orderBy()}
            onChange={(event) => commit({ orderBy: event.currentTarget.value as "hot" | "views" | "upload_time" })}
          >
            <option value="hot">{t(props.locale, "browser.sortHot")}</option>
            <option value="views">{t(props.locale, "browser.sortViews")}</option>
            <option value="upload_time">{t(props.locale, "browser.sortNew")}</option>
          </select>
          <Button variant="primary" disabled={loading()} onClick={() => commit({ keyword: keyword() })}>
            {loading() ? t(props.locale, "common.working") : t(props.locale, "browser.search")}
          </Button>
        </div>

        <Show when={uploaderId() !== "" || operator() !== ""}>
          <div class="browser-filters">
            <Show when={operator() !== ""}>
              <span class="browser-chip">
                {t(props.locale, "browser.operatorFilter")} {operator()}
                <button type="button" class="icon-button" onClick={() => commit({ operator: "" })}>
                  <Icon name="x" />
                </button>
              </span>
            </Show>
            <Show when={uploaderId() !== ""}>
              <span class="browser-chip">
                {t(props.locale, "browser.authorFilter")} #{uploaderId()}
                <button type="button" class="icon-button" onClick={() => commit({ uploaderId: "" })}>
                  <Icon name="x" />
                </button>
              </span>
            </Show>
          </div>
        </Show>
      </Show>

      <Show when={tab() === "set"}>
        <div class="browser-search">
          <input
            class="input"
            placeholder={t(props.locale, "browser.setPlaceholder")}
            value={setQuery()}
            onInput={(event) => applySetQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitSet({ keyword: event.currentTarget.value });
            }}
          />
          <Button variant="primary" disabled={setBusy()} onClick={() => commitSet({ keyword: setQuery() })}>
            {setBusy() ? t(props.locale, "common.working") : t(props.locale, "browser.search")}
          </Button>
        </div>
        <Show when={setAuthorId() !== ""}>
          <div class="browser-filters">
            <span class="browser-chip">
              {t(props.locale, "browser.authorFilter")} {setAuthorLabel() || `#${setAuthorId()}`}
              <button
                type="button"
                class="icon-button"
                onClick={() => {
                  applySetAuthorLabel("");
                  commitSet({ creatorId: "" });
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          </div>
        </Show>
      </Show>

      <Show when={props.added.length > 0}>
        <section class="browser-batch">
          <div class="browser-batch-head">
            <span class="field-label">{t(props.locale, "browser.batch")}</span>
            <span class="browser-batch-count">{props.added.length}</span>
          </div>
          <ul class="browser-batch-list">
            <For each={props.added} keyed={(entry) => entry.id}>
              {(entry) => {
                const detail = () => addedDetails.detail(entry().id);
                const modes = () => {
                  const selection = copilotItemModes(entry());
                  const checked: CopilotMode[] = [];
                  if (selection.normal) checked.push("normal");
                  if (selection.raid) checked.push("raid");
                  return checked;
                };
                return (
                  <li class="browser-batch-item">
                    <div class="browser-batch-row">
                      <Show
                        when={(entry().kind ?? "normal") === "normal"}
                        fallback={<span class="copilot-kind">{kindLabel(entry().kind ?? "normal")}</span>}
                      >
                        <For each={modes()}>
                          {(mode) => (
                            <span class={["copilot-mode", { "copilot-mode--raid": mode === "raid" }]}>
                              {t(props.locale, copilotModeLabelKey(mode === "raid", entry().stage))}
                            </span>
                          )}
                        </For>
                        <Show when={modes().length === 0}>
                          <span class="copilot-mode copilot-mode--skip">{t(props.locale, "copilotPage.skipped")}</span>
                        </Show>
                      </Show>
                      <span class="browser-batch-title" title={entry().stage}>
                        {entry().title || entry().stage || entry().filename}
                      </span>
                      <Show when={addedDetails.hasDetail(entry().id)}>
                        <Button size="sm" variant="ghost" onClick={() => addedDetails.toggle(entry().id)}>
                          {t(props.locale, "browser.detail")}
                        </Button>
                      </Show>
                      <button
                        type="button"
                        class="icon-button"
                        title={t(props.locale, "browser.removeAdded")}
                        onClick={() => props.onRemoveItem(entry())}
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                    <Collapse open={addedDetails.isOpen(entry().id)}>
                      {() => <CopilotDetailBody detail={detail()} locale={props.locale} />}
                    </Collapse>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={tab() === "copilot" && error() !== ""}>
        <p class="browser-error">{error()}</p>
      </Show>
      <Show when={tab() === "set" && setFailure() !== ""}>
        <p class="browser-error">{setFailure()}</p>
      </Show>

      <Show when={tab() === "copilot"}>
        <Show
          when={(result()?.items.length ?? 0) > 0}
          fallback={
            <p class="browser-empty">
              {loading() ? t(props.locale, "common.loading") : t(props.locale, "browser.empty")}
            </p>
          }
        >
          <div class="browser-meta">
            <span>
              {t(props.locale, "browser.total")} {result()?.total ?? 0}
            </span>
            <span>
              {t(props.locale, "browser.page")} {page()}
            </span>
          </div>
          <ul class="browser-list">
            <For each={result()?.items ?? []}>
              {(item) => {
                const kind = copilotKindFromStageId(item.stage);
                const modes = availableModes(item);
                const queued = (): boolean => {
                  const entry = addedKind(item.id);
                  return entry !== undefined && copilotItemActive(entry);
                };
                return (
                  <li class={["browser-item", { "browser-item--open": isDetailOpen(item.id) }]}>
                    <div class="browser-row">
                      <div class="browser-main">
                        <div class="browser-title">
                          <strong>{item.title || item.stage}</strong>
                          <span class="browser-code">{stageLabel(item)}</span>
                          <Show when={kind === "normal"}>
                            <For each={modes}>
                              {(mode) => (
                                <span class={["copilot-mode", { "copilot-mode--raid": mode === "raid" }]}>
                                  {t(props.locale, copilotModeLabelKey(mode === "raid", item.stage))}
                                </span>
                              )}
                            </For>
                          </Show>
                          <Show when={queued()}>
                            <span class="browser-added-badge">{t(props.locale, "browser.added")}</span>
                          </Show>
                        </div>
                        <div class="browser-sub">
                          <button
                            type="button"
                            class="browser-author"
                            onClick={() => commit({ uploaderId: item.uploaderId })}
                          >
                            {item.uploader || "—"}
                          </button>
                          <span>
                            {item.views} {t(props.locale, "browser.views")}
                          </span>
                          <span>★ {item.ratingLevel}</span>
                          <span>
                            {item.operators.length} {t(props.locale, "browser.opers")}
                          </span>
                        </div>
                      </div>
                      <div class="browser-actions">
                        <Button size="sm" variant="ghost" onClick={() => toggleDetail(item.id)}>
                          {t(props.locale, "browser.detail")}
                        </Button>
                        <Show when={kind === "normal"} fallback={kindButton(item)}>
                          {modeButtons(item, modes)}
                        </Show>
                      </div>
                    </div>
                    <Show when={item.operators.length > 0}>
                      <CopilotOperators operators={item.operators} locale={props.locale} />
                    </Show>
                    <GroupNameChips groups={item.groups} locale={props.locale} />
                    <Collapse open={isDetailOpen(item.id)}>
                      {() => (
                        <div class="browser-detail">
                          <Show when={item.details !== ""}>
                            <p class="copilot-detail-notes">{item.details}</p>
                          </Show>
                          <Show when={item.minimumRequired !== ""}>
                            <p class="copilot-detail-min">MaaCore {item.minimumRequired}</p>
                          </Show>
                          <CopilotGroups groups={item.groups} locale={props.locale} />
                        </div>
                      )}
                    </Collapse>
                  </li>
                );
              }}
            </For>
          </ul>
          <div class="browser-pager">
            <Button
              size="sm"
              variant="ghost"
              disabled={page() <= 1 || loading()}
              onClick={() => void search(page() - 1, currentFilters())}
            >
              {t(props.locale, "browser.prev")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading() || result()?.hasNext !== true}
              onClick={() => void search(page() + 1, currentFilters())}
            >
              {t(props.locale, "browser.next")}
            </Button>
          </div>
        </Show>
      </Show>

      <Show when={tab() === "set"}>
        <Show
          when={(setMatches()?.items.length ?? 0) > 0}
          fallback={
            <p class="browser-empty">
              {setBusy() ? t(props.locale, "common.loading") : t(props.locale, "browser.setEmpty")}
            </p>
          }
        >
          <div class="browser-meta">
            <span>
              {t(props.locale, "browser.total")} {setMatches()?.total ?? 0}
            </span>
            <span>
              {t(props.locale, "browser.page")} {setPageNumber()}
            </span>
          </div>
          <ul class="browser-list">
            <For each={setMatches()?.items ?? []}>
              {(set) => (
                <li class={["browser-item", "browser-set", { "browser-item--open": isSetOpen(set.id) }]}>
                  <div class="browser-row">
                    <div class="browser-main">
                      <div class="browser-title">
                        <strong>{set.name || `#${set.id}`}</strong>
                        <span class="browser-added-badge">
                          {set.copilotIds.length} {t(props.locale, "browser.setCount")}
                        </span>
                      </div>
                      <Show when={set.description.trim() !== ""}>
                        <p class="browser-set-desc">{set.description}</p>
                      </Show>
                      <div class="browser-sub">
                        <button
                          type="button"
                          class="browser-author"
                          onClick={() => {
                            applySetAuthorLabel(set.creator);
                            commitSet({ creatorId: set.creatorId });
                          }}
                        >
                          {set.creator || "—"}
                        </button>
                        <span>{set.updateTime.split("T")[0] ?? set.updateTime}</span>
                      </div>
                    </div>
                    <div class="browser-actions">
                      <Button size="sm" variant="ghost" onClick={() => toggleSet(set)}>
                        <Icon name={isSetOpen(set.id) ? "chevron-down" : "chevron-right"} />
                        {isSetOpen(set.id)
                          ? t(props.locale, "browser.setCollapse")
                          : t(props.locale, "browser.setExpand")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={adding() !== null || set.copilotIds.length === 0}
                        onClick={() => void addSet(set)}
                      >
                        <Icon name={adding() === `set:${set.id}` ? "loader" : "plus"} />
                        {t(props.locale, "browser.setAddAll")}
                      </Button>
                    </div>
                  </div>
                  <Collapse open={isSetOpen(set.id)}>
                    {() => (
                      <div class="browser-set-body">
                        <Show
                          when={setSummaries().has(set.id)}
                          fallback={<p class="browser-empty">{t(props.locale, "browser.setLoading")}</p>}
                        >
                          <ul class="browser-set-list">
                            <For each={setSummaries().get(set.id) ?? []}>{(item) => setRow(item)}</For>
                          </ul>
                          <Show when={(setSummaries().get(set.id)?.length ?? 0) < set.copilotIds.length}>
                            <p class="browser-empty">
                              {t(props.locale, "browser.setUnavailable")} ·{" "}
                              {set.copilotIds.length - (setSummaries().get(set.id)?.length ?? 0)}
                            </p>
                          </Show>
                        </Show>
                      </div>
                    )}
                  </Collapse>
                </li>
              )}
            </For>
          </ul>
          <div class="browser-pager">
            <Button
              size="sm"
              variant="ghost"
              disabled={setPageNumber() <= 1 || setBusy()}
              onClick={() => void searchSets(setPageNumber() - 1, currentSetFilters())}
            >
              {t(props.locale, "browser.prev")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={setBusy() || setMatches()?.hasNext !== true}
              onClick={() => void searchSets(setPageNumber() + 1, currentSetFilters())}
            >
              {t(props.locale, "browser.next")}
            </Button>
          </div>
        </Show>
      </Show>
    </Modal>
  );
};
