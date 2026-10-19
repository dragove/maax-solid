import { For, Show, createSignal, untrack, type Component } from "solid-js";
import type { CopilotItem, Locale, RunTaskState, StageCatalogEntry, TaskConfig } from "../../../shared/schemas";
import type { FieldOption, TaskField } from "../../../shared/tasks";
import { TASK_DEFINITIONS } from "../../../shared/tasks";
import { pick, t } from "../i18n/i18n";
import { StagePicker } from "./StagePicker";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Switch } from "./ui/Switch";

interface TaskCardProps {
  readonly task: TaskConfig;
  readonly locale: Locale;
  readonly stages: ReadonlyArray<StageCatalogEntry>;
  readonly expanded: boolean;
  readonly runTask?: RunTaskState;
  readonly disabled?: boolean;
  readonly onToggleExpanded: () => void;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onParamChange: (key: string, value: unknown) => void;
  readonly onPickFile: (key: string) => void;
  readonly onResolveCopilot: (input: string) => Promise<boolean>;
  readonly onBrowseCopilot: () => void;
  readonly onRemove: () => void;
  readonly onDragStart: (event: DragEvent) => void;
  readonly onDragOver: (event: DragEvent) => void;
  readonly onDrop: (event: DragEvent) => void;
}

const summaryFor = (task: TaskConfig, locale: Locale): string => {
  const params = task.params;
  switch (task.type) {
    case "Fight": {
      const stage =
        typeof params.stage === "string" && params.stage.trim() !== ""
          ? params.stage
          : locale === "en-US"
            ? "Current stage"
            : "当前关卡";
      return stage;
    }
    case "Recruit": {
      const select = Array.isArray(params.select) ? params.select.join(" / ") : "";
      return select ? `${select}★` : "—";
    }
    case "Infrast": {
      const modes: Record<string, string> = {
        "0": locale === "en-US" ? "Auto shift" : "自动换班",
        "20000": locale === "en-US" ? "Rotation" : "一键轮换",
      };
      return modes[String(params.mode)] ?? "—";
    }
    case "Mall":
      return locale === "en-US" ? "Credits & shopping" : "信用与购物";
    case "Award":
      return locale === "en-US" ? "Daily collection" : "日常领取";
    case "StartUp":
      return params.start_game_enabled === false
        ? locale === "en-US"
          ? "Attach only"
          : "仅连接"
        : locale === "en-US"
          ? "Launch client"
          : "启动客户端";
    case "Copilot": {
      const batch = Array.isArray(params.copilot_list) ? params.copilot_list : [];
      if (batch.length > 0) {
        const first = batch[0] as { stage?: unknown };
        const stage = typeof first.stage === "string" ? first.stage : "";
        return locale === "en-US"
          ? `${batch.length} assignment(s)${stage ? ` · ${stage}` : ""}`
          : `${batch.length} 个作业${stage ? ` · ${stage}` : ""}`;
      }
      const name = typeof params.filename === "string" ? params.filename.split(/[\\/]/u).pop() : "";
      if (name) return name;
      return locale === "en-US" ? "No copilot file" : "未选择作业";
    }
    case "SSSCopilot":
    case "ParadoxCopilot": {
      const name = typeof params.filename === "string" ? params.filename.split(/[\\/]/u).pop() : "";
      if (name) return name;
      return locale === "en-US" ? "No copilot file" : "未选择作业";
    }
    case "Depot":
      return locale === "en-US" ? "Depot scan" : "仓库识别";
    case "OperBox":
      return locale === "en-US" ? "Operator box" : "干员识别";
    case "Custom": {
      const names = Array.isArray(params.task_names) ? params.task_names.join(", ") : "";
      return names || "—";
    }
    case "CloseDown":
      return locale === "en-US" ? "After queue" : "队列结束后";
  }
};

const optionValue = (option: FieldOption): string | number => option.value;

