import { Schema } from "effect";
import { Errored, Loading, Show, createMemo, createSignal, onSettled } from "solid-js";
import type { Component } from "solid-js";
import type { RuntimeInfo, Theme } from "../../shared/schemas";
import { ThemeSchema } from "../../shared/schemas";
import BridgePanel from "./components/BridgePanel";
import { ArrowUpRightIcon, BrandMark, MoonIcon, SunIcon } from "./components/Icons";
import RuntimePanel from "./components/RuntimePanel";
import SignalPanel from "./components/SignalPanel";
import ToolchainPanel from "./components/ToolchainPanel";
import { DesktopBridgeError, DesktopBridgeLive, runtimeInfoEffect } from "./effect/desktop";
import { RuntimeContext, createRuntime, runEffect } from "./effect/solid-effect";

const THEME_KEY = "maax-theme";
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TIMEZONE_LABEL = TIMEZONE.split("/").at(-1)?.replaceAll("_", " ") ?? TIMEZONE;

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "2-digit",
});

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved !== null) return Schema.decodeUnknownSync(ThemeSchema)(saved);
  } catch {
    // Invalid persisted state falls back to the app default.
  }
  return "dark";
}

function describeError(cause: unknown): string {
  if (cause instanceof DesktopBridgeError) {
    return `${cause.operation}: ${cause.reason}`;
  }

  return cause instanceof Error ? cause.message : String(cause);
}

const BootScreen: Component = () => (
  <div class="boot-screen">
    <div class="boot-inner">
      <span class="brand-mark boot-mark">
        <BrandMark />
      </span>
      <p class="card-kicker">Effect runtime</p>
      <h1 class="boot-title">Starting the workbench</h1>
      <div class="boot-progress" aria-hidden="true">
        <span />
      </div>
      <p class="mono-label">Validating bridge · decoding schema</p>
    </div>
  </div>
);

interface WorkspaceProps {
  readonly info: RuntimeInfo;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
}

