import { createSignal, onSettled, type Component } from "solid-js";
import type { Locale } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Icon } from "./ui/Icon";

interface WindowControlsProps {
  readonly locale: () => Locale;
}

/**
 * VSCode-style window buttons for the custom frame (non-macOS). The topbar and
 * sidebar brand are the drag region (see styles.css); clicking here reaches the
 * window-frame IPC so minimize / maximize / close keep standard semantics.
 */
export const WindowControls: Component<WindowControlsProps> = (props) => {
  const [maximized, setMaximized] = createSignal(false);

  // One-time setup after first paint; the topbar lives for the whole app, so
  // this runs once and the returned cleanup only matters if the shell unmounts.
  onSettled(() => {
    void window.maax.windowFrame.isMaximized().then(setMaximized);
    return window.maax.windowFrame.onMaximizedChange(setMaximized);
  });

  return (
    <div class="window-controls">
      <button
        type="button"
        class="window-controls-button"
        title={t(props.locale(), "window.minimize")}
        aria-label={t(props.locale(), "window.minimize")}
        onClick={() => window.maax.windowFrame.minimize()}
      >
        <Icon name="minus" size={15} />
      </button>
      <button
        type="button"
        class="window-controls-button"
        title={t(props.locale(), maximized() ? "window.restore" : "window.maximize")}
        aria-label={t(props.locale(), maximized() ? "window.restore" : "window.maximize")}
        onClick={() => window.maax.windowFrame.toggleMaximize()}
      >
        <Icon name={maximized() ? "copy" : "square"} size={13} />
      </button>
      <button
        type="button"
        class="window-controls-button window-controls-close"
        title={t(props.locale(), "window.close")}
        aria-label={t(props.locale(), "window.close")}
        onClick={() => window.maax.windowFrame.close()}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
};