const sameOption = (left: string | number, right: string | number): boolean => String(left) === String(right);

const fileNameOf = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") return "";
  const parts = value.split(/[\\/]/u);
  return parts[parts.length - 1] ?? value;
};

const FieldControl: Component<{
  field: TaskField;
  locale: Locale;
  stages: ReadonlyArray<StageCatalogEntry>;
  value: unknown;
  onChange: (value: unknown) => void;
  onPickFile: () => void;
}> = (props) => {
  const label = () => pick(props.locale, props.field.label);
  const description = () => (props.field.description ? pick(props.locale, props.field.description) : undefined);

  // A task field keeps its kind for the row's lifetime, so the branch is picked
  // once; everything inside a branch still reads its props reactively.
  switch (untrack(() => props.field.kind)) {
    case "switch":
      return (
        <div class="field field--switch" title={description()}>
          <span class="field-label">{label()}</span>
          <Switch checked={props.value === true} onChange={props.onChange} label={label()} />
        </div>
      );
    case "number":
      return (
        <label class="field" title={description()}>
          <span class="field-label">{label()}</span>
          <input
            class="input input--number"
            type="number"
            min={props.field.min}
            max={props.field.max}
            step={props.field.step}
            value={typeof props.value === "number" ? props.value : 0}
            onInput={(event) => {
              const next = event.currentTarget.valueAsNumber;
              props.onChange(Number.isFinite(next) ? next : 0);
            }}
          />
        </label>
      );
    case "stage":
      return (
        <label class="field field--wide" title={description()}>
          <span class="field-label">{label()}</span>
          <StagePicker
            value={typeof props.value === "string" ? props.value : ""}
            stages={props.stages}
            locale={props.locale}
            placeholder={props.field.placeholder ? pick(props.locale, props.field.placeholder) : undefined}
            onChange={props.onChange}
          />
        </label>
      );
    case "text":
      return (
        <label class="field" title={description()}>
          <span class="field-label">{label()}</span>
          <input
            class="input"
            value={typeof props.value === "string" ? props.value : ""}
            placeholder={props.field.placeholder ? pick(props.locale, props.field.placeholder) : undefined}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </label>
      );
    case "select": {
      const options = () => props.field.options ?? [];
      const current = () =>
        typeof props.value === "string" || typeof props.value === "number" ? props.value : (options()[0]?.value ?? "");
      return (
        <label class="field" title={description()}>
          <span class="field-label">{label()}</span>
          <select
            class="input"
            value={String(current())}
            onChange={(event) => {
              const selected = options().find((option) => String(option.value) === event.currentTarget.value);
              props.onChange(selected ? optionValue(selected) : event.currentTarget.value);
            }}
          >
            <For each={options()}>
              {(option) => <option value={String(option.value)}>{pick(props.locale, option.label)}</option>}
            </For>
          </select>
        </label>
      );
    }
    case "multi-select": {
      const selected = (): Array<string | number> =>
        Array.isArray(props.value) ? (props.value as Array<string | number>) : [];
      const options = () => props.field.options ?? [];
      return (
        <div class="field field--wide" title={description()}>
          <span class="field-label">{label()}</span>
          <div class="chip-row">
            <For each={options()}>
              {(option) => {
                const on = () => selected().some((value) => sameOption(value, option.value));
                return (
                  <button
                    type="button"
                    class={on() ? "chip chip--on" : "chip"}
                    onClick={() =>
                      props.onChange(
                        on()
                          ? selected().filter((value) => !sameOption(value, option.value))
                          : [...selected(), option.value],
                      )
                    }
                  >
                    {pick(props.locale, option.label)}
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      );
    }
    case "file": {
      const name = () => fileNameOf(props.value);
      return (
        <div class="field field--wide" title={description()}>
          <span class="field-label">{label()}</span>
          <div class="file-field">
            <span class={name() === "" ? "file-name file-name--empty" : "file-name"}>
              {name() || (props.field.placeholder ? pick(props.locale, props.field.placeholder) : "—")}
            </span>
            <Button size="sm" variant="secondary" onClick={props.onPickFile}>
              {t(props.locale, "tasks.chooseFile")}
            </Button>
            <Show when={name() !== ""}>
              <button
                type="button"
                class="icon-button"
                title={t(props.locale, "common.remove")}
                onClick={() => props.onChange("")}
              >
                <Icon name="x" />
              </button>
            </Show>
          </div>
        </div>
      );
    }
    case "tags":
      return (
        <label class="field field--wide" title={description()}>
          <span class="field-label">{label()}</span>
          <input
            class="input"
            value={Array.isArray(props.value) ? props.value.join(", ") : ""}
            placeholder={props.field.placeholder ? pick(props.locale, props.field.placeholder) : undefined}
            onChange={(event) =>
              props.onChange(
                event.currentTarget.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter((item) => item !== ""),
              )
            }
          />
        </label>
      );
  }
};

const isCopilotItem = (value: unknown): value is CopilotItem => {
  const item = value as Partial<CopilotItem> | null;
  return (
    typeof item?.id === "string" &&
    typeof item.filename === "string" &&
    typeof item.isRaid === "boolean" &&
    typeof item.stage === "string"
  );
};

const CopilotBatch: Component<{
  items: ReadonlyArray<CopilotItem>;
  locale: Locale;
  disabled?: boolean;
  onAdd: (input: string) => Promise<boolean>;
  onBrowse: () => void;
  onRemove: (id: string) => void;
}> = (props) => {
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (): Promise<void> => {
    const value = input().trim();
    if (value === "" || busy()) return;
    setBusy(true);
    try {
      if (await props.onAdd(value)) setInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="copilot-batch">
      <div class="copilot-head">
        <span class="field-label">{t(props.locale, "copilot.list")}</span>
        <Button size="sm" variant="ghost" disabled={props.disabled === true} onClick={props.onBrowse}>
          <Icon name="search" />
          {t(props.locale, "copilot.browse")}
        </Button>
      </div>
      <div class="copilot-add">
        <input
          class="input"
          placeholder={t(props.locale, "copilot.addPlaceholder")}
          value={input()}
          disabled={props.disabled === true || busy()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={props.disabled === true || busy() || input().trim() === ""}
          onClick={() => void submit()}
        >
          {busy() ? t(props.locale, "common.working") : t(props.locale, "copilot.add")}
        </Button>
      </div>
      <Show
        when={props.items.length > 0}
        fallback={<span class="copilot-empty">{t(props.locale, "copilot.empty")}</span>}
      >
        <ul class="copilot-items">
          <For each={props.items}>
            {(item) => (
              <li class="copilot-item">
                <span class={item.isRaid ? "copilot-mode copilot-mode--raid" : "copilot-mode"}>
                  {t(props.locale, item.isRaid ? "copilot.raid" : "copilot.normal")}
                </span>
                <span class="copilot-title">{item.title || item.stage}</span>
                <span class="copilot-stage">{item.stage}</span>
                <button
                  type="button"
                  class="icon-button"
                  title={t(props.locale, "common.remove")}
                  disabled={props.disabled === true}
                  onClick={() => props.onRemove(item.id)}
                >
                  <Icon name="x" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

const statusLabel = (status: RunTaskState["status"], locale: Locale): string => {
  switch (status) {
    case "running":
      return t(locale, "tasks.running");
    case "completed":
      return t(locale, "tasks.completed");
    case "failed":
      return t(locale, "tasks.failed");
    case "stopped":
      return t(locale, "tasks.stopped");
    default:
      return t(locale, "tasks.pending");
  }
};

export const TaskCard: Component<TaskCardProps> = (props) => {
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const definition = () => TASK_DEFINITIONS[props.task.type];
  const applies = (field: TaskField): boolean => field.visibleWhen?.(props.task.params) ?? true;
  const basicFields = () => definition().fields.filter((field) => !field.advanced && applies(field));
  const advancedFields = () => definition().fields.filter((field) => field.advanced && applies(field));
  const copilotItems = (): ReadonlyArray<CopilotItem> => {
    const raw = props.task.params.copilot_list;
    return Array.isArray(raw) ? raw.filter(isCopilotItem) : [];
  };
  const removeCopilotItem = (id: string): void => {
    props.onParamChange(
      "copilot_list",
      copilotItems().filter((item) => item.id !== id),
    );
  };

  return (
    <article
      class={`task-card${!props.task.enabled ? " task-card--disabled" : ""}${props.expanded ? " task-card--expanded" : ""}${props.runTask?.status === "running" ? " task-card--running" : ""}`}
      draggable={!props.disabled ? "true" : "false"}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <header class="task-card-head" onClick={props.onToggleExpanded}>
        <span class="drag-handle" title={t(props.locale, "tasks.dragHint")}>
          <Icon name="grip-vertical" />
        </span>
        <span class="task-icon">
          <Icon name={definition().icon} />
        </span>
        <span class="task-heading">
          <span class="task-title-row">
            <span class="task-title">{props.task.name || pick(props.locale, definition().name)}</span>
            <Show when={props.runTask}>
              {(runTask) => (
                <span class={`task-state task-state--${runTask().status}`}>
                  {statusLabel(runTask().status, props.locale)}
                </span>
              )}
            </Show>
          </span>
          <span class="task-summary">{summaryFor(props.task, props.locale)}</span>
        </span>
        <span class="task-actions" onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={props.task.enabled}
            onChange={props.onEnabledChange}
            disabled={props.disabled}
            label={props.task.name || pick(props.locale, definition().name)}
          />
          <button
            type="button"
            class="icon-button"
            aria-label={t(props.locale, "tasks.deleteTask")}
            title={t(props.locale, "tasks.deleteTask")}
            onClick={props.onRemove}
          >
            <Icon name="trash-2" />
          </button>
          <button
            type="button"
            class="icon-button task-chevron"
            aria-label={props.expanded ? "collapse" : "expand"}
            onClick={props.onToggleExpanded}
          >
            <Icon name={props.expanded ? "chevron-down" : "chevron-right"} />
          </button>
        </span>
      </header>

      <Show when={props.expanded}>
        <div class="task-card-body">
          <Show when={props.task.type === "Copilot"}>
            <CopilotBatch
              items={copilotItems()}
              locale={props.locale}
              disabled={props.disabled}
              onAdd={(input) => props.onResolveCopilot(input)}
              onBrowse={props.onBrowseCopilot}
              onRemove={removeCopilotItem}
            />
          </Show>
          <div class="task-form-grid">
            <For each={basicFields()}>
              {(field) => (
                <FieldControl
                  field={field}
                  locale={props.locale}
                  stages={props.stages}
                  value={props.task.params[field.key]}
                  onChange={(value) => props.onParamChange(field.key, value)}
                  onPickFile={() => props.onPickFile(field.key)}
                />
              )}
            </For>
          </div>
          <Show when={advancedFields().length > 0}>
            <button type="button" class="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>
              <Icon name={showAdvanced() ? "chevron-down" : "chevron-right"} />
              {t(props.locale, "tasks.advanced")}
            </button>
            <Show when={showAdvanced()}>
              <div class="task-form-grid task-form-grid--advanced">
                <For each={advancedFields()}>
                  {(field) => (
                    <FieldControl
                      field={field}
                      locale={props.locale}
                      stages={props.stages}
                      value={props.task.params[field.key]}
                      onChange={(value) => props.onParamChange(field.key, value)}
                      onPickFile={() => props.onPickFile(field.key)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </article>
  );
};
