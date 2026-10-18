import type { Component } from "solid-js";

interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly label?: string;
}

export const Switch: Component<SwitchProps> = (props) => (
  <button
    type="button"
    class={props.checked ? "switch switch--on" : "switch"}
    role="switch"
    aria-checked={props.checked ? "true" : "false"}
    aria-label={props.label ?? "toggle"}
    disabled={props.disabled ?? false}
    onClick={(event) => {
      event.stopPropagation();
      props.onChange(!props.checked);
    }}
  >
    <span class="switch-thumb" />
  </button>
);
