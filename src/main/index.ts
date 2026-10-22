import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, session, shell } from "electron";
import { closeToTray } from "./app-behavior";
import { Effect } from "effect";
import { join } from "node:path";
import appIcon from "../../build/icon.png?asset";
import { attachRendererBootTrace, bootTrace, bootTraceEnabled } from "./boot-trace";
import { registerIpcHandlers } from "./ipc";
import { makeRuntime, type AppRuntime } from "./runtime";
import { Application } from "./services/application";

const isDevelopment = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let runtime: AppRuntime | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayHintShown = false;

app.setName("Maax");

if (bootTraceEnabled) {
  bootTrace("main-loaded", {
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
    processStartedAt: Date.now() - process.uptime() * 1000,
    mainUptimeMs: Math.round(process.uptime() * 1000),
  });
}

if (isDevelopment) {
  app.commandLine.appendSwitch("remote-debugging-port", "9229");
}

/** Bring the workbench back from the tray or a minimized state. */
function showMainWindow(): void {
  if (!mainWindow) {
    if (app.isReady()) void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  const zh = app.getLocale().toLowerCase().startsWith("zh");
  try {
    const image = nativeImage.createFromPath(appIcon);
    tray = new Tray(image.isEmpty() ? appIcon : image.resize({ width: 22, height: 22 }));
    tray.setToolTip("Maax");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: zh ? "显示 MAAX" : "Show MAAX", click: showMainWindow },
        { type: "separator" },
        {
          label: zh ? "退出 MAAX" : "Quit MAAX",
          click: () => {
            void shutdown();
          },
        },
      ]),
    );
    tray.on("click", showMainWindow);
    tray.on("double-click", showMainWindow);
  } catch (error) {
    // A desktop without a tray host must not break the window lifecycle; the
    // close handler checks tray before hiding the window.
    console.warn("Tray unavailable", error);
    tray = null;
  }
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
      // The startup benchmark must receive frame callbacks even if the window
      // opens behind another one; normal runs keep Chromium's throttling.
      backgroundThrottling: !bootTraceEnabled,
      spellcheck: false,
    },
  });

  mainWindow = window;

  bootTrace("window-created");
  attachRendererBootTrace(window.webContents);
  window.webContents.on("dom-ready", () => bootTrace("dom-ready"));
  window.webContents.on("did-finish-load", () => bootTrace("did-finish-load"));
  window.once("ready-to-show", () => bootTrace("ready-to-show"));

  window.on("close", (event) => {
    if (quitting || !closeToTray() || tray === null) return;
    event.preventDefault();
    window.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      const zh = app.getLocale().toLowerCase().startsWith("zh");
      new Notification({
        title: zh ? "MAAX 仍在运行" : "MAAX is still running",
        body: zh
          ? "定时任务会继续执行；从托盘图标可以重新打开窗口。"
          : "Scheduled runs continue. Reopen the window from the tray icon.",
      }).show();
    }
  });

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
  bootTrace("load-start", { url: isDevelopment && rendererUrl ? rendererUrl : "file:index.html" });

  if (isDevelopment && rendererUrl) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(
      join(__dirname, "../renderer/index.html"),
      bootTraceEnabled ? { query: { bootTrace: "1" } } : undefined,
    );
  }

  bootTrace("load-resolved");

  // Showing on did-finish-load instead of ready-to-show removes a compositor
  // round trip: hidden windows throttle frame production, so ready-to-show can
  // lag the first paint by >100ms on Wayland. The window background already
  // matches the app shell, so there is no white flash.
  window.show();
  bootTrace("window-shown");
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
    tray?.destroy();
    tray = null;
    app.quit();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  void app
    .whenReady()
    .then(async () => {
      bootTrace("app-ready");
      app.setAppUserModelId("app.maax.desktop");
      runtime = makeRuntime();
      bootTrace("runtime-created");
      registerIpcHandlers(runtime, () => mainWindow);
      bootTrace("ipc-registered");

      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);

      await createWindow();
      createTray();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        } else {
          showMainWindow();
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
  // A destroyed window is not a quit request while tray mode is enabled; the
  // tray can recreate it. Window-manager closes are prevented in the close
  // handler, so this covers programmatic closes too.
  if (closeToTray() && tray !== null) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});
