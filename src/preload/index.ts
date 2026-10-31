import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, WINDOW_ACTIONS, type MaaxBridge } from "../shared/ipc";

const windowFrame: MaaxBridge["windowFrame"] = Object.freeze({
  enabled: process.platform !== "darwin",
  minimize: () => ipcRenderer.send(IPC_CHANNELS.window, WINDOW_ACTIONS.minimize),
  toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.window, WINDOW_ACTIONS.toggleMaximize),
  close: () => ipcRenderer.send(IPC_CHANNELS.window, WINDOW_ACTIONS.close),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window, WINDOW_ACTIONS.isMaximized) as Promise<boolean>,
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
      listener(maximized);
    };
    ipcRenderer.on(IPC_CHANNELS.windowState, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.windowState, handler);
    };
  },
});

const bridge: MaaxBridge = Object.freeze({
  invoke: (command: string, payload: unknown) => ipcRenderer.invoke(IPC_CHANNELS.command, command, payload),
  subscribe: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
    };
  },
  windowFrame,
});

contextBridge.exposeInMainWorld("maax", bridge);
