#!/usr/bin/env node
/**
 * Compare startup and steady-state memory across packaging layouts.
 *
 * Measures, per launch:
 *   launcher spawn -> shell-painted (renderer's second rAF after AppShell mounts)
 * and samples PSS/RSS of the whole process tree shortly after.
 *
 * Usage:
 *   node scripts/measure-startup.mjs
 *   node scripts/measure-startup.mjs --runs 10 --modes appimage,unpacked
 *
 * The three modes consume the same app.asar from dist/linux-unpacked:
 *   unpacked       dist/linux-unpacked/maax (bundled Electron)
 *   appimage       dist/*.AppImage (FUSE runtime)
 *   asar-electron  local Electron binary + resources/app.asar
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function usage() {
  console.log(`Usage: node scripts/measure-startup.mjs [options]

  --runs <n>          measured launches per mode (default 7)
  --warmups <n>       discarded launches per mode (default 1)
  --memory-delay <ms> wait after first paint before sampling memory (default 3000)
  --modes <list>      comma-separated: unpacked,appimage,asar-electron
  --appimage <path>   AppImage to measure instead of the one in dist/
  --json <path>       raw results path (default dist/startup-benchmark.json)
  --help`);
}

function parseArgs(argv) {
  const options = {
    runs: 7,
    warmups: 1,
    memoryDelayMs: 3000,
    modes: undefined,
    appimage: undefined,
    json: join(dist, "startup-benchmark.json"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`Missing value for ${argument}`);
      index += 1;
      return next;
    };
    switch (argument) {
      case "--runs":
        options.runs = Number(value());
        break;
      case "--warmups":
        options.warmups = Number(value());
        break;
      case "--memory-delay":
        options.memoryDelayMs = Number(value());
        break;
      case "--modes":
        options.modes = value().split(",").filter(Boolean);
        break;
      case "--appimage":
        options.appimage = resolve(value());
        break;
      case "--json":
        options.json = resolve(value());
        break;
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error("--runs must be a positive integer");
  if (!Number.isInteger(options.warmups) || options.warmups < 0) throw new Error("--warmups must be >= 0");
  if (!Number.isFinite(options.memoryDelayMs) || options.memoryDelayMs < 0) {
    throw new Error("--memory-delay must be >= 0");
  }
  return options;
}

function requireFile(path, hint) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. ${hint}`);
  return path;
}

function findAppImage() {
  if (!existsSync(dist)) throw new Error("Missing dist/. Run pnpm package and build the AppImage first.");
  const name = readdirSync(dist).find((entry) => entry.endsWith(".AppImage"));
  if (!name) throw new Error("Missing AppImage in dist/. Run pnpm exec electron-builder --linux AppImage.");
  return join(dist, name);
}

function findElectron() {
  const pathFile = join(root, "node_modules", "electron", "path.txt");
  if (!existsSync(pathFile)) throw new Error("Missing node_modules/electron. Run pnpm install.");
  const relative = readFileSync(pathFile, "utf8").trim() || "electron";
  return requireFile(join(root, "node_modules", "electron", "dist", relative), "Reinstall electron.");
}

function modes(options) {
  const unpacked = requireFile(
    join(dist, "linux-unpacked", "maax"),
    "Run pnpm package to produce dist/linux-unpacked.",
  );
  const asar = requireFile(
    join(dist, "linux-unpacked", "resources", "app.asar"),
    "Run pnpm package to produce resources/app.asar.",
  );
  return {
    unpacked: {
      label: "linux-unpacked",
      command: unpacked,
      args: [],
    },
    appimage: {
      label: "AppImage",
      command: options.appimage ?? findAppImage(),
      args: [],
    },
    "asar-electron": {
      label: "app.asar + electron",
      command: findElectron(),
      args: [asar],
    },
  };
}

function readTrace(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A partially written trailing line is retried on the next poll.
    }
  }
  return events;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      cleanup();
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolveExit(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  if (await waitForExit(child, 6000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
  await waitForExit(child, 3000);
}

function readProcesses() {
  const rows = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
      rows.push({ pid, ppid: Number(fields[1]), comm: stat.slice(stat.indexOf("(") + 1, close), cmdline });
    } catch {
      // The process exited while /proc was being scanned.
    }
  }
  return rows;
}

function readMemory(pid) {
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const pssKb = Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0);
    const rssKb = Number(/^Rss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0);
    return { pssKb, rssKb };
  } catch {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const rssKb = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
      return { pssKb: rssKb, rssKb };
    } catch {
      return undefined;
    }
  }
}

function sampleTree(rootPid) {
  const rows = readProcesses();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }

  const seen = new Set();
  const queue = [rootPid];
  const processes = [];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = byPid.get(pid);
    if (row) {
      const memory = readMemory(pid);
      if (memory) {
        const type = /--type=([a-z-]+)/.exec(row.cmdline)?.[1] ?? (pid === rootPid ? "main" : row.comm);
        processes.push({ pid, type, pssMb: memory.pssKb / 1024, rssMb: memory.rssKb / 1024 });
      }
    }
    for (const childPid of children.get(pid) ?? []) queue.push(childPid);
  }

  const pssMb = processes.reduce((total, entry) => total + entry.pssMb, 0);
  const rssMb = processes.reduce((total, entry) => total + entry.rssMb, 0);
  return { pssMb, rssMb, processes };
}

function eventAt(events, name) {
  return events.find((entry) => entry.event === name)?.at;
}

function summarize(events, t0, memory, round, mode) {
  const mainLoaded = events.find((entry) => entry.event === "main-loaded");
  const processStartedAt = Number(mainLoaded?.processStartedAt);
  const shellPaintedAt = eventAt(events, "shell-painted");
  const firstContentfulPaintAt = eventAt(events, "first-contentful-paint");
  const appReadyAt = eventAt(events, "app-ready");
  const windowCreatedAt = eventAt(events, "window-created");
  const domReadyAt = eventAt(events, "dom-ready");
  const didFinishLoadAt = eventAt(events, "did-finish-load");
  const windowShownAt = eventAt(events, "window-shown");
  const rendererMountedAt = eventAt(events, "renderer-mounted");
  const bootstrapRequestAt = eventAt(events, "bootstrap-request");
  const bootstrapResolvedAt = eventAt(events, "bootstrap-resolved");

  return {
    mode,
    round,
    launchToShellMs: shellPaintedAt - t0,
    processToShellMs: Number.isFinite(processStartedAt) ? shellPaintedAt - processStartedAt : undefined,
    launchToMainMs: Number.isFinite(processStartedAt) ? processStartedAt - t0 : undefined,
    appReadyMs: appReadyAt - t0,
    windowCreatedMs: windowCreatedAt - t0,
    domReadyMs: domReadyAt - t0,
    didFinishLoadMs: didFinishLoadAt - t0,
    windowShownMs: windowShownAt - t0,
    rendererMountedMs: rendererMountedAt - t0,
    firstContentfulPaintMs: firstContentfulPaintAt - t0,
    shellPaintedMs: shellPaintedAt - t0,
    workerToShellMs: shellPaintedAt - appReadyAt,
    rendererToShellMs: shellPaintedAt - rendererMountedAt,
    bootstrapMs: bootstrapResolvedAt - bootstrapRequestAt,
    memory,
    events,
  };
}

async function launch(modeName, mode, round, options) {
  const traceDir = mkdtempSync(join(tmpdir(), "maax-boot-"));
  const traceFile = join(traceDir, "trace.ndjson");
  const t0 = Date.now();
  let stdout = "";
  let stderr = "";
  const child = spawn(mode.command, mode.args, {
    cwd: root,
    env: { ...process.env, MAAX_BOOT_TRACE: traceFile },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const capture = (previous, chunk) => (previous + String(chunk)).slice(-8000);
  child.stdout.on("data", (chunk) => {
    stdout = capture(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = capture(stderr, chunk);
  });
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });

  try {
    const deadline = Date.now() + 30000;
    let events = [];
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      events = readTrace(traceFile);
      if (events.some((entry) => entry.event === "shell-painted")) break;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `${modeName} exited before shell paint (code ${child.exitCode ?? child.signalCode}).\n${stderr || stdout}`,
        );
      }
      await sleep(20);
    }
    if (!events.some((entry) => entry.event === "shell-painted")) {
      throw new Error(`${modeName} timed out before shell paint.\n${stderr || stdout}`);
    }

    await sleep(options.memoryDelayMs);
    const memory = sampleTree(child.pid);
    events = readTrace(traceFile);
    return summarize(events, t0, memory, round, modeName);
  } finally {
    await stop(child);
    rmSync(traceDir, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;
}

function summarizeMode(runs) {
  const medianOf = (key) => median(runs.map((run) => run[key]));
  const p90Of = (key) =>
    percentile(
      runs.map((run) => run[key]),
      0.9,
    );
  const memoryRuns = runs.map((run) => run.memory);
  const types = new Map();
  for (const run of runs) {
    for (const entry of run.memory.processes) {
      if (!types.has(entry.type)) types.set(entry.type, []);
      types.get(entry.type).push(entry.pssMb);
    }
  }
  const breakdown = {};
  for (const [type, values] of types) breakdown[type] = round(median(values));

  return {
    runs: runs.length,
    launchToShellMs: {
      median: round(medianOf("launchToShellMs")),
      min: round(Math.min(...runs.map((run) => run.launchToShellMs))),
      p90: round(p90Of("launchToShellMs")),
    },
    processToShellMs: round(medianOf("processToShellMs")),
    firstContentfulPaintMs: round(medianOf("firstContentfulPaintMs")),
    windowShownMs: round(medianOf("windowShownMs")),
    rendererMountedMs: round(medianOf("rendererMountedMs")),
    workerToShellMs: round(medianOf("workerToShellMs")),
    rendererToShellMs: round(medianOf("rendererToShellMs")),
    bootstrapMs: round(medianOf("bootstrapMs")),
    memory: {
      pssMb: round(median(memoryRuns.map((memory) => memory.pssMb)), 1),
      rssMb: round(median(memoryRuns.map((memory) => memory.rssMb)), 1),
      processCount: round(median(memoryRuns.map((memory) => memory.processes.length)), 0),
      pssByTypeMb: breakdown,
    },
  };
}

function formatTable(rows) {
  const headers = ["mode", "runs", "launch→shell ms", "min", "p90", "process→shell", "FCP ms", "PSS MB", "RSS MB"];
  const body = rows.map((row) => [
    row.mode,
    String(row.runs),
    String(row.launchToShellMs.median),
    String(row.launchToShellMs.min),
    String(row.launchToShellMs.p90),
    String(row.processToShellMs),
    String(row.firstContentfulPaintMs),
    `${row.memory.pssMb} (${row.memory.processCount}p)`,
    String(row.memory.rssMb),
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...body.map((cells) => cells[index].length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const available = modes(options);
  const selected = options.modes ?? Object.keys(available);
  for (const name of selected) {
    if (!available[name]) {
      throw new Error(`Unknown mode "${name}". Available: ${Object.keys(available).join(", ")}`);
    }
  }

  console.log(
    `Maax startup benchmark: ${selected.length} modes, ${options.warmups} warmup + ${options.runs} measured launches each\n`,
  );
  if (options.warmups > 0) {
    for (const [index, name] of selected.entries()) {
      const result = await launch(name, available[name], -1, options);
      console.log(
        `warmup ${name}: launch→shell ${result.launchToShellMs}ms, FCP ${round(result.firstContentfulPaintMs)}ms, PSS ${round(result.memory.pssMb)}MB`,
      );
      await sleep(500 + index * 100);
    }
  }

  const measured = Object.fromEntries(selected.map((name) => [name, []]));
  for (let roundIndex = 0; roundIndex < options.runs; roundIndex += 1) {
    const order = selected.map((_, index) => selected[(index + roundIndex) % selected.length]);
    for (const name of order) {
      const result = await launch(name, available[name], roundIndex, options);
      measured[name].push(result);
      console.log(
        `${name} #${roundIndex + 1}: launch→shell ${result.launchToShellMs}ms, FCP ${round(result.firstContentfulPaintMs)}ms, PSS ${round(result.memory.pssMb)}MB`,
      );
      await sleep(400);
    }
  }

  const summary = selected.map((name) => ({ mode: name, ...summarizeMode(measured[name]) }));
  console.log("\nSummary (median unless noted):\n");
  console.log(formatTable(summary));
  console.log("\nDetails (median ms):\n");
  for (const row of summary) {
    console.log(
      `${row.mode}: window ready ${row.windowShownMs}, renderer mounted ${row.rendererMountedMs}, shell ${row.launchToShellMs.median}; ` +
        `app-ready→shell ${row.workerToShellMs}; renderer→shell ${row.rendererToShellMs}; bootstrap ${row.bootstrapMs}`,
    );
    console.log(`  PSS by process: ${JSON.stringify(row.memory.pssByTypeMb)}`);
  }

  writeFileSync(
    options.json,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options: {
          runs: options.runs,
          warmups: options.warmups,
          memoryDelayMs: options.memoryDelayMs,
          appimage: options.appimage,
        },
        summary,
        runs: measured,
      },
      null,
      2,
    ),
  );
  console.log(`\nRaw results: ${options.json}`);

  const userData = new Set(
    Object.values(measured).flatMap((runs) =>
      runs.map((run) => run.events.find((entry) => entry.event === "main-loaded")?.userData),
    ),
  );
  if (userData.size > 1) {
    console.warn(`Warning: modes used different userData directories: ${[...userData].join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
