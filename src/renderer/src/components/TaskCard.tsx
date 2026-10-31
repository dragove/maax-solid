import { For, Show, createSignal, untrack, type Component } from "solid-js";
import type {
  CopilotItem,
  Locale,
  RunTaskState,
  StageCatalogEntry,
  TaskConfig,
  TaskType,
} from "../../../shared/schemas";
import {
  copilotItemActive,
  copilotItemModes,
  copilotModeLabelKey,
  readCopilotBatch,
} from "../../../shared/copilot-mode";
import type { FieldOption, TaskField } from "../../../shared/tasks";
import { TASK_DEFINITIONS, fieldOptions } from "../../../shared/tasks";
import { pick, t } from "../i18n/i18n";
import { CopilotDetailBody, createCopilotDetails } from "./CopilotDetail";
import { StartingOperPicker } from "./OperPicker";
import { StagePicker } from "./StagePicker";
import { Button } from "./ui/Button";
import { Collapse } from "./ui/Collapse";
import { Chevron } from "./ui/Chevron";
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

const fieldOptionLabel = (
  type: TaskType,
  key: string,
  value: unknown,
  params: Record<string, unknown>,
  locale: Locale,
): string => {
  const field = TASK_DEFINITIONS[type].fields.find((item) => item.key === key);
  const option = field ? fieldOptions(field, params).find((item) => String(item.value) === String(value)) : undefined;
  return option ? pick(locale, option.label) : "";
};

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
    case "Roguelike": {
      const theme = fieldOptionLabel("Roguelike", "theme", params.theme, params, locale);
      const mode = fieldOptionLabel("Roguelike", "mode", params.mode, params, locale);
      return [theme, mode].filter((part) => part !== "").join(" · ") || "—";
    }
    case "Reclamation": {
      const theme = fieldOptionLabel("Reclamation", "theme", params.theme, params, locale);
      const mode = fieldOptionLabel("Reclamation", "mode", params.mode, params, locale);
      return [theme, mode].filter((part) => part !== "").join(" · ") || "—";
    }
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
    case "SingleStep": {
      const step = fieldOptionLabel("SingleStep", "subtask", params.subtask, params, locale);
      const detail = params.subtask === "stage" ? params.stage : params.name;
      return typeof detail === "string" && detail.trim() !== "" ? `${step} · ${detail}` : step || "—";
    }
    case "VideoRecognition": {
      const name = fileNameOf(params.filename);
      return name || (locale === "en-US" ? "No video" : "未选择视频");
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
  params: Record<string, unknown>;
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
      const options = () => fieldOptions(props.field, props.params);
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
              {(option) => (
                <option value={String(option.value)} selected={String(option.value) === String(current())}>
                  {pick(props.locale, option.label)}
                </option>
              )}
            </For>
          </select>
        </label>
      );
    }
    case "multi-select": {
      const selected = (): Array<string | number> =>
        Array.isArray(props.value) ? (props.value as Array<string | number>) : [];
      const options = () => fieldOptions(props.field, props.params);
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
                    class={["chip", { "chip--on": on() }]}
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
    case "opers":
      return (
        <StartingOperPicker
          field={props.field}
          params={props.params}
          locale={props.locale}
          value={props.value}
          onChange={props.onChange}
        />
      );
    case "file": {
      const name = () => fileNameOf(props.value);
      return (
        <div class="field field--wide" title={description()}>
          <span class="field-label">{label()}</span>
          <div class="file-field">
            <span class={["file-name", { "file-name--empty": name() === "" }]}>
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
  // The card is mounted while it is expanded; each entry reads its downloaded
  // JSON once so the same detail panel as the browser is available here too.
  const details = createCopilotDetails(() => props.items);
  const modesOf = (item: CopilotItem): ReadonlyArray<"normal" | "raid"> => {
    const modes = copilotItemModes(item);
    return [...(modes.normal ? (["normal"] as const) : []), ...(modes.raid ? (["raid"] as const) : [])];
  };

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
          {/* Keyed by entry id: the batch is rewritten through IPC on every add/remove,
              and an identity key would replay the row entrance animation. */}
          <For each={props.items} keyed={(item) => item.id}>
            {(item) => (
              <li class="copilot-item">
                <div class="copilot-item-row">
                  <Show
                    when={(item().kind ?? "normal") === "normal"}
                    fallback={
                      <span class={["copilot-kind", `copilot-kind--${item().kind}`]}>
                        {t(props.locale, item().kind === "sss" ? "copilot.kind.sss" : "copilot.kind.paradox")}
                      </span>
                    }
                  >
                    <For each={modesOf(item())}>
                      {(mode) => (
                        <span class={["copilot-mode", { "copilot-mode--raid": mode === "raid" }]}>
                          {t(props.locale, copilotModeLabelKey(mode === "raid", item().stage))}
                        </span>
                      )}
                    </For>
                    <Show when={!copilotItemActive(item())}>
                      <span class="copilot-mode copilot-mode--skip">{t(props.locale, "copilotPage.skipped")}</span>
                    </Show>
                  </Show>
                  <span class="copilot-title">{item().title || item().stage}</span>
                  <span class="copilot-stage">{item().stage}</span>
                  <Show when={details.hasDetail(item().id)}>
                    <Button size="sm" variant="ghost" onClick={() => details.toggle(item().id)}>
                      {t(props.locale, "browser.detail")}
                    </Button>
                  </Show>
                  <button
                    type="button"
                    class="icon-button"
                    title={t(props.locale, "common.remove")}
                    disabled={props.disabled === true}
                    onClick={() => props.onRemove(item().id)}
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
  const copilotItems = (): ReadonlyArray<CopilotItem> => readCopilotBatch(props.task.params.copilot_list);
  const removeCopilotItem = (id: string): void => {
    props.onParamChange(
      "copilot_list",
      copilotItems().filter((item) => item.id !== id),
    );
  };

  return (
    <article
      class={[
        "task-card",
        {
          "task-card--disabled": !props.task.enabled,
          "task-card--expanded": props.expanded,
          "task-card--running": props.runTask?.status === "running",
        },
      ]}
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
            <Chevron open={props.expanded} />
          </button>
        </span>
      </header>

      <Collapse open={props.expanded}>
        {() => (
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
                    params={props.task.params}
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
                <Chevron open={showAdvanced()} />
                {t(props.locale, "tasks.advanced")}
              </button>
              <Collapse open={showAdvanced()}>
                {() => (
                  <div class="task-form-grid task-form-grid--advanced">
                    <For each={advancedFields()}>
                      {(field) => (
                        <FieldControl
                          field={field}
                          params={props.task.params}
                          locale={props.locale}
                          stages={props.stages}
                          value={props.task.params[field.key]}
                          onChange={(value) => props.onParamChange(field.key, value)}
                          onPickFile={() => props.onPickFile(field.key)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </Collapse>
            </Show>
          </div>
        )}
      </Collapse>
    </article>
  );
};
