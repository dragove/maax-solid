---
name: maax-maintenance
description: Maintenance guardrails for this Electron + Solid 2 + Effect 4 repo. Use when changing reactive UI, Effect services/layers, IPC contracts, native-process integration, log severity mapping, or packaging.
---

# Maax maintenance guardrails

Read [`.agents/skills/solid2/SKILL.md`](../solid2/SKILL.md) before changing TSX.
This file records durable patterns that prevent regressions in this repo; the
Solid primer remains the authority for API details.

## Start here

1. **Locate the boundary.** Renderer state, main-process service, native helper,
   or IPC edge each have different failure modes. Fix the owner, not the leaf
   that merely displays the symptom.
2. **Read the existing path end to end.** For an IPC change, read the schema,
   command map, preload, renderer service, and main handler before editing.
3. **Reproduce the real interaction.** Reactive bugs often only appear after a
   second update. Force the update, then check selection, focus, and persisted
   state.
4. **Verify before finishing:** `pnpm check`, `pnpm test`, `pnpm build`;
   `pnpm package` when the change can affect packaged runtime.

## Reactive UI

### List identity and remounting

Solid's `<For>` keys rows by object identity by default. Replacing an item with
a new object therefore destroys and recreates its DOM. For positional lists
whose rows are edited in place, use `keyed={false}` so the row survives updates:

```tsx
<For each={rows()} keyed={false}>
  {(row, index) => {
    const value = () => row();
    return <Row item={value()} onRemove={() => remove(value().id)} onDragStart={() => setFrom(index)} />;
  }}
</For>
```

- With `keyed={false}`, the callback receives an **item accessor** and a
  **number** index. Do not call `index()`.
- Pass `value()`, not the accessor, when the child expects a value prop. The
  child then reads `props.item` reactively.
- If rows have stable unique IDs, keying by ID is an equally valid choice; the
  rule is to choose identity deliberately, not to inherit reference identity by
  accident.
- Symptom of the default mistake: typing in a row pauses or loses focus, and a
  save indicator flickers on every keystroke because the input is recreated.

### Never snapshot reactive props

A component body runs once. A local computed from `props.value` at that moment
is stale on the next update, even though surrounding JSX updates correctly.

```tsx
// Wrong: frozen at component creation
const selected = Array.isArray(props.value) ? props.value : [];

// Right: evaluated in the reactive scope that reads it
const selected = (): string[] => (Array.isArray(props.value) ? (props.value as string[]) : []);
```

Use accessors or memos for anything that can change: chip state, selected
options, derived labels, and handlers that read the latest value. A summary
that updates while the control next to it does not is the usual signature.

### Untracked reads and effect callbacks

`STRICT_READ_UNTRACKED` means the read happened in a scope that will never
re-run: a component body, an effect's **apply** phase
(`createEffect(compute, apply)`), or another imperative callback. `compute`
and JSX are tracked; `apply` is not.

The report names the signal that was read, which is not always the prop you
touched. A prop getter such as `settings={data().settings}` is
`() => data().settings`, so reading `props.settings` in an apply reports
`"data"` and sends you looking for the wrong component.

```tsx
// Wrong: the apply phase is not a tracking scope
createEffect(
  () => props.open,
  (open) => {
    setConfig(props.settings.connectionConfig);
  },
);

// Right: one explicit snapshot at open time
createEffect(
  () => props.open,
  (open) => {
    const settings = untrack(() => props.settings);
    setConfig(settings.connectionConfig);
  },
);
```

Use `untrack()` when a one-time snapshot is the intended semantics; otherwise
move the read into JSX, a memo, or the compute function.

### Branching on a prop inside a component body

A `switch` on a prop in the body picks the render branch once. That is
intentional, so say so (`switch (untrack(() => props.field.kind))`) and keep
everything inside the chosen branch reactive:

```tsx
const options = () => props.field.options ?? []; // not `const options = props.field.options`
<For each={options()}>…</For>;
```

Snapshotting inside the branch freezes the control: the native `<select>` keeps
its old option list and displayed value after the data changes.

### Modal dialogs

- `Modal` renders `<dialog>` and calls `showModal()`, so the dimming and blur
  belong on `dialog.modal::backdrop`; the sibling `.modal-backdrop` button sits
  under the top layer and only provides the click target.
- Do not use the `autofocus` attribute. Chromium rejects it while the launcher
  button still holds focus and logs `Autofocus processing was blocked`; focus
  the intended field from a ref inside the open effect instead.

### Theme switching

One effect owns `document.documentElement.dataset.theme`. The first application
is the boot palette and lands instantly; later swaps cross-fade through
`document.startViewTransition` (styled on `::view-transition-old/new(root)`),
and `prefers-reduced-motion` keeps the hard switch. The topbar button is a
binary dark/light toggle because `"system"` is owned by the Settings segmented
control — a three-state cycle makes light look stuck when the OS is light.

