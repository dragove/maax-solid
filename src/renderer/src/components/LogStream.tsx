import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import type { Locale } from "../../../shared/schemas";
import { t, type MessageKey } from "../i18n/i18n";
import type { LogLevel, UiLogEntry } from "../log-format";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";

const BADGE: Record<LogLevel, MessageKey> = {
  debug: "log.badge.debug",
  info: "log.badge.info",
  success: "log.badge.success",
  warn: "log.badge.warn",
  error: "log.badge.error",
};

/** A row shows at most three lines, so anything longer needs the detail dialog. */
const isExpandable = (entry: UiLogEntry): boolean => entry.detail !== undefined || entry.message.includes("\n");

interface LogStreamProps {
  readonly entries: ReadonlyArray<UiLogEntry>;
  readonly locale: Locale;
  readonly empty: string;
}

/**
 * Scrolling run log. It follows the newest line until the user scrolls up, then
 * stops pulling the view back and offers an explicit jump-to-latest instead.
 */
export const LogStream: Component<LogStreamProps> = (props) => {
  const [follow, setFollow] = createSignal(true);
  const [selected, setSelected] = createSignal<UiLogEntry | null>(null);
  let stream: HTMLDivElement | undefined;

  const scrollToLatest = (): void => {
    if (stream) stream.scrollTop = stream.scrollHeight;
  };

  // Keyed on the last id, not the length: once the buffer is at its cap the
  // length stops changing while lines keep arriving. Folding `follow` into the
  // computation keeps the apply phase free of untracked reads, and re-arms the
  // jump when the user returns to follow mode.
  createEffect(
    () => (follow() ? (props.entries.at(-1)?.id ?? -1) : -1),
    (lastId) => {
      if (lastId === -1) return;
      queueMicrotask(scrollToLatest);
    },
  );

  return (
    <>
      <div class="log-body">
        <div
          class="log-stream"
          ref={(element) => {
            stream = element;
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
            setFollow(atBottom);
          }}
        >
          <Show when={props.entries.length > 0} fallback={<p class="muted log-empty">{props.empty}</p>}>
            <For each={props.entries}>
              {(entry) => (
                <div class={["log-line", `log-line--${entry.level}`]}>
                  <span class="log-time">{entry.time}</span>
                  <span class={["log-badge", `log-badge--${entry.level}`]}>{t(props.locale, BADGE[entry.level])}</span>
                  <span class="log-message">{entry.message}</span>
                  <Show when={isExpandable(entry)}>
                    <button
                      type="button"
                      class="log-expand"
                      title={t(props.locale, "tasks.logDetail")}
                      aria-label={t(props.locale, "tasks.logDetail")}
                      onClick={() => setSelected(entry)}
                    >
                      <Icon name="info" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <Show when={!follow() && props.entries.length > 0}>
          <button
            type="button"
            class="log-resume"
            title={t(props.locale, "tasks.logFollow")}
            aria-label={t(props.locale, "tasks.logFollow")}
            onClick={() => setFollow(true)}
          >
            <Icon name="chevron-down" />
          </button>
        </Show>
      </div>

      <Modal open={selected() !== null} title={t(props.locale, "tasks.logDetail")} onClose={() => setSelected(null)}>
        <Show when={selected()}>
          {(entry) => (
            <div class="log-detail">
              <div class="log-detail-head">
                <span class={["log-badge", `log-badge--${entry().level}`]}>
                  {t(props.locale, BADGE[entry().level])}
                </span>
                <span>{entry().time}</span>
              </div>
              <pre class="log-detail-body">{entry().message}</pre>
              <Show when={entry().detail}>{(detail) => <pre class="log-detail-body">{detail()}</pre>}</Show>
            </div>
          )}
        </Show>
      </Modal>
    </>
  );
};
