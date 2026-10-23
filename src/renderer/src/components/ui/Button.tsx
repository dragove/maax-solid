import type { Component } from "solid-js";
import type { JSX } from "@solidjs/web";

interface ButtonProps {
  readonly children?: JSX.Element;
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
  readonly class?: string;
  readonly title?: string;
  readonly onClick?: (event: MouseEvent) => void;
}

export const Button: Component<ButtonProps> = (props) => (
  <button
    type={props.type ?? "button"}
    class={["btn", `btn--${props.variant ?? "secondary"}`, `btn--${props.size ?? "md"}`, props.class]}
    disabled={props.disabled}
    title={props.title}
    onClick={props.onClick}
  >
    {props.children}
  </button>
);