### Dynamic native controls

When options are rendered dynamically, setting a native `<select value={...}>`
before those options exist can display the wrong option even when state is
correct. Make the selection explicit per option:

```tsx
const current = () => (typeof props.value === "string" ? props.value : "");

<select onChange={(event) => props.onChange(event.currentTarget.value)}>
  <For each={options()}>
    {(option) => (
      <option value={option} selected={option === current()}>
        {option}
      </option>
    )}
  </For>
</select>;
```

### Async bootstrap and component bodies

Do not read an async bootstrap value in a shell component body; the framework's
untracked-read diagnostic is legitimate. Resolve bootstrap in the outer
component, then render the shell with the resolved snapshot.

The flow callback that renders the shell (`<Show when={initial()}>`) runs
untracked, so the shell must take one explicit snapshot
(`const initial = untrack(() => props.initial)`) and own its state from then on.

There is no boot splash. The window is shown after the renderer loads and the
shell paints within a few hundred milliseconds; a loading screen would only
flash and its progress bar does not represent real work. Render nothing while
bootstrap is pending and let `FatalScreen` own failures.

### Exhaustive branches

When adding a member to a discriminated union, update every switch that renders
or transforms it. A missing `case` returns `undefined` and surfaces later as
`TS7030` or a runtime blank panel.

### Solid 2 API traps

- `classList` does not exist; use `class={...}` with a string or object.
- `JSX` is exported by `@solidjs/web`, not `solid-js`.
- Default `<For>` gives `(item, indexAccessor)`; `keyed={false}` gives
  `(itemAccessor, number)`.
- Avoid reactive reads at the top of a component body; read in JSX, a memo, or
  `untrack`.

## Renderer diagnostics and styling

`pnpm dev` prints `[renderer:warning]` diagnostics from Solid's dev build.
Treat each code as a defect, not console noise.

To reproduce without Electron, point a browser at the running Vite dev server
and stub the bridge in an `addInitScript`: `window.maax.invoke` answers
`{ ok: true, value }` envelopes (a schema-valid `Bootstrap`, plus the results of
the commands the screen exercises), and `subscribe` returns an unsubscribe
function. Click through the screens, then read `console` — a stub that returns
`{ ok: false, error }` for everything else is enough to reach most UI.

Class names are the other silent failure. After a stylesheet rewrite, every class
used by `src/renderer/src/**/*.tsx` must still have a rule: a deleted block
compiles cleanly and only shows up as a misplaced control, an unstyled menu, or
an icon in the wrong corner. Extract the class names from the TSX files and diff
them against `styles.css` instead of eyeballing the CSS.

## Effect 4

- This repo uses Effect 4. `Effect.catchAll` is a v3 name; use `Effect.catch`.
  Run the Effect-aware lint before copying older examples.
- Public service methods should be `R = never`. Provide dependencies such as
  `FileSystem` inside the service method or layer, not through the public API.
- Name layer dependencies explicitly when inference is ambiguous; use a
  `WithDeps` layer type rather than casting.
- `ManagedRuntime` must include every service used at module boundaries,
  including event buses.
- Annotate ambiguous `Effect.tryPromise` / Schema decode results. Inline decoded
  types can collapse to `never`; define a `Schema.Schema.Type<typeof X>` alias
  and annotate the `try` return.
- Do not `await` inside `Effect.gen`; use `yield* Effect.promise(...)` or
  `yield* Effect.tryPromise(...)`.
- Keep typed errors in the error channel. Normalize external failures once at
  the adapter boundary instead of throwing unknown values through services.
- `Effect.runPromise` / `runtime.runPromise` belong at IPC handlers, event
  handlers, `onSettled`, and tests, not in render computation.
- `effect/FileSystem` is the only filesystem service in Effect 4 and is
  annotated `@stability unstable` upstream. `.oxlintrc.json` scopes the
  `unstable-api-usage` diagnostic to the modules that own that boundary
  (`json-store`, `settings`, `core-registry`, `workspace`, `runtime`); put new
  filesystem code in one of them instead of adding another exception.
- Cross-boundary numbers use `Schema.Finite`, not `Schema.Number`, so `NaN`,
  `Infinity` and `-Infinity` are rejected at the IPC edge.

## IPC and shared contracts

- Cross-boundary data lives in one schema module. Infer types from the schema;
  do not create parallel hand-written interfaces.
- A new command touches the whole chain atomically: command/result schema,
  channel map, preload allowlist, renderer Effect service, main handler, and
  tests.
- Decode on both sides. A payload that is valid in the renderer but not in main
  is still an untrusted value.
- Keep the preload surface minimal; do not expose raw Electron APIs or a generic
  `ipcRenderer` bridge.
