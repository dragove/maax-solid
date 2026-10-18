import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { Effect } from "effect";
import { join } from "node:path";
import appIcon from "../../build/icon.png?asset";
import { IPC_CHANNELS } from "../shared/ipc";
import { pingMainProcess, readRuntimeInfo } from "./runtime";

const isDevelopment = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

app.setName("Maax");

function registerIpcHandlers(): void {
  // The Electron lifecycle is imperative, while application logic stays in
  // Effect. Run each Effect at the IPC boundary and let Electron transport the
  // resulting Promise or rejection.
  ipcMain.handle(IPC_CHANNELS.runtimeInfo, () => Effect.runPromise(readRuntimeInfo));
  ipcMain.handle(IPC_CHANNELS.ping, () => Effect.runPromise(pingMainProcess));
}

function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return;
    void shell.openExternal(parsed.toString());
  } catch {
    // Invalid or unsupported URLs are ignored rather than handed to the OS.
  }
}

function hardenWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  if (isDevelopment) {
    window.webContents.on("before-input-event", (event, input) => {
      const isDevToolsShortcut =
        input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i") ||
        (input.meta && input.alt && input.key.toLowerCase() === "i");

      if (isDevToolsShortcut) {
        window.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    show: false,
    title: "Maax",
    backgroundColor: "#07090e",
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  hardenWindow(window);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (isDevelopment && rendererUrl) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("app.maax.desktop");
      registerIpcHandlers();

      // This app never needs camera, microphone, notifications, or other
      // privileged web capabilities.
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);

      await createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        }
      });
    })
    .catch((cause: unknown) => {
      console.error("Failed to start Maax:", cause);
      app.quit();
    });
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
