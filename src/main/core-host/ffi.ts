import koffi from "koffi";
import { join } from "node:path";

const NULL_SIZE = 0xffff_ffff_ffff_ffffn;

export interface CallbackPayload {
  readonly msg: number;
  readonly details: string;
}

export interface MaaCoreLibrary {
  readonly path: string;
  readonly version: string;
  setUserDir(path: string): boolean;
  loadResource(path: string): boolean;
  loadGlobalResource(server: string): boolean;
  create(callback: (payload: CallbackPayload) => void): { handle: bigint; callback: unknown };
  destroy(handle: bigint, callback: unknown): void;
  setInstanceOption(handle: bigint, key: number, value: string): boolean;
  asyncConnect(handle: bigint, adbPath: string, address: string, config: string): number;
  appendTask(handle: bigint, type: string, params: string): number;
  setTaskParams(handle: bigint, taskId: number, params: string): boolean;
  start(handle: bigint): boolean;
  stop(handle: bigint): boolean;
  running(handle: bigint): boolean;
  connected(handle: bigint): boolean;
  screenshot(handle: bigint): {
    png: Uint8Array;
    width: number;
    height: number;
    durationMs: number;
  };
}

interface PngSize {
  readonly width: number;
  readonly height: number;
}

function pngSize(bytes: Uint8Array): PngSize {
  if (bytes.length < 24) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.subarray(0, 8));
  if (signature !== "\x89PNG\r\n\x1a\n") return { width: 0, height: 0 };
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function loadMaaCore(root: string): MaaCoreLibrary {
  const libPath = join(root, "libMaaCore.so");
  const lib = koffi.load(libPath);

  const asstSetUserDir = lib.func("uint8 AsstSetUserDir(const char *path)");
  const asstLoadResource = lib.func("uint8 AsstLoadResource(const char *path)");
  const asstCreateEx = lib.func("void *AsstCreateEx(void *callback, void *arg)");
  const asstDestroy = lib.func("void AsstDestroy(void *handle)");
  const asstSetInstanceOption = lib.func(
    "uint8 AsstSetInstanceOption(void *handle, int32 key, const char *value)",
  );
  const asstAsyncConnect = lib.func(
    "int32 AsstAsyncConnect(void *handle, const char *adb, const char *address, const char *config, uint8 block)",
  );
  const asstAppendTask = lib.func(
    "int32 AsstAppendTask(void *handle, const char *type, const char *params)",
  );
  const asstSetTaskParams = lib.func(
    "uint8 AsstSetTaskParams(void *handle, int32 taskId, const char *params)",
  );
  const asstStart = lib.func("uint8 AsstStart(void *handle)");
  const asstStop = lib.func("uint8 AsstStop(void *handle)");
  const asstRunning = lib.func("uint8 AsstRunning(void *handle)");
  const asstConnected = lib.func("uint8 AsstConnected(void *handle)");
  const asstAsyncScreencap = lib.func("int32 AsstAsyncScreencap(void *handle, uint8 block)");
  const asstGetImage = lib.func("uint64 AsstGetImage(void *handle, void *buffer, uint64 size)");
  const asstGetVersion = lib.func("const char *AsstGetVersion()");

  const version = String(asstGetVersion() ?? "unknown");
  const callbackProto = koffi.proto(
    "void AsstApiCallback(int32 msg, const char *details_json, void *custom_arg)",
  );

  const bool = (value: unknown): boolean => Number(value) === 1;

  return {
    path: libPath,
    version,
    setUserDir: (userDir) => bool(asstSetUserDir(userDir)),
    loadResource: (resourceRoot) => bool(asstLoadResource(resourceRoot)),
    loadGlobalResource: (server) =>
      bool(asstLoadResource(join(root, "resource", "global", server))),
    create: (onCallback) => {
      const callback = koffi.register((msg: number, details: string) => {
        try {
          onCallback({ msg: Number(msg), details: String(details ?? "") });
        } catch (error) {
          console.error("MaaCore callback failed", error);
        }
      }, koffi.pointer(callbackProto));
      const handle = asstCreateEx(callback, null);
      return { handle: handle as bigint, callback };
    },
    destroy: (handle, callback) => {
      asstDestroy(handle);
      koffi.unregister(callback as never);
    },
    setInstanceOption: (handle, key, value) => bool(asstSetInstanceOption(handle, key, value)),
    asyncConnect: (handle, adbPath, address, config) =>
      Number(asstAsyncConnect(handle, adbPath, address, config, 0)),
    appendTask: (handle, type, params) => Number(asstAppendTask(handle, type, params)),
    setTaskParams: (handle, taskId, params) => bool(asstSetTaskParams(handle, taskId, params)),
    start: (handle) => bool(asstStart(handle)),
    stop: (handle) => bool(asstStop(handle)),
    running: (handle) => bool(asstRunning(handle)),
    connected: (handle) => bool(asstConnected(handle)),
    screenshot: (handle) => {
      asstAsyncScreencap(handle, 1);
      const startedAt = Date.now();
      const sizes = [8 * 1024 * 1024, 16 * 1024 * 1024];
      for (const size of sizes) {
        const buffer = Buffer.allocUnsafe(size);
        const written = asstGetImage(handle, buffer, BigInt(size));
        if (written === NULL_SIZE) continue;
        const length = Number(written);
        if (length <= 0)
          throw new Error("MaaCore did not return a screenshot (is the device connected?)");
        const png = new Uint8Array(buffer.buffer, buffer.byteOffset, length).slice();
        return { png, ...pngSize(png), durationMs: Date.now() - startedAt };
      }
      throw new Error("Screenshot exceeds the 16 MiB capture buffer");
    },
  };
}
