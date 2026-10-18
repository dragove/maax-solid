import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type MaaxBridge } from "../shared/ipc";

const bridge: MaaxBridge = Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo),
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
});

contextBridge.exposeInMainWorld("maax", bridge);