- Result envelopes should preserve enough structure for the renderer to show a
  typed failure without parsing strings.

## Native process isolation

Native libraries that install global signal handlers, maintain global state, or
invoke callbacks on a blocked thread must not run in Electron's main process.
Use a utility process/worker, one host per core version or resource set.

- Callback handlers must only enqueue raw events. No lifecycle calls, blocking
  FFI, disk writes, or logging fan-out inside the callback; do it after it
  returns.
- Filter `process.env` before `utilityProcess.fork`; Electron accepts only
  string values and an `undefined` value aborts startup.
- Correlate callbacks with the same ID used by waiters. A random session ID can
  time out even though callbacks are arriving.
- Preserve the native library's initialization order and root-directory
  contract. Validate required files before registering a core/resource.
- Use the library's buffer-size sentinel and retry budget; do not hard-code a
  pointer or assume one buffer size is enough.
- Do not send partial parameter objects when the native API resets omitted
  fields; send the complete object.
- Measure user-visible duration at the boundary. If the library reports its own
  timing separately, keep both and label them, rather than replacing one with
  the other.

### Host lifetime and recovery

- A host is keyed by core + resource server and shared by its devices; membership
  is `HostEntry.devices`. Attach in `ensureSession`, detach on disconnect/delete,
  and release the process when the last device leaves. Do not count connects by
  hand: the counter only grows that way and leaves orphaned processes.
- On a crash, abort in-flight connects before scheduling the retry. A connect
  that is still waiting on its 60s timeout otherwise reports a stale failure over
  an already healthy retry.
