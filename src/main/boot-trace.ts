import { appendFileSync } from "node:fs";
import type { WebContents } from "electron";

/**
 * Opt-in startup tracing for scripts/measure-startup.mjs.
 *
 * The main process appends NDJSON records to the file named by
 * MAAX_BOOT_TRACE. Renderer records arrive as console messages; only the
 * benchmark sets the variable, so normal runs pay no file I/O.
 */
const traceFile = process.env.MAAX_BOOT_TRACE?.trim();
const rendererMarker = "__MAAX_BOOT__ ";

export const bootTraceEnabled = traceFile !== undefined && traceFile.length > 0;

export function bootTrace(event: string, data: Record<string, unknown> = {}): void {
  if (!traceFile) return;
  try {
    appendFileSync(traceFile, `${JSON.stringify({ event, at: Date.now(), ...data })}\n`);
  } catch {
    // Tracing must never change startup behavior.
  }
}

export function attachRendererBootTrace(contents: WebContents): void {
  if (!traceFile) return;
  contents.on("console-message", (event) => {
    if (!event.message.startsWith(rendererMarker)) return;
    try {
      const payload: unknown = JSON.parse(event.message.slice(rendererMarker.length));
      if (typeof payload !== "object" || payload === null) return;
      const record = payload as Record<string, unknown>;
      if (typeof record.event !== "string") return;
      appendFileSync(traceFile, `${JSON.stringify({ ...record, source: "renderer" })}\n`);
    } catch {
      // Ignore malformed renderer markers.
    }
  });
}
