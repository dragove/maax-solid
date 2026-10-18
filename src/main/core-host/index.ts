import { mkdirSync } from "node:fs";
import type {
  AppendTaskRequest,
  ConnectRequest,
  CreateSessionRequest,
  EngineCallback,
  EngineMessage,
  EngineRequest,
  InitRequest,
  ScreenshotResult,
  SessionRequest,
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

interface Session {
  readonly id: string;
  readonly handle: bigint;
  readonly callback: unknown;
  connected: boolean;
  running: boolean;
}

let library: MaaCoreLibrary | undefined;
let libraryRoot = "";
const sessions = new Map<string, Session>();
const callbackQueue: EngineCallback[] = [];
let commandChain: Promise<void> = Promise.resolve();

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
  const message = error instanceof Error ? error.message : String(error);
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
  libraryRoot = request.coreRoot;

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
  if (sessions.has(request.sessionId))
    throw new Error(`Session already exists: ${request.sessionId}`);
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
    connected: false,
    running: false,
  });
  return { ok: true };
};

const connect = (request: ConnectRequest): unknown => {
  const core = requireLibrary();
  const session = requireSession(request.sessionId);
  const callId = core.asyncConnect(
    session.handle,
    request.adbPath,
    request.address,
    request.config,
  );
  if (callId <= 0) throw new Error("AsstAsyncConnect did not return a call id");
  return { callId };
};

const appendTask = (request: AppendTaskRequest): unknown => {
  const core = requireLibrary();
  const session = requireSession(request.sessionId);
  const taskId = core.appendTask(session.handle, request.type, JSON.stringify(request.params));
  if (taskId <= 0) {
    throw new Error(
      `MaaCore rejected task ${request.type}; check its parameters and resource version.`,
    );
  }
  return { taskId };
};

const start = (session: Session): unknown => {
  const core = requireLibrary();
  if (!core.start(session.handle)) throw new Error("AsstStart returned false");
  session.running = true;
  return { ok: true };
};

const stop = (session: Session): unknown => {
  const core = requireLibrary();
  const ok = core.stop(session.handle);
  session.running = false;
  return { ok };
};

const destroySession = (session: Session): void => {
  const core = requireLibrary();
  if (session.running) {
    try {
      core.stop(session.handle);
    } catch {
      // The task may already have finished; destruction below is authoritative.
    }
  }
  core.destroy(session.handle, session.callback);
  sessions.delete(session.id);
};

const handleSessionRequest = (request: SessionRequest): unknown => {
  const session = requireSession(request.sessionId);
  const core = requireLibrary();
  switch (request.op) {
    case "start":
      return start(session);
    case "stop":
      return stop(session);
    case "screenshot": {
      if (!core.connected(session.handle)) {
        throw new Error("The device is not connected");
      }
      const result: ScreenshotResult = core.screenshot(session.handle);
      return result;
    }
    case "disconnect":
    case "destroy-session":
      destroySession(session);
      return { ok: true };
  }
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
      case "start":
      case "stop":
      case "screenshot":
      case "disconnect":
      case "destroy-session":
        respond(request.id, handleSessionRequest(request));
        break;
      case "shutdown": {
        for (const session of sessions.values()) {
          try {
            destroySession(session);
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
  message: `Core host started (root: ${libraryRoot || "uninitialised"})`,
});