- A connect attempt must settle the device state on **every** exit path, not just
  the "MaaCore rejected it" branches: missing core, host start failure, session
  create failure, request error and the wait timeout all raise an error, and the
  `connecting` badge is what the UI reads. Leaving it set strands the device on a
  connect that never finishes and keeps the connect button (and the "disconnect
  before removing" guard) disabled. Settle it from one `Effect.tapError` owner,
  and ignore late failures from an attempt that a newer one superseded.
- `adb connect` has no timeout of its own: against an unreachable address it can
  block for minutes, and `AsstAsyncConnect` cannot be cancelled, so MaaCore never
  emits `Connect`/`ConnectFailed`. Probe the address in `services/adb.ts` (hard
  `execFile` timeout, `get-state` fallback so a refused connect still passes for
  an address the adb server already knows) before starting the MaaCore call; the
  waiter timeout is only the backstop.
- Retries are gated on intent: an explicit disconnect, a device delete, or
  shutdown clears it, so a retry that fails afterwards cannot start a new chain
  behind the user.
- Never resume a run after a host crash. Mark the interrupted queue failed;
  resuming could spend sanity, medicine or Originite twice.

### Resource updates

- The resource stamp in `resource/version.json` is read from disk at use time.
  The registry copy is a display cache; trusting it lets a stale value skip a
  real update.
- A resource update is an overlay: back up every file that will be replaced or
  added, move files into place atomically, and leave the previous bytes
  restorable. Imported cores may live on another filesystem than the cache, so
  `rename` needs an EXDEV fallback.
- Write nothing while a device holds a session on that core, and stop the core's
  hosts first — MaaCore keeps resource state in the process.
- Label a backup with the stamp it restores to, not the one it applied.

### Component updates

- Installing a core is additive: new directory, new registry entry. Never write
  into the directory of a running core.
- Activation is a separate step. Switch the active core only when no session
  exists; otherwise leave the selection alone so a running device keeps its
  core until it disconnects.
- Only platform suffixes the core host can actually load belong in
  `platformSuffixFor`; a wrong asset produces a "ready" core that cannot start.

### Task plans and task types

- A plan mutation must broadcast `plans-updated`. The renderer keeps its own
  plan list; a stale list silently drops a plan switch because the select value
  points at an option that does not exist yet.
- New task types touch four places at once: `TaskTypeSchema`, an entry in
  `TASK_DEFINITIONS`, `getTaskDefaults`, and `buildMaaTaskParams` (plus
  `TASK_PALETTE_ORDER`). The exhaustive switches fail the type check if one is
  missed — do not cast around them.
- Required fields are validated in the main process before the first task is
  appended, so a missing copilot file cannot leave a half-built queue.
- A copilot batch's `copilot_list[].id` must be the entry's **position** in the
  whole list: the core sends it back with progress events. Never use the local
  item id or the PRTS id there.
- Copilot is **not** a queue task: it lives in its own tab, keeps its setup in
  `config/copilot.json` and starts a run with no `planId`. Do not add it back to
  `TASK_PALETTE_ORDER`; a first clear is one-off, everything after it uses the
  game's own auto-battle inside the Fight task.
- Copilot `difficulty` is a bitmask (1 normal, 2 raid, 3 both), not an enum.
  Expanding "both" into two entries that share one file is what makes a normal
  and a raid run back to back possible.

### PRTS traffic

- Never call `fetch` on prts.maa.plus outside `PrtsClient`. The client owns the
  request queue (one in flight, 750 ms gap) and the response cache; a stray
  `fetch` bypasses both and the site is a community service.
- The renderer must not search on keystroke. Searches run on an explicit action
  and only the stage autocomplete is debounced; anything that re-queries on
  every render will hammer the API.
- `document` is the full-text keyword (stage/operator/author/description);
  `level_keyword` expects the internal stage id, not a display code. Do not pass
  `document=true` — it is a keyword, so it searches for the text "true".
- The level catalogue is cached on disk with its ETag for 12 hours. Do not lower
  that TTL to "always fresh": 690 KB per hit is exactly the pressure we are
  trying to avoid.
- Operator data is local (`<core>/resource/battle_data.json`). PRTS keys its
  `operator` filter on the Chinese name, so send `name`, never `name_en`.

### Event handlers and signals

- Solid batches signal writes inside an event handler: reading `operator()`
  right after `setOperator(...)` still returns the previous value. Handlers here
  build the next snapshot explicitly and pass it to the async call
  (`commit({ operator }) → search(page, filters)`); re-reading state you just
  wrote silently searches with the old filter and looks like "the button does
  nothing".
- Solid also flushes DOM updates per microtask: a second click in the same tick
  still reaches the handler even though the first click set `busy`. Guard every
  mutating connect/start/stop handler with a local in-flight flag; a shared
  `busy` signal set inside `send` is too late when the handler awaits a plan
  flush first.
- Derive the primary action from run state, not only connection state:
  `preparing`/`running` must turn the overview CTA into Stop, `connecting` must
  disable it, and a missing plan/enabled task must navigate to the owning page
  instead of returning silently. The terminal `run-updated` event already owns
  the stop toast; do not notify again in the command handler.

## Log severity mapping

Callback message IDs are not a severity scale. Map payload types to user-facing
levels in one formatter:

- Expected branch exits and ordinary recognition misses are debug/info.
- Actionable failures (start/stop failure, recognition failure, corrupt
  resource, operation aborted) are errors.
- Always use the most specific payload field available (`first`, `subtask`,
  `taskchain`) instead of emitting `unknown`.
- Add a formatter test for both an expected noisy event and a real failure.

## Packaging

- A native addon used at runtime belongs in `dependencies`, not
  `devDependencies`; build scripts must be explicitly allowed by the package
  manager.
- Unpack native binaries from the asar and verify the packaged `.node` exists.
- Build every main entry the app forks, not only the Electron entry.
- Keep `npmRebuild: false` only when shipping a known prebuilt addon.
- Do not expose remote debugging in production.
- External resources are not bundled; a missing resource/core must produce a
  clear setup error, not a window crash.
- Builder warnings about optional platform binaries are expected on a
  single-platform build, but the matching binary and a successful launch are
  required before calling them harmless.

### Startup measurement

`pnpm bench:startup` compares `linux-unpacked`, AppImage and
`electron app.asar` using env-gated `MAAX_BOOT_TRACE` markers; see
`docs/startup-benchmark.md`. Measure spawn → first AppShell frame, sample PSS
after the app settles, and keep tracing opt-in so normal startup performs no
trace file I/O. Linux packaging choices can dominate startup: benchmark AppImage
toolset/compression changes with the artifact on the same filesystem.

## Verification matrix

| Change             | Minimum check                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Reactive control   | update twice; verify focus, visual selection, and persisted value                                     |
| Reactive warning   | `pnpm dev` console stays free of `STRICT_READ_*` / `PENDING_ASYNC_*` while exercising the screen      |
| Stylesheet rewrite | every class used by TSX still has a rule; screenshot affected screens in both themes                  |
| Modal              | open it from a focused launcher: focus lands inside, Esc and backdrop close                           |
| Dynamic list       | add/remove/reorder; confirm no unexpected remount                                                     |
| Effect service     | type check, layer boot, and one failure path                                                          |
| IPC contract       | invalid payload is rejected; valid payload round-trips                                                |
| Native host        | connect, perform one operation, stop; inspect native log                                              |
| Device connect     | connect an unreachable address: fails within the ADB probe timeout and the device leaves `connecting` |
| Log formatter      | expected branch is not error; real failure is error                                                   |
| Packaging          | build, launch unpacked app, load a core/resource                                                      |

Add tests only where the contract is stable: schemas, pure mappers, severity
classification, parser output. Avoid brittle DOM tests for screens that are
still changing quickly.

## Portability

Use repo-relative paths and runtime APIs such as `app.getPath("userData")`.
Do not put machine-specific absolute paths, usernames, device addresses, or
downloaded binary locations in skills, `AGENTS.md`, README, or docs.
