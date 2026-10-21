import { Show, createEffect, createSignal, onCleanup, type Component } from "solid-js";
import type { JSX } from "@solidjs/web";
import { prefersReducedMotion } from "../../motion";

interface CollapseProps {
  /** Whether the section should be visible. */
  readonly open: boolean;
  /** Built lazily: nothing exists in the DOM while the section is collapsed. */
  readonly children: () => JSX.Element;
}

const OPEN_MS = 200;
const CLOSE_MS = 160;
/**
 * Both directions decelerate.
 *
 * Fluent's accelerate curve is for content leaving the screen (a toast sliding
 * out, a dialog dropping away): the element is on its way out, so it should
 * start slowly and be gone. A collapse is a size change *in place* — nothing
 * leaves — and an accelerating height reads as "frozen, then a snap":
 * everything below the section sits still and then jumps at the end.
 * Decelerating removes the content immediately and lets the layout below settle
 * softly, which is what Fluent's easy-ease/decelerate curves are for.
 */
const EASE = "cubic-bezier(0.1, 0.9, 0.2, 1)";

/**
 * Height-animated disclosure.
 *
 * `<Show>` cannot animate a removal, and a section that collapses in one frame
 * moves everything below it with a single jump. This keeps the children
 * mounted for the exit, animates the wrapper's height, then releases the inline
 * height so flyouts inside the section can escape the clip again.
 */
export const Collapse: Component<CollapseProps> = (props) => {
  const [mounted, setMounted] = createSignal(false);
  let el: HTMLDivElement | undefined;
  let animation: Animation | undefined;
  let wantOpen = false;
  let initialised = false;

  const settle = (): void => {
    if (!el) return;
    el.style.height = "";
    el.style.overflow = "";
  };

  createEffect(
    () => props.open,
    (open) => {
      wantOpen = open;
      if (!el) return;
      if (!initialised) {
        initialised = true;
        setMounted(open);
        return;
      }
      // Read the rendered height before cancelling: cancelling drops the running
      // animation back to the inline height, which is the *other* end state.
      // Re-applying the rendered height keeps a reversal mid-flight continuous.
      const from = el.getBoundingClientRect().height;
      animation?.cancel();
      animation = undefined;
      if (prefersReducedMotion()) {
        settle();
        setMounted(open);
        return;
      }
      el.style.overflow = "hidden";
      el.style.height = `${from}px`;
      if (open) setMounted(true);
      requestAnimationFrame(() => {
        // A newer toggle owns the element now; its own frame will animate.
        if (!el || wantOpen !== open || animation) return;
        const to = open ? el.scrollHeight : 0;
        // Settle onto the end state so an interrupted animation can be dropped
        // without jumping.
        el.style.height = `${to}px`;
        animation = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration: open ? OPEN_MS : CLOSE_MS,
          easing: EASE,
        });
        animation.onfinish = () => {
          animation = undefined;
          if (open) {
            settle();
            return;
          }
          setMounted(false);
          settle();
        };
      });
    },
  );

  onCleanup(() => {
    animation?.cancel();
  });

  return (
    <div
      class="collapse"
      ref={(element) => {
        el = element;
      }}
    >
      <Show when={mounted()}>{props.children()}</Show>
    </div>
  );
};
