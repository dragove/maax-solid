import { Show, type Component } from "solid-js";
import type { JSX } from "@solidjs/web";

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly children: JSX.Element;
  readonly footer?: JSX.Element;
  readonly onClose: () => void;
  readonly wide?: boolean;
}

export const Modal: Component<ModalProps> = (props) => (
  <Show when={props.open}>
    <div class="modal-layer">
      <button class="modal-backdrop" type="button" aria-label="Close" onClick={props.onClose} />
      <dialog
        class={props.wide ? "modal modal--wide" : "modal"}
        open
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          props.onClose();
        }}
        ref={(element) => {
          if (!element.open) element.showModal();
        }}
      >
        <header class="modal-head">
          <div>
            <p class="eyebrow">MAAX</p>
            <h2>{props.title}</h2>
            <Show when={props.description}>
              {(description) => <p class="modal-description">{description()}</p>}
            </Show>
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
