import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { COMMANDS } from "../../../shared/ipc";
import type { Locale, RoguelikeOperator } from "../../../shared/schemas";
import { ROGUELIKE_STARTING_OPERS, readStartingOpers, type StartingOper, type TaskField } from "../../../shared/tasks";
import { command } from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { pick, t } from "../i18n/i18n";
import { Chevron } from "./ui/Chevron";
import { Icon } from "./ui/Icon";
import { Switch } from "./ui/Switch";

const EMPTY_OPER: StartingOper = { name: "", useSupport: false };

/** A picker never needs to list more than a screenful; typing narrows it down. */
const LIST_LIMIT = 60;

interface OptionRow {
  readonly key: string;
  readonly label?: string;
  readonly oper?: RoguelikeOperator;
  readonly custom?: string;
  readonly index?: number;
}

interface StartingOperPickerProps {
  readonly field: TaskField;
  readonly params: Record<string, unknown>;
  readonly locale: Locale;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}

/**
 * The three starting-recruit positions.
 *
 * MaaCore takes an ordered `core_char_list` and cannot skip a position, so the
 * slots fill top-down. Each row expands into a searchable list of the core's
 * own operators: the theme's recommendations first (MAA's order, from
 * `recruitment.json`), then the rest by rarity. Avatars come from the resource
 * tree and only cover part of the catalogue, so every missing one falls back to
 * an initial badge. Free text stays allowed — the list is a recommendation, and
 * the core accepts any Chinese operator name.
 */
