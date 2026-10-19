import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type MaaxBridge } from "../shared/ipc";

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
});

contextBridge.exposeInMainWorld("maax", bridge);
