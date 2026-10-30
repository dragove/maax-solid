import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { DiscoveredDevice, DeviceDiscovery, EmulatorKind } from "../../shared/schemas";

/**
 * ADB's client has no connect timeout of its own: `adb connect <unreachable>`
 * keeps retrying TCP until the kernel gives up, which on a dead host can take
 * minutes or never end. MaaCore runs that same command on a worker thread and
 * has no way to cancel it, so a hung `AsstAsyncConnect` never reports back and
 * the device stays "connecting" forever. The app therefore probes the address
 * itself, with a hard timeout, before handing the device to MaaCore.
 */
export const ADB_CONNECT_TIMEOUT_MS = 8_000;
const ADB_STATE_TIMEOUT_MS = 5_000;
const ADB_LIST_TIMEOUT_MS = 10_000;
const ADB_EMULATOR_CONNECT_TIMEOUT_MS = 4_000;
const ADB_PROPERTY_TIMEOUT_MS = 4_000;
const PORT_PROBE_TIMEOUT_MS = 300;

export interface AdbOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecAdb = (adbPath: string, args: ReadonlyArray<string>, timeoutMs: number) => Promise<AdbOutput>;

export class AdbTimeoutError extends Error {}

export class AdbSpawnError extends Error {}

export interface AdbProbeResult {
  readonly ok: boolean;
  readonly message?: string;
}

/** `connected to <address>` / `already connected to <address>`. */
export const adbConnectedOutput = (output: string): boolean => /^(?:already )?connected to /im.test(output);

export const adbReadyState = (output: string): boolean => output.trim() === "device";