export const StartingOperPicker: Component<StartingOperPickerProps> = (props) => {
  const runtime = useAppRuntime();
  const [operators, setOperators] = createSignal<ReadonlyArray<RoguelikeOperator>>([]);
  const [avatars, setAvatars] = createSignal<Readonly<Record<string, string>>>({});
  const [slot, setSlot] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  // One catalogue per theme per mounted card; a plain map needs no reactivity.
  const catalogue = new Map<string, ReadonlyArray<RoguelikeOperator>>();
  const requestedAvatars = new Set<string>();
  let searchEl: HTMLInputElement | undefined;
  let menuEl: HTMLDivElement | undefined;
  let rootEl: HTMLDivElement | undefined;

  const theme = () =>
    typeof props.params.theme === "string" && props.params.theme !== "" ? props.params.theme : "Phantom";

  createEffect(theme, (value) => {
    const cached = catalogue.get(value);
    if (cached !== undefined) {
      setOperators(cached);
      return;
    }
    let stale = false;
    void runtime
      .runPromise(command(COMMANDS.roguelikeOperators, { theme: value }))
      .then((rows) => {
        catalogue.set(value, rows);
        if (!stale) setOperators(rows);
      })
      .catch(() => {
        if (!stale) setOperators([]);
      });
    return () => {
      stale = true;
    };
  });

  const stored = (): ReadonlyArray<StartingOper> => {
    const list = readStartingOpers(props.value);
    if (list.length > 0) return list;
    // A plan saved before the list existed keeps its single operator visible
    // until the form writes a list, which then replaces the legacy keys.
    const legacy = props.field.key === "core_char_list" ? props.params.core_char : "";
    return typeof legacy === "string" && legacy.trim() !== ""
      ? [{ name: legacy, useSupport: props.params.use_support === true }]
      : [];
  };

  const slots = (): ReadonlyArray<StartingOper> =>
    Array.from({ length: ROGUELIKE_STARTING_OPERS }, (_, index) => stored()[index] ?? EMPTY_OPER);

  const locked = (index: number): boolean => index > 0 && (slots()[index - 1]?.name.trim() ?? "") === "";

  const write = (index: number, patch: Partial<StartingOper>): void => {
    const next = slots().map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : { ...row }));
    if (patch.name !== undefined && patch.name.trim() === "") {
      // Recruits happen in order, so clearing a slot drops the later ones
      // instead of letting MaaCore shift an operator into an earlier position.
      for (let later = index + 1; later < next.length; later += 1) next[later] = { ...EMPTY_OPER };
    }
    const last = next.findLastIndex((row) => row.name.trim() !== "");
    props.onChange(last < 0 ? [] : next.slice(0, last + 1));
  };

  const visible = createMemo<ReadonlyArray<RoguelikeOperator>>(() => {
    const needle = query().trim().toLowerCase();
    const all = operators();
    const matched =
      needle === ""
        ? all
        : all.filter((oper) => oper.name.toLowerCase().includes(needle) || oper.nameEn.toLowerCase().includes(needle));
    return matched.slice(0, LIST_LIMIT);
  });
  const recommended = createMemo(() => visible().filter((oper) => oper.recommended));
  const others = createMemo(() => visible().filter((oper) => !oper.recommended));

  const byName = createMemo(() => {
    const map = new Map<string, RoguelikeOperator>();
    for (const oper of operators()) map.set(oper.name, oper);
    return map;
  });

  /** A name the catalogue does not have can still be sent: the core takes free text. */
  const custom = createMemo<string | undefined>(() => {
    const value = query().trim();
    return value !== "" && !visible().some((oper) => oper.name === value) ? value : undefined;
  });

  const target = createMemo<{ kind: "oper"; oper: RoguelikeOperator } | { kind: "custom"; name: string } | undefined>(
    () => {
      const list = [...recommended(), ...others()];
      const index = active();
      if (index < list.length) return { kind: "oper", oper: list[index]! };
      const name = custom();
      return name === undefined ? undefined : { kind: "custom", name };
    },
  );

  const avatarOf = (name: string): string | undefined => {
    const oper = byName().get(name.trim());
    return oper === undefined ? undefined : avatars()[oper.id];
  };

  const wantedAvatars = createMemo<ReadonlyArray<string>>(() => {
    const known = avatars();
    const ids = new Set<string>();
    for (const oper of visible()) ids.add(oper.id);
    for (const row of slots()) {
      const found = byName().get(row.name.trim());
      if (found !== undefined) ids.add(found.id);
    }
    return [...ids].filter((id) => known[id] === undefined && !requestedAvatars.has(id));
  });

  createEffect(
    () => wantedAvatars(),
    (ids) => {
      if (ids.length === 0) return;
      for (const id of ids) requestedAvatars.add(id);
      void runtime
        .runPromise(command(COMMANDS.operatorAvatars, { ids }))
        .then((rows) =>
          setAvatars((current) => ({
            ...current,
            ...Object.fromEntries(rows.map((row) => [row.id, row.dataUrl])),
          })),
        )
        // No avatar is a normal state: the badge stays.
        .catch(() => undefined);
    },
  );

  // Opening a slot starts from an empty search, and the field should already be
  // focused when it appears.
  createEffect(slot, (index) => {
    if (index === null) return;
    setQuery("");
    setActive(0);
    queueMicrotask(() => searchEl?.focus());
  });

  // Keyboard navigation must keep the highlighted row in view.
  createEffect(
    () => [slot(), active()] as const,
    ([index, activeIndex]) => {
      if (index === null) return;
      const node = menuEl?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
      node?.scrollIntoView({ block: "nearest" });
    },
  );

  const openSlot = (index: number): void => {
    if (locked(index)) return;
    setSlot((current) => (current === index ? null : index));
  };

  /**
   * Any press outside the field closes the panel, the same way a native
   * dropdown does. Capture phase: the press also has to close it when it lands
   * on something that stops propagation, and it runs before the click so the
   * panel never lingers for one frame after the task card scrolls or re-renders.
   */
  const closeOnOutside = (event: Event): void => {
    if (rootEl !== undefined && event.target instanceof Node && rootEl.contains(event.target)) return;
    setSlot(null);
  };

  createEffect(
    () => slot(),
    (index) => {
      if (index === null) return;
      document.addEventListener("pointerdown", closeOnOutside, true);
      return () => document.removeEventListener("pointerdown", closeOnOutside, true);
    },
  );

  // The effect above cleans up on every slot change, but an owner destroyed
  // while the panel is open must not leave the document listener behind.
  onCleanup(() => document.removeEventListener("pointerdown", closeOnOutside, true));

  const choose = (name: string): void => {
    const index = slot();
    const trimmed = name.trim();
    if (index === null || trimmed === "") return;
    const next = index + 1;
    const nextEmpty = next < ROGUELIKE_STARTING_OPERS && (slots()[next]?.name.trim() ?? "") === "";
    write(index, { name: trimmed });
    // Continue down the list: three positions are usually filled in one go.
    setSlot(nextEmpty ? next : null);
  };

  const onSearchKey = (event: KeyboardEvent): void => {
    const total = recommended().length + others().length + (custom() === undefined ? 0 : 1);
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setSlot(null);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActive((current) => Math.min(Math.max(total - 1, 0), current + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((current) => Math.max(0, current - 1));
        return;
      case "Enter": {
        event.preventDefault();
        const entry = target();
        if (entry === undefined) return;
        choose(entry.kind === "oper" ? entry.oper.name : entry.name);
        return;
      }
      default:
        return;
    }
  };

  /**
   * Group headers and options flattened into one keyed list. Rendering them
   * through separate per-group `<For>` callbacks would read `active()` and the
   * group lengths outside a tracking scope, which the framework reports as an
   * untracked read.
   */
  const rows = createMemo<ReadonlyArray<OptionRow>>(() => {
    const picked = recommended();
    const rest = others();
    const list: OptionRow[] = [];
    if (picked.length > 0) {
      list.push({ key: "group-recommended", label: t(props.locale, "tasks.operRecommended") });
    }
    picked.forEach((oper, position) => list.push({ key: `oper-${oper.id}`, oper, index: position }));
    if (rest.length > 0) list.push({ key: "group-all", label: t(props.locale, "tasks.operAll") });
    rest.forEach((oper, position) => list.push({ key: `oper-${oper.id}`, oper, index: picked.length + position }));
    const customName = custom();
    if (customName !== undefined) {
      list.push({ key: "custom", custom: customName, index: picked.length + rest.length });
    }
    return list;
  });

  return (
    <div
      class="field field--wide"
      title={props.field.description ? pick(props.locale, props.field.description) : undefined}
      ref={(element) => {
        rootEl = element;
      }}
    >
      <span class="field-label">{pick(props.locale, props.field.label)}</span>
      <div class="opers-list">
        <For each={slots()} keyed={false}>
          {(row, index) => (
            <>
              <div class="opers-row">
                <span class="opers-slot">{index + 1}</span>
                <button
                  type="button"
                  class={[
                    "opers-token",
                    { "opers-token--open": slot() === index, "opers-token--empty": row().name.trim() === "" },
                  ]}
                  disabled={locked(index)}
                  onClick={() => openSlot(index)}
                >
                  <Show
                    when={avatarOf(row().name)}
                    fallback={<span class="opers-badge">{row().name.trim().slice(0, 1)}</span>}
                  >
                    {(url) => <img class="opers-avatar" src={url()} alt="" draggable="false" />}
                  </Show>
                  <span class="opers-name">{row().name.trim() || t(props.locale, "tasks.operPick")}</span>
                  <Chevron open={slot() === index} class="opers-caret" />
                </button>
                <span class="opers-support">
                  <Switch
                    checked={row().useSupport}
                    onChange={(checked) => write(index, { useSupport: checked })}
                    disabled={locked(index) || row().name.trim() === ""}
                    label={t(props.locale, "tasks.operSupport")}
                  />
                  {t(props.locale, "tasks.operSupport")}
                </span>
                {/* The slot keeps its width when the row is empty, so every
                    token is the same size whether or not it can be cleared. */}
                <span class="opers-remove">
                  <Show when={row().name.trim() !== ""}>
                    <button
                      type="button"
                      class="icon-button"
                      title={t(props.locale, "common.remove")}
                      onClick={() => write(index, { name: "" })}
                    >
                      <Icon name="x" />
                    </button>
                  </Show>
                </span>
              </div>
              <Show when={slot() === index}>
                <div class="opers-menu">
                  <div class="opers-search">
                    <Icon name="search" class="opers-search-icon" />
                    <input
                      class="input oper-search-input"
                      ref={(element) => {
                        searchEl = element;
                      }}
                      value={query()}
                      placeholder={t(props.locale, "tasks.operSearch")}
                      autocomplete="off"
                      spellcheck={false}
                      onInput={(event) => {
                        setQuery(event.currentTarget.value);
                        setActive(0);
                      }}
                      onKeyDown={onSearchKey}
                    />
                  </div>
                  <div
                    class="opers-options"
                    role="listbox"
                    ref={(element) => {
                      menuEl = element;
                    }}
                  >
                    <For each={rows()} keyed={(row) => row.key}>
                      {(row) => (
                        <>
                          <Show when={row().label}>{(label) => <p class="opers-group">{label()}</p>}</Show>
                          <Show when={row().oper}>
                            {(oper) => (
                              <button
                                type="button"
                                class={["opers-option", { "opers-option--active": active() === row().index }]}
                                data-index={row().index}
                                role="option"
                                aria-selected={active() === row().index ? "true" : "false"}
                                onMouseEnter={() => setActive(row().index ?? 0)}
                                onClick={() => choose(oper().name)}
                              >
                                <Show
                                  when={avatars()[oper().id]}
                                  fallback={<span class="opers-badge">{oper().name.slice(0, 1)}</span>}
                                >
                                  {(url) => <img class="opers-avatar" src={url()} alt="" draggable="false" />}
                                </Show>
                                <span class="opers-option-name">{oper().name}</span>
                                <span class="opers-option-meta">{oper().rarity}★</span>
                                <Show when={oper().recommended}>
                                  <span class="opers-option-tag">{t(props.locale, "tasks.operRecommendedTag")}</span>
                                </Show>
                              </button>
                            )}
                          </Show>
                          <Show when={row().custom}>
                            {(name) => (
                              <button
                                type="button"
                                class={[
                                  "opers-option",
                                  "opers-option--custom",
                                  { "opers-option--active": active() === row().index },
                                ]}
                                data-index={row().index}
                                onClick={() => choose(name())}
                              >
                                <span class="opers-option-name">{t(props.locale, "tasks.operCustom")}</span>
                                <span class="opers-option-meta">「{name()}」</span>
                              </button>
                            )}
                          </Show>
                        </>
                      )}
                    </For>
                    <Show when={rows().length === 0}>
                      <p class="opers-empty">{t(props.locale, "tasks.operNoMatch")}</p>
                    </Show>
                  </div>
                </div>
              </Show>
            </>
          )}
        </For>
      </div>
    </div>
  );
};
