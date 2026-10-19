import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import type { Locale, StageCatalogEntry } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Icon } from "./ui/Icon";

interface StagePickerProps {
  readonly value: string;
  readonly stages: ReadonlyArray<StageCatalogEntry>;
  readonly locale: Locale;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}

interface StageGroup {
  readonly label: string;
  readonly entries: StageCatalogEntry[];
}

export const StagePicker: Component<StagePickerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [dropUp, setDropUp] = createSignal(false);
  const [menuMax, setMenuMax] = createSignal(300);
  const [query, setQuery] = createSignal<string | null>(null);
  let inputEl: HTMLInputElement | undefined;
  let closeTimer: number | undefined;

  const groups = createMemo<ReadonlyArray<StageGroup>>(() => {
    const needle = (query() ?? "").trim().toLowerCase();
    const filtered = props.stages.filter((entry) => {
      if (needle === "") return true;
      return entry.value.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle);
    });
    const order = new Map<string, StageGroup>();
    for (const entry of filtered) {
      const existing = order.get(entry.groupLabel);
      if (existing) {
        existing.entries.push(entry);
      } else {
        order.set(entry.groupLabel, { label: entry.groupLabel, entries: [entry] });
      }
    }
    return [...order.values()];
  });

  const scheduleClose = (): void => {
    closeTimer = window.setTimeout(() => setOpen(false), 120);
  };

  const cancelClose = (): void => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  // Measure against the scrolling list so the menu cannot be clipped by it.
  const boundaryOf = (element: HTMLElement): { top: number; bottom: number } => {
    let node = element.parentElement;
    while (node) {
      if (/(auto|scroll)/u.test(getComputedStyle(node).overflowY)) {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }
      node = node.parentElement;
    }
    return { top: 0, bottom: window.innerHeight };
  };

  const openMenu = (): void => {
    if (inputEl) {
      const rect = inputEl.getBoundingClientRect();
      const boundary = boundaryOf(inputEl);
      const below = boundary.bottom - rect.bottom - 8;
      const above = rect.top - boundary.top - 8;
      const up = below < 320 && above > below;
      setDropUp(up);
      setMenuMax(Math.max(160, Math.min(300, up ? above : below)));
    }
    setOpen(true);
  };

  const select = (value: string): void => {
    cancelClose();
    setQuery(null);
    props.onChange(value);
    setOpen(false);
  };

  return (
    <div class="stage-picker">
      <div class="stage-input-wrap">
        <Icon name="search" class="stage-search-icon" />
        <input
          class="input stage-input"
          value={props.value}
          placeholder={props.placeholder}
          autocomplete="off"
          spellcheck={false}
          ref={(element) => {
            inputEl = element;
          }}
          onFocus={() => {
            cancelClose();
            setQuery("");
            openMenu();
          }}
          onClick={() => {
            cancelClose();
            setQuery("");
            openMenu();
          }}
          onBlur={() => {
            setQuery(null);
            scheduleClose();
          }}
          onInput={(event) => {
            cancelClose();
            setQuery(event.currentTarget.value);
            openMenu();
            props.onChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && groups()[0]?.entries[0]) {
              event.preventDefault();
              select(groups()[0]!.entries[0]!.value);
            }
          }}
        />
        <button
          type="button"
          class="stage-chevron"
          aria-label={t(props.locale, "tasks.stage")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            cancelClose();
            setQuery("");
            if (open()) setOpen(false);
            else openMenu();
          }}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} />
        </button>
      </div>
      <Show when={open()}>
        <div
          class={dropUp() ? "stage-menu stage-menu--up" : "stage-menu"}
          style={{ "max-height": `${menuMax()}px` }}
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Show when={groups().length > 0} fallback={<p class="stage-empty">{t(props.locale, "common.noData")}</p>}>
            <For each={groups()}>
              {(group) => (
                <div class="stage-group">
                  <p class="stage-group-label">{group.label}</p>
                  <For each={group.entries}>
                    {(entry) => (
                      <button
                        type="button"
                        class={entry.value === props.value ? "stage-option stage-option--active" : "stage-option"}
                        role="option"
                        aria-selected={entry.value === props.value ? "true" : "false"}
                        onClick={() => select(entry.value)}
                      >
                        <span class="stage-option-label">{entry.label}</span>
                        <Show when={entry.label !== entry.value && entry.value !== ""}>
                          <span class="stage-option-value">{entry.value}</span>
                        </Show>
                        <Show when={entry.tip}>
                          <span class="stage-option-tip">{entry.tip}</span>
                        </Show>
                        <Show when={entry.value === props.value}>
                          <Icon name="check" class="stage-option-check" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
};