export const execAdb: ExecAdb = (adbPath, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      adbPath,
      [...args],
      { timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && (error as { killed?: boolean }).killed) {
          reject(new AdbTimeoutError(`adb ${args.join(" ")} 在 ${timeoutMs} 毫秒内没有返回`));
          return;
        }
        // A string `code` means the child never ran (ENOENT, EACCES); a numeric
        // one is an ordinary non-zero exit whose output still carries the reason.
        if (error && typeof (error as NodeJS.ErrnoException).code === "string") {
          reject(new AdbSpawnError(error.message));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

const firstLine = (...texts: Array<string | undefined>): string | undefined => {
  for (const text of texts) {
    const line = (text ?? "")
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean);
    if (line) return line;
  }
  return undefined;
};

export const probeAdbConnection = async (options: {
  readonly adbPath: string;
  readonly address: string;
  readonly exec?: ExecAdb;
}): Promise<AdbProbeResult> => {
  const exec = options.exec ?? execAdb;
  let connect: AdbOutput;
  try {
    connect = await exec(options.adbPath, ["connect", options.address], ADB_CONNECT_TIMEOUT_MS);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AdbTimeoutError
          ? `ADB 连接超时（${ADB_CONNECT_TIMEOUT_MS / 1000} 秒）：${options.address} 不可达，请确认模拟器已启动或地址可访问`
          : `无法执行 ADB（${options.adbPath}）：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (adbConnectedOutput(connect.stdout)) return { ok: true };
  // A refused `adb connect` is not fatal when the adb server already knows the
  // address; MaaCore tolerates that case, so the probe must too.
  let state: AdbOutput | undefined;
  try {
    state = await exec(options.adbPath, ["-s", options.address, "get-state"], ADB_STATE_TIMEOUT_MS);
  } catch {
    state = undefined;
  }
  if (state && adbReadyState(state.stdout)) return { ok: true };
  return {
    ok: false,
    message:
      firstLine(connect.stderr, connect.stdout, state?.stderr, state?.stdout) ?? `ADB 未能连接 ${options.address}`,
  };
};

/* -------------------------------------------------------------------------- */
/* ADB discovery                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Windows generally has no `adb` on PATH, while every Android emulator ships
 * its own. The search order prefers an SDK installation, then the bundled ADB
 * of the common emulators, then anything on PATH. Linux keeps the historic
 * `adb`/`$ANDROID_HOME` lookup so a packaged build behaves the same there.
 */
export interface AdbLookupOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

const adbExecutableName = (platform: NodeJS.Platform): string => (platform === "win32" ? "adb.exe" : "adb");

const environmentPaths = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): ReadonlyArray<string> =>
  (env.PATH ?? env.Path ?? "")
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

const uniquePaths = (paths: ReadonlyArray<string>, platform: NodeJS.Platform): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
};

/** Candidate paths without touching the filesystem; exported for tests. */
export const adbSearchPaths = (options: AdbLookupOptions = {}): ReadonlyArray<string> => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exe = adbExecutableName(platform);

  if (platform !== "win32") {
    const home = env.HOME ?? "";
    const sdkRoots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(home, "Android", "Sdk")].filter(
      (root): root is string => typeof root === "string" && root.trim() !== "",
    );
    return uniquePaths(
      [
        ...sdkRoots.map((root) => join(root, "platform-tools", exe)),
        "/usr/bin/adb",
        "/usr/local/bin/adb",
        ...environmentPaths(env, platform).map((dir) => join(dir, exe)),
      ],
      platform,
    );
  }

  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? "", "AppData", "Local");
  const sdkRoots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(localAppData, "Android", "Sdk")].filter(
    (root): root is string => typeof root === "string" && root.trim() !== "",
  );

  return uniquePaths(
    [
      ...sdkRoots.map((root) => join(root, "platform-tools", exe)),
      // MuMu 5 (NX) keeps `nx_main/adb.exe`; MuMu 12 uses `shell/adb.exe`.
      join(programFiles, "Netease", "MuMu", "nx_main", exe),
      join(programFiles, "Netease", "MuMuPlayer-12.0", "shell", exe),
      join(programFiles, "MuMuPlayer-12.0", "shell", exe),
      join(programFilesX86, "Netease", "MuMuPlayer-12.0", "shell", exe),
      join(programFilesX86, "MuMuPlayer-12.0", "shell", exe),
      ...(env.LDPLAYER_HOME ? [join(env.LDPLAYER_HOME, exe)] : []),
      join(programFiles, "LDPlayer", "LDPlayer9", exe),
      join(programFiles, "LDPlayer", "LDPlayer4.0", exe),
      join(programFilesX86, "LDPlayer", "LDPlayer9", exe),
      join(programFilesX86, "LDPlayer", "LDPlayer4.0", exe),
      join(programFiles, "Nox", "bin", exe),
      join(programFilesX86, "Nox", "bin", exe),
      join(programFiles, "BlueStacks_nxt", "HD-Adb.exe"),
      join(programFilesX86, "BlueStacks_nxt", "HD-Adb.exe"),
      join(programFiles, "BlueStacks", "HD-Adb.exe"),
      join(programFilesX86, "BlueStacks", "HD-Adb.exe"),
      ...environmentPaths(env, platform).map((dir) => join(dir, exe)),
    ],
    platform,
  );
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** MuMu can be installed outside Program Files; its config records the real root. */
const mumuInstallRoots = async (root: string): Promise<ReadonlyArray<string>> => {
  const roots = [root];
  for (const relative of [
    ["configs", "install_config.json"],
    ["configs", "main", "install_config.json"],
  ]) {
    const text = await readFile(join(root, ...relative), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    try {
      const parsed = JSON.parse(text) as { product?: { install_dir?: unknown } };
      const installDir = parsed.product?.install_dir;
      if (typeof installDir === "string" && installDir.trim() !== "") roots.push(installDir.trim());
    } catch {
      // A partially written config must not break discovery.
    }
  }
  return roots;
};

/** MuMu versions live under `nx_device/<version>/shell`; scan them at runtime. */
const mumuDevicePaths = async (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<ReadonlyArray<string>> => {
  if (platform !== "win32") return [];
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const candidates = [
    join(programFiles, "Netease", "MuMu"),
    env["ProgramFiles(x86)"] ? join(env["ProgramFiles(x86)"], "Netease", "MuMu") : undefined,
  ].filter((root): root is string => root !== undefined);
  const roots = new Set<string>();
  for (const candidate of candidates) {
    for (const root of await mumuInstallRoots(candidate)) roots.add(root);
  }
  const paths: string[] = [];
  for (const root of roots) {
    paths.push(join(root, "nx_main", "adb.exe"));
    const versions = await readdir(join(root, "nx_device"), { withFileTypes: true }).catch(() => []);
    for (const entry of versions) {
      if (!entry.isDirectory()) continue;
      paths.push(join(root, "nx_device", entry.name, "shell", "adb.exe"));
    }
  }
  return paths;
};

export const findAdbExecutables = async (options: AdbLookupOptions = {}): Promise<ReadonlyArray<string>> => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const candidates = [...adbSearchPaths(options), ...(await mumuDevicePaths(platform, env))];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) found.push(candidate);
  }
  return uniquePaths(found, platform);
};

/**
 * The ADB executable to use for a device. An explicit path always wins; an
 * empty one is resolved from the installed emulators/SDK at call time so a
 * packaged Windows build works without the user configuring anything.
 */
export const resolveAdbPath = async (configured: string, options: AdbLookupOptions = {}): Promise<string> => {
  const explicit = configured.trim();
  if (explicit !== "") return explicit;
  const found = await findAdbExecutables(options);
  return found[0] ?? adbExecutableName(options.platform ?? process.platform);
};

export interface AdbDeviceInfo {
  readonly serial: string;
  readonly state: string;
  readonly model?: string;
  readonly product?: string;
  readonly transportId?: string;
}

/** Parse the line-oriented `adb devices -l` output. */
export const parseAdbDevices = (output: string): ReadonlyArray<AdbDeviceInfo> => {
  const devices: AdbDeviceInfo[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("List of devices") || trimmed.startsWith("*")) continue;
    const parts = trimmed.split(/\s+/u);
    const serial = parts[0];
    const state = parts[1];
    if (serial === undefined || state === undefined) continue;
    const fields = new Map<string, string>();
    for (const part of parts.slice(2)) {
      const index = part.indexOf(":");
      if (index > 0) fields.set(part.slice(0, index), part.slice(index + 1));
    }
    const model = fields.get("model");
    const product = fields.get("product");
    const transportId = fields.get("transport_id");
    devices.push({
      serial,
      state,
      ...(model === undefined ? {} : { model }),
      ...(product === undefined ? {} : { product }),
      ...(transportId === undefined ? {} : { transportId }),
    });
  }
  return devices;
};

/** MuMu 12+ increments its local ADB port by 32 per running instance. */
export const emulatorForSerial = (serial: string): EmulatorKind => {
  const match = /^127\.0\.0\.1:(\d+)$/u.exec(serial);
  if (!match) return "generic";
  const port = Number(match[1]);
  if (port === 7555 || (port >= 16384 && port <= 16704 && (port - 16384) % 32 === 0)) return "mumu";
  if (port === 62001 || port === 62025 || port === 62026) return "nox";
  return "generic";
};

export const connectionConfigFor = (emulator: EmulatorKind): string => {
  switch (emulator) {
    case "mumu":
      return "MuMuEmulator12";
    case "nox":
      return "Nox";
    default:
      return "General";
  }
};

const LOCAL_EMULATOR_PORTS: ReadonlyArray<number> = [
  16384, 16416, 16448, 16480, 16512, 7555, 5555, 5557, 62001, 62025, 62026, 21503,
];

const portOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

const androidId = async (adbPath: string, serial: string, exec: ExecAdb): Promise<string | undefined> => {
  try {
    const result = await exec(
      adbPath,
      ["-s", serial, "shell", "settings", "get", "secure", "android_id"],
      ADB_PROPERTY_TIMEOUT_MS,
    );
    const value = result.stdout.trim();
    return value === "" || value === "null" ? undefined : value;
  } catch {
    return undefined;
  }
};

const serialPriority = (serial: string): number => {
  if (emulatorForSerial(serial) === "mumu") return 0;
  if (serial.startsWith("127.0.0.1:")) return 1;
  if (serial.startsWith("emulator-")) return 2;
  return 3;
};

export interface AdbDiscoveryOptions extends AdbLookupOptions {
  readonly adbPath?: string;
  readonly exec?: ExecAdb;
  readonly portOpen?: (port: number) => Promise<boolean>;
}

/**
 * List the devices the local ADB server can see and, when it is still empty of
 * emulator endpoints, connect the usual local ports first. Results are deduped
 * by Android id: MuMu exposes the same instance as `127.0.0.1:16384`, `:7555`
 * and `emulator-5554`, and adding three copies to the app would be confusing.
 */
export const discoverAdbDevices = async (options: AdbDiscoveryOptions = {}): Promise<DeviceDiscovery> => {
  const exec = options.exec ?? execAdb;
  const adbPath = await resolveAdbPath(options.adbPath ?? "", options);
  let devices: ReadonlyArray<AdbDeviceInfo>;
  try {
    devices = parseAdbDevices((await exec(adbPath, ["devices", "-l"], ADB_LIST_TIMEOUT_MS)).stdout);
  } catch (error) {
    return {
      adbPath,
      devices: [],
      warning: `无法执行 ADB（${adbPath}）：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const listed = new Set(devices.map((device) => device.serial));
  const probe = options.portOpen ?? portOpen;
  const openPorts: number[] = [];
  for (const port of LOCAL_EMULATOR_PORTS) {
    if (listed.has(`127.0.0.1:${port}`)) continue;
    if (await probe(port)) openPorts.push(port);
  }
  for (const port of openPorts) {
    try {
      await exec(adbPath, ["connect", `127.0.0.1:${port}`], ADB_EMULATOR_CONNECT_TIMEOUT_MS);
    } catch {
      // A port can accept TCP without speaking ADB; the device list decides.
    }
  }
  if (openPorts.length > 0) {
    try {
      devices = parseAdbDevices((await exec(adbPath, ["devices", "-l"], ADB_LIST_TIMEOUT_MS)).stdout);
    } catch {
      // Keep the first list.
    }
  }

  const ordered = [...devices].sort((a, b) => serialPriority(a.serial) - serialPriority(b.serial));
  const seen = new Set<string>();
  const discovered: DiscoveredDevice[] = [];
  for (const device of ordered) {
    const uuid = device.state === "device" ? await androidId(adbPath, device.serial, exec) : undefined;
    const key = uuid ?? device.serial;
    if (seen.has(key)) continue;
    seen.add(key);
    const emulator = emulatorForSerial(device.serial);
    const name = device.model ?? device.product ?? device.serial;
    discovered.push({
      serial: device.serial,
      state: device.state,
      ...(device.model === undefined ? {} : { model: device.model }),
      name,
      emulator,
      config: connectionConfigFor(emulator),
    });
  }

  return { adbPath, devices: discovered };
};
