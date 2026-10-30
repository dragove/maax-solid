import { describe, expect, it } from "vitest";
import {
  ADB_CONNECT_TIMEOUT_MS,
  AdbSpawnError,
  AdbTimeoutError,
  adbConnectedOutput,
  adbReadyState,
  adbSearchPaths,
  connectionConfigFor,
  discoverAdbDevices,
  emulatorForSerial,
  parseAdbDevices,
  probeAdbConnection,
  resolveAdbPath,
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

describe("ADB discovery parsing", () => {
  it("parses devices, transport ids and ignores daemon chatter", () => {
    const output = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "127.0.0.1:16384\tdevice product:vermeer model:23113RKC6C device:vermeer transport_id:1",
      "emulator-5554          device product:vermeer model:23113RKC6C device:vermeer transport_id:2",
      "10.0.0.2:5555          offline",
      "",
    ].join("\r\n");

    expect(parseAdbDevices(output)).toEqual([
      {
        serial: "127.0.0.1:16384",
        state: "device",
        model: "23113RKC6C",
        product: "vermeer",
        transportId: "1",
      },
      {
        serial: "emulator-5554",
        state: "device",
        model: "23113RKC6C",
        product: "vermeer",
        transportId: "2",
      },
      { serial: "10.0.0.2:5555", state: "offline" },
    ]);
  });

  it("maps local emulator ports to a MaaCore connection config", () => {
    expect(emulatorForSerial("127.0.0.1:16384")).toBe("mumu");
    expect(emulatorForSerial("127.0.0.1:16416")).toBe("mumu");
    expect(emulatorForSerial("127.0.0.1:7555")).toBe("mumu");
    expect(emulatorForSerial("127.0.0.1:62001")).toBe("nox");
    expect(emulatorForSerial("emulator-5554")).toBe("generic");
    expect(emulatorForSerial("10.0.0.2:5555")).toBe("generic");
    expect(connectionConfigFor("mumu")).toBe("MuMuEmulator12");
    expect(connectionConfigFor("nox")).toBe("Nox");
    expect(connectionConfigFor("generic")).toBe("General");
  });
});

describe("adbSearchPaths", () => {
  it("searches the bundled Windows emulator clients before PATH", () => {
    const paths = adbSearchPaths({
      platform: "win32",
      env: {
        ProgramFiles: String.raw`C:\PF`,
        "ProgramFiles(x86)": String.raw`C:\PF86`,
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        PATH: String.raw`C:\bin`,
      },
    });
    expect(paths).toContain(String.raw`C:\PF\Netease\MuMu\nx_main\adb.exe`);
    expect(paths).toContain(String.raw`C:\PF\Netease\MuMuPlayer-12.0\shell\adb.exe`);
    expect(paths).toContain(String.raw`C:\Users\me\AppData\Local\Android\Sdk\platform-tools\adb.exe`);
    expect(paths).toContain(String.raw`C:\bin\adb.exe`);
  });

  it("keeps an explicit adb path untouched", async () => {
    await expect(resolveAdbPath("C:/tools/adb.exe", { platform: "win32", env: {} })).resolves.toBe("C:/tools/adb.exe");
  });
});

describe("discoverAdbDevices", () => {
  const devicesOutput = [
    "List of devices attached",
    "127.0.0.1:16384\tdevice product:vermeer model:23113RKC6C device:vermeer transport_id:1",
    "emulator-5554\tdevice product:vermeer model:23113RKC6C device:vermeer transport_id:2",
    "",
  ].join("\n");

  it("dedupes the multiple endpoints of one emulator and prefers MuMu TCP", async () => {
    const calls: Array<string> = [];
    const exec: ExecAdb = async (_adbPath, args) => {
      calls.push(args.join(" "));
      if (args[0] === "devices") return { stdout: devicesOutput, stderr: "" };
      return { stdout: args.includes("android_id") ? "6adbfb6c7711b95f\n" : "", stderr: "" };
    };

    const result = await discoverAdbDevices({
      adbPath: "adb",
      exec,
      portOpen: async () => false,
    });

    expect(result.adbPath).toBe("adb");
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({
      serial: "127.0.0.1:16384",
      state: "device",
      emulator: "mumu",
      config: "MuMuEmulator12",
      model: "23113RKC6C",
    });
    expect(calls.filter((call) => call.startsWith("connect "))).toHaveLength(0);
  });

  it("returns a warning instead of throwing when adb cannot run", async () => {
    const result = await discoverAdbDevices({
      adbPath: "C:/missing/adb.exe",
      exec: async () => {
        throw new AdbSpawnError("spawn C:/missing/adb.exe ENOENT");
      },
      portOpen: async () => false,
    });
    expect(result.devices).toEqual([]);
    expect(result.warning).toContain("无法执行 ADB");
    expect(result.warning).toContain("C:/missing/adb.exe");
  });
});
