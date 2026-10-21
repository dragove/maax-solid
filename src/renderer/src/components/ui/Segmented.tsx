import { For, createEffect, createSignal, onCleanup } from "solid-js";
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
 * Segmented control with a sliding selection highlight.
 *
 * The highlight is a real element rather than a background on each button, so
 * the selection travels between options instead of blinking from one to the
 * other. Its position is measured from the buttons because labels change width
 * with the locale.
 */
export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  let root: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;
  const [placement, setPlacement] = createSignal({ x: 0, y: 0, width: 0, height: 0, ready: false });

  const measure = (): void => {
    if (!root) return;
    const active = root.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!active) return;
    // Measured from border boxes so the highlight lands on the button itself
    // regardless of the container's padding and border.
    const box = root.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    const next = {
      x: rect.left - box.left,
      y: rect.top - box.top,
      width: rect.width,
      height: rect.height,
      ready: true,
    };
    // The ResizeObserver fires on our own highlight update too; keep the same
    // object when nothing moved so the signal does not re-render.
    setPlacement((prev) =>
      prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  };

  // Tracked: the active value and the labels. The apply phase measures the DOM
  // that the flush above has already committed.
  createEffect(
    () => [props.value, props.options.map((option) => option.label).join("|")] as const,
    () => {
      measure();
    },
  );

  onCleanup(() => {
    observer?.disconnect();
  });

  return (
    <div
      class="segmented"
      ref={(element) => {
        root = element;
        // A locale change rewrites every label, and the variable font can land
        // after the first paint; both resize the buttons.
        observer = new ResizeObserver(() => measure());
        observer.observe(element);
      }}
    >
      <span
        class="segmented-thumb"
        aria-hidden="true"
        data-ready={placement().ready ? "true" : "false"}
        style={{
          width: `${placement().width}px`,
          height: `${placement().height}px`,
          transform: `translate(${placement().x}px, ${placement().y}px)`,
        }}
      />
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class={option.value === props.value ? "segmented-item segmented-item--on" : "segmented-item"}
            data-active={option.value === props.value ? "true" : "false"}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
