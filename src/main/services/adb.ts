import { execFile } from "node:child_process";

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
