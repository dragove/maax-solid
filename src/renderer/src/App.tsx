import { Show, createSignal, onSettled, type Component } from "solid-js";
import type { Bootstrap } from "../../shared/schemas";
import { AppShell } from "./shell/AppShell";
import { DesktopBridgeError, DesktopBridgeLive, bootstrap as bootstrapEffect } from "./effect/desktop";
import { RuntimeContext, createRuntime, useAppRuntime } from "./effect/solid-effect";
import { Toaster } from "./components/ui/Toaster";
import { Icon } from "./components/ui/Icon";

function describeError(cause: unknown): string {
  if (cause instanceof DesktopBridgeError) {
    return `${cause.operation}: ${cause.reason}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

const BootScreen: Component = () => (
  <div class="boot-screen">
    <div class="boot-inner">
      <span class="boot-mark">
        <span>M</span>
      </span>
      <h1 class="boot-title">Starting the workbench</h1>
      <div class="boot-progress" aria-hidden="true">
        <span />
      </div>
      <p class="boot-hint">Loading MaaCore status and workspace…</p>
    </div>
  </div>
);

const FatalScreen: Component<{ error: unknown; onRetry: () => void }> = (props) => (
  <div class="fatal-screen">
    <div class="fatal-card">
      <div class="fatal-brand">
        <span class="boot-mark">
          <span>M</span>
        </span>
        <span>
          <strong>MAAX</strong>
          <small>Runtime failure</small>
        </span>
      </div>
      <h1>The workbench could not start.</h1>
      <p class="fatal-message">{describeError(props.error)}</p>
      <button class="btn btn--primary btn--md" type="button" onClick={props.onRetry}>
        <Icon name="refresh-cw" />
        Retry runtime
      </button>
    </div>
  </div>
);

const Workbench: Component = () => {
  const runtime = useAppRuntime();
  const [initial, setInitial] = createSignal<Bootstrap>();
  const [error, setError] = createSignal<unknown>();
  let cancelled = false;

  const load = (): void => {
    setError(undefined);
    setInitial(undefined);
    void runtime
      .runPromise(bootstrapEffect)
      .then((value) => {
        if (!cancelled) setInitial(value);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.error("MAAX renderer bootstrap failed:", cause);
        setError(cause);
      });
  };

  onSettled(() => {
    load();
    return () => {
      cancelled = true;
    };
  });

  return (
    <Show
      when={initial()}
      fallback={
        <Show when={error()} fallback={<BootScreen />}>
          {(cause) => <FatalScreen error={cause()} onRetry={load} />}
        </Show>
      }
    >
      {(value) => <AppShell initial={value()} />}
    </Show>
  );
};

const App: Component = () => {
  const runtime = createRuntime(DesktopBridgeLive);
  return (
    <RuntimeContext value={runtime}>
      <Toaster />
      <Workbench />
    </RuntimeContext>
  );
};

export default App;
