import { For, createSignal, type Component } from "solid-js";
import { prefersReducedMotion, toastExitMs } from "../../motion";
import { Icon } from "./Icon";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  readonly title: string;
  readonly message?: string;
  readonly kind?: ToastKind;
  readonly duration?: number;
}

interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly message?: string;
  remaining: number;
  startedAt: number;
  timer?: number;
}

const DEFAULT_DURATION = 4200;
const MAX_TOASTS = 4;

let items: ReadonlyArray<ToastItem> = [];
let nextId = 0;

const [toasts, setToasts] = createSignal(items);
/** Ids that are playing their exit animation and no longer accept input. */
const [leaving, setLeaving] = createSignal<ReadonlySet<number>>(new Set());
const leaveTimers = new Map<number, number>();

const iconFor = (kind: ToastKind): string => {
  switch (kind) {
    case "success":
      return "check";
    case "warning":
    case "error":
      return "alert-triangle";
    default:
      return "info";
  }
};

const clearTimer = (toast: ToastItem): void => {
  if (toast.timer === undefined) return;
  window.clearTimeout(toast.timer);
  toast.timer = undefined;
};

const remove = (id: number): void => {
  const leaveTimer = leaveTimers.get(id);
  if (leaveTimer !== undefined) {
    window.clearTimeout(leaveTimer);
    leaveTimers.delete(id);
  }
  const next = items.filter((item) => item.id !== id);
  if (next.length !== items.length) {
    items = next;
    setToasts(items);
  }
  setLeaving((current) => {
    if (!current.has(id)) return current;
    const updated = new Set(current);
    updated.delete(id);
    return updated;
  });
};

const dismiss = (id: number): void => {
  const toast = items.find((item) => item.id === id);
  if (!toast || leaveTimers.has(id)) return;
  clearTimer(toast);
  if (prefersReducedMotion()) {
    remove(id);
    return;
  }
  // Keep the row mounted for one short beat so it can animate out; Toaster owns
  // that timer, and the row is already inert.
  setLeaving((current) => new Set(current).add(id));
  leaveTimers.set(
    id,
    window.setTimeout(() => remove(id), toastExitMs),
  );
};

const start = (toast: ToastItem): void => {
  toast.startedAt = performance.now();
  toast.timer = window.setTimeout(() => dismiss(toast.id), toast.remaining);
};

const pause = (toast: ToastItem): void => {
  if (toast.timer === undefined) return;
  clearTimer(toast);
  toast.remaining = Math.max(1000, toast.remaining - (performance.now() - toast.startedAt));
};

const resume = (toast: ToastItem): void => {
  if (toast.timer !== undefined || !items.includes(toast) || leaving().has(toast.id)) return;
  start(toast);
};

export function notify(input: ToastInput): void {
  const toast: ToastItem = {
    id: ++nextId,
    kind: input.kind ?? "info",
    title: input.title,
    ...(input.message === undefined ? {} : { message: input.message }),
    remaining: input.duration ?? DEFAULT_DURATION,
    startedAt: 0,
  };

  items = [...items, toast];
  if (items.length > MAX_TOASTS) {
    const overflow = items.slice(0, items.length - MAX_TOASTS);
    for (const stale of overflow) clearTimer(stale);
    items = items.slice(overflow.length);
  }
  setToasts(items);
  start(toast);
}

export const Toaster: Component = () => (
  <div class="toast-region" role="region" aria-label="Notifications">
    <ol class="toast-list">
      <For each={toasts()}>
        {(toast) => (
          <li
            class={["toast", `toast--${toast.kind}`, { "toast--leaving": leaving().has(toast.id) }]}
            role={toast.kind === "error" ? "alert" : "status"}
            onPointerEnter={() => pause(toast)}
            onPointerLeave={() => resume(toast)}
          >
            <span class="toast-icon">
              <Icon name={iconFor(toast.kind)} />
            </span>
            <span class="toast-copy">
              <span class="toast-title">{toast.title}</span>
              {toast.message ? <span class="toast-message">{toast.message}</span> : null}
            </span>
            <button type="button" class="toast-close" aria-label="Close" onClick={() => dismiss(toast.id)}>
              <Icon name="x" />
            </button>
          </li>
        )}
      </For>
    </ol>
  </div>
);
