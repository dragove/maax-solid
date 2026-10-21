import { For, Show, createEffect, createSignal, onCleanup, type Component } from "solid-js";
import type {
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
import { Button } from "./ui/Button";
import { Collapse } from "./ui/Collapse";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";

interface CopilotBrowserProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly onClose: () => void;
  /** Download the assignment by id and append it to the batch. */
  readonly onAdd: (id: number) => Promise<boolean>;
}

const PAGE_SIZE = 12;
const SUGGESTION_DEBOUNCE_MS = 400;

const modesOf = (difficulty: number): ReadonlyArray<"normal" | "raid"> => {
  if (difficulty === 0) return ["normal"];
  const modes: Array<"normal" | "raid"> = [];
  if ((difficulty & 1) !== 0) modes.push("normal");
  if ((difficulty & 2) !== 0) modes.push("raid");
  return modes.length === 0 ? ["normal"] : modes;
};

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
  const [detailId, setDetailId] = createSignal<number | null>(null);
  const [suggestions, setSuggestions] = createSignal<ReadonlyArray<CopilotLevel>>([]);
  const [adding, setAdding] = createSignal<number | null>(null);
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
      setDetailId(null);
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
      void search(1, currentFilters());
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

  const add = async (item: CopilotSearchItem): Promise<void> => {
    setAdding(item.id);
    try {
      await props.onAdd(item.id);
    } finally {
      setAdding(null);
    }
  };

  const stageLabel = (item: CopilotSearchItem): string => item.stageCode || item.stage || "—";

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
            {(item) => (
              <li class={detailId() === item.id ? "browser-item browser-item--open" : "browser-item"}>
                <div class="browser-row">
                  <div class="browser-main">
                    <div class="browser-title">
                      <strong>{item.title || item.stage}</strong>
                      <span class="browser-code">{stageLabel(item)}</span>
                      <For each={modesOf(item.difficulty)}>
                        {(mode) => (
                          <span class={mode === "raid" ? "copilot-mode copilot-mode--raid" : "copilot-mode"}>
                            {t(props.locale, mode === "raid" ? "copilot.raid" : "copilot.normal")}
                          </span>
                        )}
                      </For>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDetailId(detailId() === item.id ? null : item.id)}
                    >
                      {t(props.locale, "browser.detail")}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={adding() !== null} onClick={() => void add(item)}>
                      <Icon name="plus" />
                      {t(props.locale, "browser.add")}
                    </Button>
                  </div>
                </div>
                <Collapse open={detailId() === item.id}>
                  {() => (
                    <div class="browser-detail">
                      <Show when={item.details !== ""}>
                        <p class="browser-details">{item.details}</p>
                      </Show>
                      <Show when={item.minimumRequired !== ""}>
                        <p class="browser-min">MaaCore {item.minimumRequired}</p>
                      </Show>
                      <ul class="browser-opers">
                        <For each={item.operators}>
                          {(oper) => (
                            <li>
                              <span class="browser-oper-name">{oper.name}</span>
                              <Show when={oper.role !== ""}>
                                <small>{oper.role}</small>
                              </Show>
                              <Show when={oper.elite !== undefined}>
                                <small>
                                  E{oper.elite} {oper.level ?? ""}
                                </small>
                              </Show>
                              <Show when={oper.skill !== 0}>
                                <small>
                                  {t(props.locale, "browser.skill")} {oper.skill}
                                </small>
                              </Show>
                              <Show when={(oper.module ?? 0) > 0}>
                                <small>M{oper.module}</small>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
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
