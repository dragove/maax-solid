/**
 * Window-behavior flags shared by the Effect services and the Electron shell.
 *
 * The settings service owns the value; the window's close handler runs outside
 * Effect and needs a synchronous answer, so the Application mirrors the flag
 * here whenever settings are loaded or updated.
 */
let closeToTrayEnabled = false;

export const setCloseToTray = (enabled: boolean): void => {
  closeToTrayEnabled = enabled;
};

export const closeToTray = (): boolean => closeToTrayEnabled;
