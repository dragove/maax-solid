import { app, BrowserWindow, session, shell } from "electron";
import { Effect } from "effect";
import { join } from "node:path";
import appIcon from "../../build/icon.png?asset";
import { registerIpcHandlers } from "./ipc";
import { makeRuntime, type AppRuntime } from "./runtime";
import { Application } from "./services/application";

const isDevelopment = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let runtime: AppRuntime | null = null;
let quitting = false;

app.setName("Maax");

if (isDevelopment) {
  app.commandLine.appendSwitch("remote-debugging-port", "9229");
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
    width: 1400,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Maax",
    backgroundColor: "#1b1b1b",
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

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  hardenWindow(window);

  if (isDevelopment) {
    window.webContents.on("console-message", (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (isDevelopment && rendererUrl) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Showing on did-finish-load instead of ready-to-show removes a compositor
  // round trip: hidden windows throttle frame production, so ready-to-show can
  // lag the first paint by >100ms on Wayland. The window background already
  // matches the app shell, so there is no white flash.
  window.show();
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    if (runtime) {
      await runtime.runPromise(
        Effect.gen(function* () {
          const application = yield* Application;
          yield* application.shutdown;
        }),
      );
      await runtime.dispose();
    }
  } catch (error) {
    console.error("Failed to shut down cleanly", error);
  } finally {
    app.quit();
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
      runtime = makeRuntime();
      registerIpcHandlers(runtime, () => mainWindow);

      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
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

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void shutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
