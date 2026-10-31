import { Show, createEffect, createSignal, onCleanup, onSettled, type Component } from "solid-js";
import type { JSX } from "@solidjs/web";
import { dialogExitMs, prefersReducedMotion } from "../../motion";

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly children: JSX.Element;
  readonly footer?: JSX.Element;
  readonly onClose: () => void;
  readonly wide?: boolean;
}

export const Modal: Component<ModalProps> = (props) => {
  // <Show> disposes its branch the moment the condition flips, and an effect
  // runs after that render, so the exit cannot be driven by a signal that is
  // only set when a close is noticed. `hold` is armed while the dialog is open
  // and keeps the layer mounted through the close beat; the timer releases it.
  const [hold, setHold] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  let dialogEl: HTMLDialogElement | undefined;
  let opened = false;
  let timer: number | undefined;

  createEffect(
    () => props.open,
    (open) => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (open) {
        opened = true;
        setHold(true);
        setClosing(false);
        return;
      }
      if (!opened) return;
      if (prefersReducedMotion()) {
        dialogEl?.close();
        setHold(false);
        return;
      }
      setClosing(true);
      timer = window.setTimeout(() => {
        timer = undefined;
        dialogEl?.close();
        setClosing(false);
        setHold(false);
      }, dialogExitMs);
    },
  );

  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer);
    // Do not dispose a dialog that still reports itself as open.
    if (dialogEl?.open) dialogEl.close();
  });

  return (
    <Show when={props.open || hold()}>
      <div class={["modal-layer", { "modal-layer--closing": closing() }]}>
        <dialog
          class={["modal", { "modal--wide": props.wide, "modal--closing": closing() }]}
          aria-modal="true"
          closedby="any"
          onCancel={(event) => {
            event.preventDefault();
            props.onClose();
          }}
          ref={(element) => {
            dialogEl = element;
            // Solid 2 refs run before insertion. Schedule each new <Show> branch
            // after rendering, and ignore a branch removed before it settles.
            onSettled(() => {
              if (element.isConnected && !element.open) element.showModal();
            });
          }}
        >
          <header class="modal-head">
            <div>
              <h2>{props.title}</h2>
              <Show when={props.description}>{(description) => <p class="modal-description">{description()}</p>}</Show>
            </div>
            <button class="icon-button" type="button" aria-label="Close" onClick={props.onClose}>
              ×
            </button>
          </header>
          <div class="modal-body">{props.children}</div>
          <Show when={props.footer}>
            <footer class="modal-foot">{props.footer}</footer>
          </Show>
        </dialog>
      </div>
    </Show>
  );
};
