import { describe, expect, it } from "vitest";
import {
  ADB_CONNECT_TIMEOUT_MS,
  AdbSpawnError,
  AdbTimeoutError,
  adbConnectedOutput,
  adbReadyState,
  probeAdbConnection,
  type ExecAdb,
} from "./adb";

describe("adb output classification", () => {
  it("accepts the success lines adb prints", () => {
    expect(adbConnectedOutput("connected to 127.0.0.1:5555")).toBe(true);
    expect(adbConnectedOutput("already connected to 127.0.0.1:5555\n")).toBe(true);
  });

  it("rejects the failure lines adb prints", () => {
    expect(adbConnectedOutput("failed to connect to 127.0.0.1:5555")).toBe(false);
    expect(adbConnectedOutput("cannot connect to 127.0.0.1:5555: Connection refused")).toBe(false);
    expect(adbConnectedOutput("")).toBe(false);
  });

  it("only treats a device state as ready", () => {
    expect(adbReadyState("device\n")).toBe(true);
    expect(adbReadyState("offline")).toBe(false);
    expect(adbReadyState("unauthorized")).toBe(false);
  });
});

const fake =
  (reply: (args: ReadonlyArray<string>) => Promise<{ stdout: string; stderr: string }>): ExecAdb =>
  (_adbPath, args) =>
    reply(args);

describe("probeAdbConnection", () => {
  it("fails fast when adb connect hangs instead of waiting for MaaCore", async () => {
    const result = await probeAdbConnection({
      adbPath: "adb",
      address: "192.168.240.112:5555",
      exec: async () => {
        throw new AdbTimeoutError("adb connect 在 8000 毫秒内没有返回");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ADB 连接超时");
    expect(result.message).toContain(`${ADB_CONNECT_TIMEOUT_MS / 1000} 秒`);
    expect(result.message).toContain("192.168.240.112:5555");
    expect(result.message).toContain("模拟器已启动");
  });

  it("reports an unusable adb path", async () => {
    const result = await probeAdbConnection({
      adbPath: "/missing/adb",
      address: "127.0.0.1:5555",
      exec: async () => {
        throw new AdbSpawnError("spawn /missing/adb ENOENT");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("无法执行 ADB（/missing/adb）");
  });

  it("passes once adb reports a connection", async () => {
    const calls: Array<string> = [];
    const exec = fake(async (args) => {
      calls.push(args.join(" "));
      return { stdout: `connected to ${args[1]}\n`, stderr: "" };
    });
    await expect(probeAdbConnection({ adbPath: "adb", address: "10.0.0.2:5555", exec })).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["connect 10.0.0.2:5555"]);
  });

  it("accepts a refused connect when the adb server already lists the device", async () => {
    const exec = fake(async (args) =>
      args[0] === "connect"
        ? { stdout: "failed to connect to usb-serial\n", stderr: "" }
        : { stdout: "device\n", stderr: "" },
    );
    await expect(probeAdbConnection({ adbPath: "adb", address: "usb-serial", exec })).resolves.toEqual({ ok: true });
  });

  it("surfaces adb's own failure line", async () => {
    const exec = fake(async (args) =>
      args[0] === "connect"
        ? { stdout: "cannot connect to 127.0.0.1:5555: Connection refused\n", stderr: "" }
        : { stdout: "", stderr: "error: device '127.0.0.1:5555' not found\n" },
    );
    await expect(probeAdbConnection({ adbPath: "adb", address: "127.0.0.1:5555", exec })).resolves.toEqual({
      ok: false,
      message: "cannot connect to 127.0.0.1:5555: Connection refused",
    });
  });
});
