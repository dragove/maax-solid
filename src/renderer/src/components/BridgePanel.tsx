import { Effect } from "effect";
import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import type { Component } from "solid-js";
import type { PingResult } from "../../../shared/schemas";
import { DesktopBridgeError, pingEffect } from "../effect/desktop";
import { useAppRuntime } from "../effect/solid-effect";
import { CheckIcon, RefreshIcon } from "./Icons";

interface PingRecord {
  readonly id: number;
  readonly latency: number;
  readonly barHeight: number;
}

const latencyFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const timedPing = Effect.gen(function* () {
  const startedAt = performance.now();
  const result = yield* pingEffect;
  const latency = Math.max(0.1, performance.now() - startedAt);

  return { latency, result };
});

function errorMessage(cause: unknown): string {
  if (cause instanceof DesktopBridgeError) {
    return `${cause.operation}: ${cause.reason}`;
  }

  return cause instanceof Error ? cause.message : String(cause);
}

function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${Math.floor(seconds)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  return `${hours}h ${minutes % 60}m`;
}

const BridgePanel: Component = () => {
  const runtime = useAppRuntime();
  let pingSequence = 0;

  const [pings, setPings] = createSignal<PingRecord[]>([]);
  const [lastLatency, setLastLatency] = createSignal<number | null>(null);
  const [lastPong, setLastPong] = createSignal<PingResult | null>(null);
  const [pinging, setPinging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const averageLatency = createMemo(() => {
    const samples = pings();
    if (samples.length === 0) return null;
    return samples.reduce((total, sample) => total + sample.latency, 0) / samples.length;
  });

  const latencyLabel = createMemo(() => {
    const latency = lastLatency();
    return latency === null ? "—" : latencyFormat.format(latency);
  });

  const averageLabel = createMemo(() => {
    const average = averageLatency();
    return average === null ? "—" : latencyFormat.format(average);
  });

  const statusLabel = createMemo(() => {
    if (error()) return "Bridge error";
    if (pinging()) return "Handshaking";
    if (lastPong()) return "Connected";
    return "Waiting";
  });

  async function pingMainProcess(): Promise<void> {
    if (pinging()) return;

    setPinging(true);
    setError(null);

    try {
      const { latency, result } = await runtime.runPromise(timedPing);

      pingSequence += 1;
      const record: PingRecord = {
        id: pingSequence,
        latency,
        barHeight: Math.min(100, Math.max(18, 18 + Math.log1p(latency) * 24)),
      };

      setPings((samples) => [...samples, record].slice(-16));
      setLastLatency(latency);
      setLastPong(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPinging(false);
    }
  }

  onSettled(() => {
    let active = true;

    // Prime the Effect-managed IPC channel so the first visible sample
    // measures a warm round-trip rather than Chromium's cold invoke cost.
    const warmUpAndPing = async (): Promise<void> => {
      try {
        await runtime.runPromise(Effect.ignore(pingEffect));
      } catch {
        // pingMainProcess below surfaces the failure in the UI.
      }

      if (active) await pingMainProcess();
    };

    void warmUpAndPing();

    return () => {
      active = false;
    };
  });

  return (
    <article class="card bridge-card">
      <header class="card-head">
        <div>
          <p class="card-kicker">IPC bridge · Effect</p>
          <h2 class="card-title">Main thread handshake</h2>
        </div>
        <span
          class={[
            "bridge-status",
            {
              "is-online": Boolean(lastPong()) && !error(),
              "is-failed": Boolean(error()),
            },
          ]}
          aria-live="polite"
        >
          <span class="bridge-dot" aria-hidden="true" />
          {statusLabel()}
        </span>
      </header>

      <div class="bridge-body">
        <div class="latency-block">
          <span class="latency-label">Roundtrip</span>
          <div class="latency-value">
            <span>{latencyLabel()}</span>
            <small>ms</small>
          </div>
          <div class="latency-meta">
            <span>avg {averageLabel()} ms</span>
            <span>{pings().length}/16 samples</span>
          </div>
        </div>

        <div class="ping-chart" aria-hidden="true">
          <For each={pings()}>
            {(sample) => (
              <span
                class="ping-bar"
                style={`height: ${sample.barHeight}%`}
                title={`${latencyFormat.format(sample.latency)} ms`}
              />
            )}
          </For>
          <Show when={pings().length === 0}>
            <span class="ping-chart-empty">No samples yet</span>
          </Show>
        </div>
      </div>

      {error() ? (
        <p class="card-error" role="alert">
          {error()}
        </p>
      ) : null}

      <button
        class="ping-button"
        type="button"
        onClick={() => void pingMainProcess()}
        disabled={pinging()}
      >
        <span class={["ping-icon", { "is-spinning": pinging() }]}>
          <RefreshIcon />
        </span>
        <Show when={pinging()} fallback="Ping main process">
          Pinging main process…
        </Show>
        <span class="key-hint">IPC</span>
      </button>

      <div class="bridge-interface">
        <div class="interface-item">
          <span class="interface-label">Channel</span>
          <code>maax:ping</code>
        </div>
        <div class="interface-item">
          <span class="interface-label">Boundary</span>
          <code>contextBridge</code>
        </div>
      </div>

      <footer class="bridge-foot">
        <span class="bridge-detail">
          <Show when={lastPong()} fallback={<span>Waiting for the main process</span>}>
            {(pong) => (
              <span>
                PID {pong().processId} · uptime {formatUptime(pong().uptimeSeconds)}
              </span>
            )}
          </Show>
        </span>
        <span class="bridge-flags">
          <span>
            <CheckIcon /> sandbox
          </span>
          <span>
            <CheckIcon /> isolated
          </span>
          <span>
            <CheckIcon /> schema
          </span>
        </span>
      </footer>
    </article>
  );
};

export default BridgePanel;
