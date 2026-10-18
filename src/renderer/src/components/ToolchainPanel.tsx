import { For } from "solid-js";
import type { Component } from "solid-js";
import { ArrowUpRightIcon } from "./Icons";

interface Tool {
  readonly name: string;
  readonly role: string;
  readonly version: string;
  readonly glyph: string;
  readonly href: string;
}

const tools: readonly Tool[] = [
  {
    name: "Node.js",
    role: "Host runtime",
    version: __MAAX_BUILD__.hostNode,
    glyph: "N",
    href: "https://nodejs.org/en/about/previous-releases",
  },
  {
    name: "pnpm",
    role: "Package manager",
    version: __MAAX_BUILD__.pnpm,
    glyph: "p",
    href: "https://pnpm.io/",
  },
  {
    name: "Vite",
    role: "Build engine",
    version: __MAAX_BUILD__.vite,
    glyph: "V",
    href: "https://vite.dev/",
  },
  {
    name: "Solid",
    role: "UI runtime",
    version: __MAAX_BUILD__.solid,
    glyph: "S",
    href: "https://www.solidjs.com/",
  },
  {
    name: "Effect",
    role: "Runtime system",
    version: __MAAX_BUILD__.effect,
    glyph: "E",
    href: "https://effect.website/",
  },
  {
    name: "TypeScript",
    role: "Type system",
    version: __MAAX_BUILD__.typescript,
    glyph: "T",
    href: "https://www.typescriptlang.org/",
  },
];

const ToolchainPanel: Component = () => {
  return (
    <article class="card toolchain-card">
      <header class="card-head">
        <div>
          <p class="card-kicker">Toolchain</p>
          <h2 class="card-title">The supporting cast</h2>
        </div>
        <span class="micro-badge">Pinned</span>
      </header>

      <div class="tool-grid">
        <For each={tools}>
          {(tool) => (
            <a class="tool-tile" href={tool.href} target="_blank" rel="noreferrer">
              <span class="tool-glyph" aria-hidden="true">
                {tool.glyph}
              </span>
              <span class="tool-copy">
                <span class="tool-name">{tool.name}</span>
                <span class="tool-role">{tool.role}</span>
              </span>
              <span class="tool-version">{tool.version}</span>
              <span class="tool-arrow">
                <ArrowUpRightIcon />
              </span>
            </a>
          )}
        </For>
      </div>

      <footer class="toolchain-foot">
        <span>Exact versions pinned in package.json.</span>
        <span class="lockfile-pill">pnpm-lock.yaml</span>
      </footer>
    </article>
  );
};

export default ToolchainPanel;
