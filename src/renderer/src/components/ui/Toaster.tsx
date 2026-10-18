import * as Toast from "@kobalte/core/toast";
import type { Component } from "solid-js";
import { Icon } from "./Icon";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  readonly title: string;
  readonly message?: string;
  readonly kind?: ToastKind;
  readonly duration?: number;
}

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

export function notify(input: ToastInput): void {
  const kind = input.kind ?? "info";
  Toast.toaster.show((props) => (
    <Toast.Root
      toastId={props.toastId}
      duration={input.duration ?? 4200}
      class={`toast toast--${kind}`}
    >
      <span class="toast-icon">
        <Icon name={iconFor(kind)} />
      </span>
      <span class="toast-copy">
        <Toast.Title class="toast-title">{input.title}</Toast.Title>
        {input.message ? (
          <Toast.Description class="toast-message">{input.message}</Toast.Description>
        ) : null}
      </span>
      <Toast.CloseButton class="toast-close" aria-label="Close">
        <Icon name="x" />
      </Toast.CloseButton>
    </Toast.Root>
  ));
}

export const Toaster: Component = () => (
  <Toast.Region duration={4200} limit={4} class="toast-region">
    <Toast.List class="toast-list" />
  </Toast.Region>
);
