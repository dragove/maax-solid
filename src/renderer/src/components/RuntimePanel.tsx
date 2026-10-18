import { For, createMemo } from "solid-js";
import type { Component } from "solid-js";
import type { RuntimeInfo } from "../../../shared/schemas";
import { LockIcon } from "./Icons";

interface RuntimePanelProps {
  readonly info: RuntimeInfo;
}

interface RuntimeRow {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

function prettyPlatform(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

const RuntimePanel: Component<RuntimePanelProps> = (props) => {
  const rows = createMemo<RuntimeRow[]>(() => {
    const info = props.info;

    return [
      {
        label: "Electron",
        value: info.versions.electron,
        hint: "app shell",
      },
      {
        label: "Chromium",
        value: info.versions.chromium,
        hint: "renderer",
      },
      {
        label: "Node.js",
        value: info.versions.node,
        hint: "main process",
      },
      {
        label: "V8",
        value: info.versions.v8,
        hint: "js engine",
      },
      {
        label: "Platform",
        value: `${prettyPlatform(info.system.platform)} · ${info.system.arch}`,
        hint: info.system.release,
      },
      {
        label: "Locale",
        value: info.app.locale,
        hint: info.system.timezone,
      },
    ];
  });

  return (
    <article class="card runtime-card">
      <header class="card-head">
        <div>
          <p class="card-kicker">Runtime · Schema</p>
          <h2 class="card-title">Inside the shell</h2>
        </div>
        <span class="sync-pill is-synced">
          <span class="sync-dot" aria-hidden="true" />
          Synced
        </span>
      </header>

      <div class="runtime-grid">
        <For each={rows()}>
          {(row) => (
            <div class="runtime-cell">
              <span class="runtime-label">{row.label}</span>
              <strong class="runtime-value" title={row.value}>
                {row.value}
              </strong>
              <span class="runtime-hint">{row.hint}</span>
            </div>
          )}
        </For>
      </div>

      <footer class="runtime-foot">
        <span class="security-note">
          <LockIcon />
          Sandboxed renderer
        </span>
        <span class="runtime-build">
          {props.info.app.packaged ? "packaged" : "development"} · v{props.info.app.version}
        </span>
      </footer>
    </article>
  );
};

export default RuntimePanel;
