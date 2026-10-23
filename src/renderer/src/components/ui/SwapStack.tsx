import { For, type Component } from "solid-js";
import type { JSX } from "@solidjs/web";

interface SwapItem {
  readonly id: string;
  readonly node: JSX.Element;
}

interface SwapStackProps {
  /** Id of the item that is visible right now. */
  readonly current: string;
  readonly items: ReadonlyArray<SwapItem>;
  readonly title?: string;
}

/**
 * A toolbar slot that swaps between controls of different sizes.
 *
 * Every item stays mounted and in the layout, so the slot is always as wide as
 * its widest state and a switch cross-fades instead of resizing (and jolting)
 * the toolbar. Hidden items are `visibility: hidden`, which keeps them out of
 * the tab order without giving up their space.
 */
export const SwapStack: Component<SwapStackProps> = (props) => (
  <span class="swap-stack" title={props.title}>
    <For each={props.items} keyed={false}>
      {(item) => (
        <span class={["swap-stack-item", { "swap-stack-item--current": item().id === props.current }]}>
          {item().node}
        </span>
      )}
    </For>
  </span>
);
