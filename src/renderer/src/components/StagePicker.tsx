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
  const [query, setQuery] = createSignal<string | null>(null);
  let closeTimer: number | undefined;

  const groups = createMemo<ReadonlyArray<StageGroup>>(() => {
    const needle = (query() ?? "").trim().toLowerCase();
    const filtered = props.stages.filter((entry) => {
      if (needle === "") return true;
      return (
        entry.value.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle)
      );
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
          onFocus={() => {
            cancelClose();
            setQuery("");
            setOpen(true);
          }}
          onClick={() => {
            cancelClose();
            setQuery("");
            setOpen(true);
          }}
          onBlur={() => {
            setQuery(null);
            scheduleClose();
          }}
          onInput={(event) => {
            cancelClose();
            setQuery(event.currentTarget.value);
            setOpen(true);
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
            setOpen((value) => !value);
          }}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} />
        </button>
      </div>
      <Show when={open()}>
        <div class="stage-menu" role="listbox" onMouseDown={(event) => event.preventDefault()}>
          <Show
            when={groups().length > 0}
            fallback={<p class="stage-empty">{t(props.locale, "common.noData")}</p>}
          >
            <For each={groups()}>
              {(group) => (
                <div class="stage-group">
                  <p class="stage-group-label">{group.label}</p>
                  <For each={group.entries}>
                    {(entry) => (
                      <button
                        type="button"
                        class={
                          entry.value === props.value
                            ? "stage-option stage-option--active"
                            : "stage-option"
                        }
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
