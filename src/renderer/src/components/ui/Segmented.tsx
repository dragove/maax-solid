import { For } from "solid-js";
import type { JSX } from "@solidjs/web";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  readonly value: T;
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly onChange: (value: T) => void;
}

/**
 * Fluent 2 underline tabs (Pivot). The selection underline is drawn on the item
 * itself, so there is no highlight element to measure and nothing to resync
 * when a locale change rewrites the labels.
 */
export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <div class="segmented" role="tablist">
      <For each={props.options} keyed={false}>
        {(option) => (
          <button
            type="button"
            role="tab"
            class={["segmented-item", { "segmented-item--on": option().value === props.value }]}
            aria-selected={option().value === props.value ? "true" : "false"}
            onClick={() => props.onChange(option().value)}
          >
            <span class="segmented-label">{option().label}</span>
          </button>
        )}
      </For>
    </div>
  );
}
