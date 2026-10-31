import { DEFAULT_SETTINGS, type Locale } from "../shared/schemas";

/**
 * Window-behavior flags shared by the Effect services and the Electron shell.
 *
 * The settings service owns the values; the window's close handler runs outside
 * Effect and needs a synchronous answer, so the Application mirrors them here
 * whenever settings are loaded or updated. The shell registers a sync so the
 * tray icon exists only while close-to-tray is on and its menu follows the app
 * locale instead of the OS one.
 */
let closeToTrayEnabled = false;
let appLocale: Locale = DEFAULT_SETTINGS.locale;
let syncShell: (() => void) | null = null;

/** The Electron shell owns the Tray object; it registers the sync that maintains it. */
export const setShellSync = (sync: () => void): void => {
  syncShell = sync;
};

export const setWindowBehavior = (behavior: { readonly closeToTray: boolean; readonly locale: Locale }): void => {
  const changed = closeToTrayEnabled !== behavior.closeToTray || appLocale !== behavior.locale;
  closeToTrayEnabled = behavior.closeToTray;
  appLocale = behavior.locale;
  if (changed) syncShell?.();
};

export const closeToTray = (): boolean => closeToTrayEnabled;

export const shellLocale = (): Locale => appLocale;