const Workspace: Component<WorkspaceProps> = (props) => {
  const [now, setNow] = createSignal(new Date());

  const clock = createMemo(() => clockFormatter.format(now()));
  const date = createMemo(() => dateFormatter.format(now()));

  onSettled(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  });

  return (
    <div class="app">
      <div class="ambient" aria-hidden="true" />

      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">
            <BrandMark />
          </span>
          <span class="brand-lockup">
            <span class="brand-name">MAAX</span>
            <span class="brand-sub">Effect desktop baseline</span>
          </span>
        </div>

        <div class="topbar-context" aria-hidden="true">
          <span>LOCAL / 001</span>
          <span class="topbar-slash">/</span>
          <span>SOLID × EFFECT</span>
        </div>

        <div class="topbar-actions">
          <span class="connection-pill">
            <span class="connection-dot" aria-hidden="true" />
            Bridge online
          </span>
          <button
            class="theme-toggle"
            type="button"
            aria-label={`Switch to ${props.theme === "dark" ? "light" : "dark"} theme`}
            title="Toggle color theme"
            onClick={props.onToggleTheme}
          >
            <Show when={props.theme === "dark"} fallback={<SunIcon />}>
              <MoonIcon />
            </Show>
          </button>
        </div>
      </header>

      <main class="main">
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <p class="eyebrow">
              <span class="eyebrow-line" aria-hidden="true" />
              Desktop baseline · 2026
            </p>
            <h1 id="hero-title" class="hero-title">
              Built light.
              <br />
              <em>Runs sharp.</em>
            </h1>
            <p class="hero-lede">
              A secure Electron shell pairing Solid 2's fine-grained runtime with Effect's typed,
              interruptible execution model. Schema-validated IPC, zero Node in the renderer.
            </p>
            <div class="hero-tags" aria-label="Build versions">
              <span class="version-tag">
                <b>Electron</b>
                <span>{props.info.versions.electron}</span>
              </span>
              <span class="version-tag">
                <b>Solid</b>
                <span>{__MAAX_BUILD__.solid}</span>
              </span>
              <span class="version-tag">
                <b>Effect</b>
                <span>{__MAAX_BUILD__.effect}</span>
              </span>
              <span class="version-tag">
                <b>Host Node</b>
                <span>{__MAAX_BUILD__.hostNode}</span>
              </span>
            </div>
          </div>

          <aside class="clock-panel" aria-label="Local time">
            <div class="clock-head">
              <span class="mono-label">Local time</span>
              <span class="clock-zone" title={TIMEZONE}>
                {TIMEZONE_LABEL}
              </span>
            </div>
            <time class="clock-time" datetime={now().toISOString()}>
              {clock()}
            </time>
            <span class="clock-date">{date()}</span>
            <div class="clock-rule">
              <span aria-hidden="true" />
            </div>
            <div class="clock-foot">
              <span class="live-dot" aria-hidden="true" />
              <span>Renderer live</span>
              <span class="clock-version">v{props.info.versions.electron}</span>
            </div>
          </aside>
        </section>

        <section class="dashboard" aria-label="Application dashboard">
          <RuntimePanel info={props.info} />
          <BridgePanel />
          <SignalPanel />
          <ToolchainPanel />
        </section>
      </main>

      <footer class="footer">
        <div class="footer-brand">
          <span class="footer-mark" aria-hidden="true">
            M
          </span>
          <span>
            MAAX
            <span class="footer-separator">/</span>
            secure desktop starter
          </span>
        </div>

        <nav class="footer-links" aria-label="Project links">
          <a href="https://www.electronjs.org/docs/latest/" target="_blank" rel="noreferrer">
            Electron
            <ArrowUpRightIcon />
          </a>
          <a href="https://docs.solidjs.com/" target="_blank" rel="noreferrer">
            Solid
            <ArrowUpRightIcon />
          </a>
          <a href="https://effect.website/" target="_blank" rel="noreferrer">
            Effect
            <ArrowUpRightIcon />
          </a>
          <a href="https://pnpm.io/" target="_blank" rel="noreferrer">
            pnpm
            <ArrowUpRightIcon />
          </a>
        </nav>

        <span class="footer-meta">
          Node {__MAAX_BUILD__.hostNode} · pnpm {__MAAX_BUILD__.pnpm}
        </span>
      </footer>
    </div>
  );
};

const Workbench: Component = () => {
  const startTheme = initialTheme();
  document.documentElement.dataset.theme = startTheme;

  const [theme, setTheme] = createSignal<Theme>(startTheme);
  const runtimeInfo = createMemo<RuntimeInfo>(() => runEffect(runtimeInfoEffect));

  function toggleTheme(): void {
    const next: Theme = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;

    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The theme still applies for this session.
    }
  }

  return (
    <Loading fallback={<BootScreen />}>
      <Workspace info={runtimeInfo()} theme={theme()} onToggleTheme={toggleTheme} />
    </Loading>
  );
};

const App: Component = () => {
  return (
    <RuntimeContext value={createRuntime(DesktopBridgeLive)}>
      <Errored
        fallback={(cause, reset) => (
          <div class="fatal-screen">
            <div class="fatal-card">
              <div class="fatal-brand">
                <span class="brand-mark">
                  <BrandMark />
                </span>
                <span class="brand-lockup">
                  <span class="brand-name">MAAX</span>
                  <span class="brand-sub">Runtime failure</span>
                </span>
              </div>
              <p class="card-kicker">Effect runtime</p>
              <h1 class="fatal-title">The workbench could not start.</h1>
              <p class="fatal-message">{describeError(cause())}</p>
              <button class="fatal-button" type="button" onClick={reset}>
                Retry runtime
              </button>
            </div>
          </div>
        )}
      >
        <Workbench />
      </Errored>
    </RuntimeContext>
  );
};

export default App;
