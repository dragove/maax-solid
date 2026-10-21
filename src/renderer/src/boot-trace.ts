/**
 * Renderer half of the startup trace used by scripts/measure-startup.mjs.
 *
 * Enabled by ?bootTrace=1. Every timestamp is absolute epoch milliseconds so
 * the harness can compare renderer paints with the launcher and main process.
 */
const marker = "__MAAX_BOOT__ ";
const enabled = new URLSearchParams(window.location.search).has("bootTrace");

function timestamp(): number {
  return performance.timeOrigin + performance.now();
}

function emit(event: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    console.log(marker + JSON.stringify({ event, at: timestamp(), ...data }));
  } catch {
    // Tracing must never affect rendering.
  }
}

function afterNextPaint(callback: () => void): void {
  // rAF runs before the paint, so yield one task: the timestamp then lands after
  // the frame has been produced instead of one frame before it.
  requestAnimationFrame(() => {
    setTimeout(callback, 0);
  });
}

export function traceRendererBoot(event: string, data: Record<string, unknown> = {}): void {
  emit(event, data);
}

export function watchRendererShell(): void {
  if (!enabled) return;

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name !== "first-paint" && entry.name !== "first-contentful-paint") continue;
        emit(entry.name, { at: performance.timeOrigin + entry.startTime });
      }
    }).observe({ type: "paint", buffered: true });
  } catch {
    // Paint timing is optional; the rAF markers still cover the benchmark.
  }

  const root = document.getElementById("root");
  if (!root) return;

  let reported = false;
  const reportShell = (): boolean => {
    if (reported || !document.querySelector(".shell")) return false;
    reported = true;
    emit("shell-inserted");
    void Promise.all([document.fonts.ready, new Promise<void>((resolve) => afterNextPaint(resolve))]).then(() => {
      emit("shell-painted");
    });
    return true;
  };

  if (reportShell()) return;

  const observer = new MutationObserver(() => {
    if (reportShell()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
}
