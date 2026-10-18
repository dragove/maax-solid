import { createMemo, createSignal } from "solid-js";
import type { Component } from "solid-js";

const SignalPanel: Component = () => {
  const [count, setCount] = createSignal(7);
  const doubled = createMemo(() => count() * 2);
  const parity = createMemo(() => (count() % 2 === 0 ? "even" : "odd"));

  return (
    <article class="card signal-card">
      <header class="card-head">
        <div>
          <p class="card-kicker">Solid 2 · Signal</p>
          <h2 class="card-title">One value. Two reads.</h2>
        </div>
        <span class="micro-badge">Fine-grained</span>
      </header>

      <div class="signal-body">
        <div class="signal-readout" aria-live="polite">
          <span class="signal-value">{count()}</span>
          <span class="signal-unit">count</span>
        </div>

        <div class="signal-controls">
          <button
            class="signal-button"
            type="button"
            aria-label="Decrease count"
            onClick={() => setCount((value) => Math.max(0, value - 1))}
          >
            −
          </button>
          <button
            class="signal-button is-primary"
            type="button"
            aria-label="Increase count"
            onClick={() => setCount((value) => value + 1)}
          >
            +
          </button>
        </div>
      </div>

      <div class="signal-meta">
        <span>
          memo <b>× 2 = {doubled()}</b>
        </span>
        <span>
          parity <b>{parity()}</b>
        </span>
        <button class="text-button" type="button" onClick={() => setCount(0)}>
          reset
        </button>
      </div>

      <div class="signal-graph" aria-hidden="true">
        <span class="graph-label">graph</span>
        <span class="graph-node">count()</span>
        <span class="graph-link" />
        <span class="graph-node is-derived">doubled()</span>
        <span class="graph-link" />
        <span class="graph-node">text</span>
      </div>

      <p class="signal-caption">
        Only the text bound to <code>count()</code> and <code>doubled()</code> updates. The
        component body runs once.
      </p>
    </article>
  );
};

export default SignalPanel;
