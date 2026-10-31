import type { Component } from "solid-js";
import { Icon } from "./Icon";

interface ChevronProps {
  /** Whether the thing it discloses is open: closed points right, open points down. */
  readonly open: boolean;
  readonly class?: string;
}

/**
 * Disclosure marker. Both states are the same `chevron-down` glyph rotated by
 * CSS (see `.chevron` in styles.css), so the shape cannot drift between them
 * and only the rotation animates. Static arrows keep their own icon.
 */
export const Chevron: Component<ChevronProps> = (props) => {
  const label = (): string =>
    ["icon", "chevron", props.open ? "chevron--open" : "", props.class ?? ""].filter(Boolean).join(" ");

  return <Icon name="chevron-down" class={label()} />;
};
