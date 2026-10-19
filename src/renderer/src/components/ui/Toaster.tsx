import { For, createSignal, type Component } from "solid-js";
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

const dismiss = (id: number): void => {
  const toast = items.find((item) => item.id === id);
  if (!toast) return;
  clearTimer(toast);
  items = items.filter((item) => item.id !== id);
  setToasts(items);
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
  if (toast.timer !== undefined || !items.includes(toast)) return;
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
            class={`toast toast--${toast.kind}`}
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
