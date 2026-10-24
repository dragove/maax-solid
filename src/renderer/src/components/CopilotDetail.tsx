import { For, Show, createEffect, createSignal, untrack, type Component } from "solid-js";
import { COMMANDS } from "../../../shared/ipc";
import type { CopilotDetail, CopilotGroup, CopilotItem, CopilotOperator, Locale } from "../../../shared/schemas";
import { command } from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { t } from "../i18n/i18n";

/** Operator chips shared by search results, the copilot tab and task cards. */
export const CopilotOperators: Component<{
  readonly operators: ReadonlyArray<CopilotOperator>;
  readonly locale: Locale;
}> = (props) => (
  <ul class="copilot-opers">
    <For each={props.operators}>
      {(oper) => (
        <li>
          <span class="copilot-oper-name">{oper.name}</span>
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
              {t(props.locale, "copilot.skill")} {oper.skill}
            </small>
          </Show>
          <Show when={(oper.module ?? 0) > 0}>
            <small>M{oper.module}</small>
          </Show>
        </li>
      )}
    </For>
  </ul>
);

/**
 * Alternative operator groups.
 *
 * MaaCore validates both `opers` (fixed operators) and `groups` (interchangeable
 * candidates); the tab used to show only the former, so a bad requirement inside
 * a group looked like it came from nowhere.
 */
export const CopilotGroups: Component<{
  readonly groups: ReadonlyArray<CopilotGroup>;
  readonly locale: Locale;
}> = (props) => (
  <Show when={props.groups.length > 0}>
    <div class="copilot-groups">
      <p class="copilot-detail-label">{t(props.locale, "browser.groups")}</p>
      <For each={props.groups}>
        {(group) => (
          <div class="copilot-group">
            <span class="copilot-group-name">{group.name || "—"}</span>
            <span class="copilot-group-hint">{t(props.locale, "browser.groupOneOf")}</span>
            <CopilotOperators operators={group.operators} locale={props.locale} />
          </div>
        )}
      </For>
    </div>
  </Show>
);

/** One assignment's notes, minimum core version and operator plan. */
export const CopilotDetailBody: Component<{
  readonly detail: CopilotDetail | null | undefined;
  readonly locale: Locale;
}> = (props) => (
  <Show when={props.detail}>
    {(detail) => (
      <div class="copilot-detail">
        <Show when={detail().details !== ""}>
          <p class="copilot-detail-notes">{detail().details}</p>
        </Show>
        <Show when={detail().minimumRequired !== ""}>
          <p class="copilot-detail-min">MaaCore {detail().minimumRequired}</p>
        </Show>
        <Show when={detail().operators.length > 0}>
          <p class="copilot-detail-label">{t(props.locale, "browser.fixedOperators")}</p>
          <CopilotOperators operators={detail().operators} locale={props.locale} />
        </Show>
        <CopilotGroups groups={detail().groups} locale={props.locale} />
      </div>
    )}
  </Show>
);

export interface CopilotDetails {
  /** `undefined` until the file has been read, `null` when it could not be. */
  readonly detail: (id: string) => CopilotDetail | null | undefined;
  readonly hasDetail: (id: string) => boolean;
  readonly isOpen: (id: string) => boolean;
  readonly toggle: (id: string) => void;
}

/**
 * Read the downloaded JSON behind each batch entry exactly once.
 *
 * A batch entry only stores the file path, so the notes, operator plan and
 * minimum core version have to come back from main. `enabled` lets the copilot
 * browser defer the reads until its dialog is open; the copilot tab and task
 * cards mount only while visible and can read immediately. A file without any
 * content simply never gets a `hasDetail` truthy answer, so no empty panel is
 * offered.
 */
export const createCopilotDetails = (
  items: () => ReadonlyArray<CopilotItem>,
  enabled: () => boolean = () => true,
): CopilotDetails => {
  const runtime = useAppRuntime();
  const [details, setDetails] = createSignal<Readonly<Record<string, CopilotDetail | null>>>({});
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set());
  // A plain set, not a signal: it only guards against a second request for the
  // same entry within and across effect runs.
  const requested = new Set<string>();

  createEffect(
    () => (enabled() ? items() : undefined),
    (list) => {
      if (list === undefined) return;
      const known = untrack(() => details());
      for (const entry of list) {
        if (entry.id in known || requested.has(entry.id)) continue;
        requested.add(entry.id);
        void runtime
          .runPromise(command(COMMANDS.readCopilotDetail, { filename: entry.filename }))
          .then((detail) => setDetails((current) => ({ ...current, [entry.id]: detail })))
          .catch(() => setDetails((current) => ({ ...current, [entry.id]: null })));
      }
    },
  );

  const detail = (id: string): CopilotDetail | null | undefined => details()[id];

  const hasDetail = (id: string): boolean => {
    const value = details()[id];
    return (
      value !== undefined &&
      value !== null &&
      (value.details !== "" || value.minimumRequired !== "" || value.operators.length > 0 || value.groups.length > 0)
    );
  };

  const isOpen = (id: string): boolean => open().has(id);

  const toggle = (id: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { detail, hasDetail, isOpen, toggle };
};
