import { mkdirSync } from "node:fs";
import {
  callbackRecord,
  parseEngineCallback,
  type AppendTaskRequest,
  type ConnectRequest,
  type CreateSessionRequest,
  type EngineCallback,
  type EngineMessage,
  type EngineRequest,
  type InitRequest,
  type ScreenshotResult,
} from "../../shared/engine";
import { loadMaaCore, type MaaCoreLibrary } from "./ffi";

interface ParentPortLike {
  on(event: "message", listener: (event: { data: EngineRequest }) => void): void;
  postMessage(message: EngineMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;

if (!parentPort) {
  throw new Error("The MaaCore host must run inside an Electron utility process.");
}

const port: ParentPortLike = parentPort;
const InstanceOptionKey = { TouchMode: 2, ClientType: 6 } as const;
/** Stay well inside the client's request budget so the core reports the cause. */
const CAPTURE_TIMEOUT_MS = 25_000;

interface Session {
  readonly id: string;
  readonly handle: bigint;
  readonly callback: unknown;
  preview?: PendingPreview;
}

interface PendingPreview {
  readonly requestId: number;
  readonly callId: number;
  readonly startedAt: number;
  readonly timer: NodeJS.Timeout;
}

let library: MaaCoreLibrary | undefined;
const sessions = new Map<string, Session>();
const callbackQueue: EngineCallback[] = [];
let commandChain: Promise<void> = Promise.resolve();
let exiting = false;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const send = (message: EngineMessage): void => {
  try {
    port.postMessage(message);
  } catch (error) {
    console.error("Failed to post message to parent", error);
  }
};

const respond = (id: number, value: unknown): void => {
  send({ id, ok: true, value });
};

const fail = (id: number, error: unknown): void => {
  const message = errorMessage(error);
  send({
    id,
    ok: false,
    error: {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
};

const flushCallbacks = (): void => {
  if (callbackQueue.length === 0) return;
  const items = callbackQueue.splice(0, callbackQueue.length);
  send({ type: "callbacks", items });
  for (const item of items) {
    const session = sessions.get(item.sessionId);
    const preview = session?.preview;
    if (!session || !preview || item.msg !== 4) continue;
    const payload = parseEngineCallback(item.details);
    if (payload.what !== "Screencap" || payload.async_call_id !== preview.callId) continue;
    clearTimeout(preview.timer);
    delete session.preview;
    const details = callbackRecord(payload.details);
    if (details.ret !== true) {
      const reason = typeof details.error === "string" ? details.error : "MaaCore reported capture failure";
      fail(preview.requestId, new Error(reason));
      continue;
    }
    try {
      // Preview latency: request → callback → PNG readback, including the
      // flush interval. The core's own capture time travels separately as
      // AsyncCallInfo.details.cost and is what the log row reports.
      const result: ScreenshotResult = {
        ...requireLibrary().readScreenshot(session.handle),
        durationMs: Math.round(performance.now() - preview.startedAt),
      };
      respond(preview.requestId, result);
    } catch (error) {
      fail(preview.requestId, error);
    }
  }
};

setInterval(flushCallbacks, 25);

const requireLibrary = (): MaaCoreLibrary => {
  if (!library) throw new Error("MaaCore has not been initialised");
  return library;
};

const requireSession = (sessionId: string): Session => {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);
  return session;
};

const init = (request: InitRequest): unknown => {
  if (library) throw new Error("MaaCore is already initialised");
  mkdirSync(request.userDir, { recursive: true });

  const loaded = loadMaaCore(request.coreRoot);
  if (!loaded.setUserDir(request.userDir)) {
    throw new Error(`AsstSetUserDir failed: ${request.userDir}`);
  }
  if (!loaded.loadResource(request.coreRoot)) {
    throw new Error(
      `AsstLoadResource failed for ${request.coreRoot}. Check that resource/ is complete and writable user data exists.`,
    );
  }
  if (request.resourceServer && request.resourceServer !== "CN") {
    if (!loaded.loadGlobalResource(request.resourceServer)) {
      throw new Error(`Failed to load global resource overlay: ${request.resourceServer}`);
    }
  }
  library = loaded;
  send({
    type: "log",
    level: "info",
    message: `MaaCore ${loaded.version} loaded from ${request.coreRoot}`,
  });
  return { version: loaded.version };
};

const createSession = (request: CreateSessionRequest): unknown => {
  const core = requireLibrary();
  if (sessions.has(request.sessionId)) throw new Error(`Session already exists: ${request.sessionId}`);
  const { handle, callback } = core.create((payload) => {
    if (callbackQueue.length >= 20_000) callbackQueue.shift();
    callbackQueue.push({
      sessionId: request.sessionId,
      msg: payload.msg,
      details: payload.details,
    });
  });
  if (handle === null || handle === 0n) {
    throw new Error("AsstCreateEx returned a null handle. Is the resource fully loaded?");
  }
  core.setInstanceOption(handle, InstanceOptionKey.TouchMode, request.touchMode);
  core.setInstanceOption(handle, InstanceOptionKey.ClientType, request.clientType);
  sessions.set(request.sessionId, {
    id: request.sessionId,
    handle,
    callback,
  });
  return { ok: true };
};

const connect = (request: ConnectRequest): unknown => {
  const core = requireLibrary();
  const session = requireSession(request.sessionId);
  const callId = core.asyncConnect(session.handle, request.adbPath, request.address, request.config);
  if (callId <= 0) throw new Error("AsstAsyncConnect did not return a call id");
  return { callId };
};

const appendTask = (request: AppendTaskRequest): unknown => {
  const core = requireLibrary();
  const session = requireSession(request.sessionId);
  const taskId = core.appendTask(session.handle, request.type, JSON.stringify(request.params));
  if (taskId <= 0) {
    throw new Error(`MaaCore rejected task ${request.type}; check its parameters and resource version.`);
  }
  return { taskId };
};

const start = (session: Session): unknown => {
  const core = requireLibrary();
  if (!core.start(session.handle)) throw new Error("AsstStart returned false");
  return { ok: true };
};

const stop = (session: Session): unknown => {
  const core = requireLibrary();
  const ok = core.stop(session.handle);
  return { ok };
};

const requestScreenshot = (session: Session, requestId: number): void => {
  const core = requireLibrary();
  if (session.preview) throw new Error("A screenshot is already in progress for this device");
  if (!core.connected(session.handle)) throw new Error("The device is not connected");
  const startedAt = performance.now();
  const callId = core.requestScreenshot(session.handle);
  if (callId <= 0) throw new Error("AsstAsyncScreencap did not return a call id");
  const timer = setTimeout(() => {
    delete session.preview;
    fail(requestId, new Error("Timed out waiting for MaaCore to finish the screenshot"));
  }, CAPTURE_TIMEOUT_MS);
  session.preview = { requestId, callId, startedAt, timer };
};

const destroySession = async (session: Session): Promise<void> => {
  if (session.preview) {
    clearTimeout(session.preview.timer);
    fail(session.preview.requestId, new Error("The device disconnected during capture"));
    delete session.preview;
  }
  const core = requireLibrary();
  // Drop the session before awaiting: a failed destructor must not be retried
  // on the same handle, which would free it twice.
  sessions.delete(session.id);
  try {
    await core.destroy(session.handle, session.callback);
  } catch (error) {
    // The destructor did not confirm, so the instance may still be alive and
    // may keep calling back under this session id. Only a fresh process gives
    // a known state; the parent reconnects attached devices on host exit.
    if (!exiting) {
      send({ type: "fatal", message: `AsstDestroy failed: ${errorMessage(error)}` });
      setTimeout(() => process.exit(1), 50);
    }
    throw error;
  }
  flushCallbacks();
};

const handle = async (request: EngineRequest): Promise<void> => {
  try {
    switch (request.op) {
      case "init":
        respond(request.id, init(request));
        break;
      case "create-session":
        respond(request.id, createSession(request));
        break;
      case "connect":
        respond(request.id, connect(request));
        break;
      case "append-task":
        respond(request.id, appendTask(request));
        break;
      case "set-task-params": {
        const session = requireSession(request.sessionId);
        const core = requireLibrary();
        respond(request.id, {
          ok: core.setTaskParams(session.handle, request.taskId, JSON.stringify(request.params)),
        });
        break;
      }
      case "screenshot":
        requestScreenshot(requireSession(request.sessionId), request.id);
        break;
      case "start":
        respond(request.id, start(requireSession(request.sessionId)));
        break;
      case "stop":
        respond(request.id, stop(requireSession(request.sessionId)));
        break;
      case "disconnect":
      case "destroy-session":
        await destroySession(requireSession(request.sessionId));
        respond(request.id, { ok: true });
        break;
      case "shutdown": {
        exiting = true;
        for (const session of sessions.values()) {
          try {
            await destroySession(session);
          } catch (error) {
            console.error("Failed to destroy session during shutdown", error);
          }
        }
        flushCallbacks();
        respond(request.id, { ok: true });
        setTimeout(() => process.exit(0), 50);
        break;
      }
    }
  } catch (error) {
    fail(request.id, error);
    send({
      type: "log",
      level: "error",
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
};

port.on("message", (event) => {
  const request = event.data;
  commandChain = commandChain.then(
    () => handle(request),
    () => handle(request),
  );
});

process.on("uncaughtException", (error) => {
  send({ type: "fatal", message: error.stack ?? error.message });
  setTimeout(() => process.exit(1), 50);
});

process.on("unhandledRejection", (reason) => {
  send({ type: "fatal", message: String(reason) });
});

send({
  type: "log",
  level: "info",
  message: "Core host started",
});
