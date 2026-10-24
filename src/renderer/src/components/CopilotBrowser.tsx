import { For, Show, createEffect, createSignal, onCleanup, untrack, type Component } from "solid-js";
import { copilotKindFromStageId } from "../../../shared/copilot-kind";
import { copilotEntryMode, copilotModeLabelKey, copilotModes, type CopilotMode } from "../../../shared/copilot-mode";
import type {
  CopilotGroup,
  CopilotItem,
  CopilotLevel,
  CopilotSearchItem,
  CopilotSearchResult,
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
  /** Download the assignment by id and append it with the requested difficulty. */
  readonly onAdd: (id: number, mode: CopilotMode) => Promise<boolean>;
  /** Drop one batch entry; the batch list in the panel behind the dialog owns it. */
  readonly onRemoveItem: (item: CopilotItem) => void;
}

const PAGE_SIZE = 12;
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

/**
 * Copilot browser.
 *
 * Every request goes through the main process, which serialises calls and
 * caches them, so this panel never spams the community API: searches happen on
 * an explicit action, and stage suggestions are debounced.
 */
export const CopilotBrowser: Component<CopilotBrowserProps> = (props) => {
  const runtime = useAppRuntime();
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
  // The summary entries read their downloaded JSON through the shared
  // controller, only while this dialog is open.
  const addedDetails = createCopilotDetails(
    () => props.added,
    () => props.open,
  );
  let suggestionTimer: number | undefined;
  let operatorTimer: number | undefined;
  let searched = false;

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

  const currentFilters = (): Filters => ({
    keyword: keyword(),
    stage: stage(),
    operator: operator(),
    uploaderId: uploaderId(),
    orderBy: orderBy(),
  });

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

  // First search runs when the dialog opens; afterwards only user actions do.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) {
        searched = false;
        return;
      }
      if (searched) return;
      searched = true;
      // The apply phase is not a tracking scope, so the initial filter snapshot
      // (and the `loading()` guard inside `search`) is an explicit untracked read.
      void untrack(() => search(1, currentFilters()));
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

  /** Batch entries of one PRTS assignment, whichever difficulty they carry. */
  const addedFor = (id: number): ReadonlyArray<CopilotItem> => props.added.filter((entry) => entry.copilotId === id);

  const isModeAdded = (item: CopilotSearchItem, mode: CopilotMode): boolean =>
    addedFor(item.id).some((entry) => (entry.kind ?? "normal") === "normal" && copilotEntryMode(entry) === mode);

  const isDetailOpen = (id: number): boolean => openDetails().has(id);

  const toggleDetail = (id: number): void => {
    setOpenDetails((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const entryLabel = (entry: CopilotItem): string => {
    switch (entry.kind) {
      case "sss":
        return t(props.locale, "copilot.kind.sss");
      case "paradox":
        return t(props.locale, "copilot.kind.paradox");
      default:
        return t(props.locale, copilotModeLabelKey(copilotEntryMode(entry) === "raid", entry.stage));
    }
  };

  const add = async (id: number, mode: CopilotMode): Promise<void> => {
    if (adding() !== null) return;
    const key = `${id}:${mode}`;
    setAdding(key);
    try {
      await props.onAdd(id, mode);
    } finally {
      setAdding(null);
    }
  };

  const removeEntries = (entries: ReadonlyArray<CopilotItem>): void => {
    for (const entry of entries) props.onRemoveItem(entry);
  };

  const toggleMode = (item: CopilotSearchItem, mode: CopilotMode): void => {
    if (!isModeAdded(item, mode)) {
      void add(item.id, mode);
      return;
    }
    removeEntries(
      addedFor(item.id).filter((entry) => (entry.kind ?? "normal") === "normal" && copilotEntryMode(entry) === mode),
    );
  };

  /** SSS and paradox files have one entry and no difficulty switch. */
  const toggleWithoutMode = (item: CopilotSearchItem): void => {
    const entries = addedFor(item.id);
    if (entries.length > 0) {
      removeEntries(entries);
      return;
    }
    void add(item.id, "normal");
  };

  return (
    <Modal
      open={props.open}
      title={t(props.locale, "browser.title")}
      description={t(props.locale, "browser.hint")}
      onClose={props.onClose}
      wide
    >
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
                return (
                  <li class="browser-batch-item">
                    <div class="browser-batch-row">
                      <span class={["copilot-mode", { "copilot-mode--raid": copilotEntryMode(entry()) === "raid" }]}>
                        {entryLabel(entry())}
                      </span>
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

      <Show when={error() !== ""}>
        <p class="browser-error">{error()}</p>
      </Show>

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
              const modes = kind === "normal" ? copilotModes(item.difficulty, item.stage) : [];
              const added = () => addedFor(item.id);
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
                        <Show when={added().length > 0}>
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
                      <Show
                        when={kind === "normal"}
                        fallback={
                          <Button
                            size="sm"
                            variant={added().length > 0 ? "ghost" : "secondary"}
                            disabled={adding() !== null}
                            title={added().length > 0 ? t(props.locale, "browser.removeAdded") : undefined}
                            onClick={() => toggleWithoutMode(item)}
                          >
                            <Icon name={added().length > 0 ? "check" : "plus"} />
                            {added().length > 0 ? t(props.locale, "browser.added") : t(props.locale, "browser.add")}
                          </Button>
                        }
                      >
                        <For each={modes}>
                          {(mode) => {
                            const key = `${item.id}:${mode}`;
                            const isAdded = () => isModeAdded(item, mode);
                            return (
                              <Button
                                size="sm"
                                variant={isAdded() ? "ghost" : "secondary"}
                                disabled={adding() !== null}
                                title={isAdded() ? t(props.locale, "browser.removeAdded") : undefined}
                                onClick={() => toggleMode(item, mode)}
                              >
                                <Icon name={adding() === key ? "loader" : isAdded() ? "check" : "plus"} />
                                {t(props.locale, copilotModeLabelKey(mode === "raid", item.stage))}
                              </Button>
                            );
                          }}
                        </For>
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
    </Modal>
  );
};
