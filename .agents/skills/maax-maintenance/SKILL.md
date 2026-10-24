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
- **Entity lists that update in place need the entity's own id.** A bootstrap
  reload, a `tools-updated` scan batch, a history append or a batch save
  decodes a whole new array, so identity keying remounts every row: entrance
  animations replay (`.copilot-item`, `.device-shot-image`), a hundred-row grid
  is rebuilt per batch, and mounted state is thrown away. Use
  `keyed={(row) => row.id}` (or `itemId`, `profile.id`) and read `row()`.
  Lists that only change when the user re-fetches them (core rows) may keep
  identity keying: the remount there is the refresh.
- **Fixed-position slot lists rebuild their array on every parent update.** The
  `SwapStack` action slot, the `Segmented` options and the setup steps all pass
  freshly built arrays, so they must be `keyed={false}`; otherwise the slot
  spans are recreated and the cross-fade never runs. The wrappers survive, but
  the JSX the caller passes as a slot node is still rebuilt with the array — do
  not put an entrance animation on it.
- Filtering a list of stable entity objects needs no key; keying matters when
  the source array is re-decoded (bullet above). A derived array of freshly
  built descriptors (`steps()`, `[{ id: "run", node }]`) can never match by
  identity, so `keyed={false}` is the only useful keying there.
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
move the read into JSX, a memo, or the compute function. A whole imperative call
can be the snapshot: `void untrack(() => search(1, currentFilters()))` covers the
filters it reads _and_ the `loading()` guard inside `search` — that is
`CopilotBrowser`'s first-search effect.

### Non-idempotent effect applies

`Collapse` measures `scrollHeight`, so its apply may only run on a real
open/close flip. An open `StagePicker` flyout is absolutely positioned but still
counts into that `scrollHeight`, so a re-run on unrelated churn (any keystroke
into a task param) grows the card to the menu height and snaps it back. Refresh
effects keep the same guard by key: `Runs` `lastDeviceId`, `CopilotBrowser`
`searched`, `AppShell` `lastCoreKey`.

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

### Motion

Fluent 2 motion tokens live in `styles.css`: `--duration-faster/fast/normal/gentle`,
`--ease-out` (decelerate), `--ease-in` (accelerate) and `--ease-standard`
(easy-ease). Larger surfaces get more time; hover/focus/selection feedback
stays around 120ms.

Pick the curve by what the element does, not by open/close:

- **Entrances** (surfaces, flyouts, dialogs): `--ease-out` — arrive fast, settle.
- **Leaving the frame** (the toast slide-out): `--ease-in` — it is already on its
  way off-screen.
- **Changing size or opacity in place** (collapse in _either_ direction, dialog
  dismissal, page cross-fade, sliding selection): `--ease-out` (or
  `--ease-standard` for a symmetric move). `--ease-in` is wrong here: on a
  collapsing height it holds the layout still and then snaps the section shut,
  and on a fading dialog it keeps the panel on screen before blinking it out.
  That was a reported bug — do not reintroduce it.

- Page switches are a View Transition scoped to the content area. `navigate()`
  in `AppShell.tsx` wraps `setView` in `document.startViewTransition` plus
  `flush`; `.content` carries `view-transition-name: content`, so the sidebar
  and topbar are not captured. Never wrap every `setView` call again by hand,
  and never add a CSS entrance to `.page` — the new snapshot would be captured
  mid-fade. A reload or a second transition while one is still running makes
  Chromium skip the first and reject its own `ViewTransition.ready` with
  `AbortError: Transition was skipped`; two empty
  `document.startViewTransition` calls reproduce it, so it is platform noise,
  not an app error.
- Animate the element that is created, not its page: cards, flyouts, empty
  states, list rows and dialogs carry their own entrance.
- Solid disposes a `<Show>` branch as soon as the condition flips, so an exit
  needs the component to keep the element mounted for one beat. Only `Modal`
  and `Toaster` own that timer (durations in `src/renderer/src/motion.ts`,
  classes `--closing` / `--leaving`). Entry-only is the default; do not add an
  exit timer to every list row.
- A "closing" signal set from a `createEffect` is too late to keep a `<Show>`
  mounted: the branch is already disposed and would remount, which resets its
  scroll and focus mid-fade. Arm a `hold` signal while the surface is open and
  let the exit timer release it, so the condition never reads false.
- Close the dialog when its exit beat ends, in the same task as the unmount.
  Disposing an element that still reports `open` skips the browser's own dialog
  cleanup (including focus restoration for a modal host); closing it early
  instead drops the `::backdrop` mid-fade.
- Expanding content uses `Collapse` (`components/ui/Collapse.tsx`): it keeps
  the children mounted through the exit, animates the wrapper height and
  releases the clip when done. Passing a render function (`{() => <div/>}`)
  keeps the children lazy. Do not add an entrance animation to a child that a
  `Collapse` already wraps — measure and fade would fight each other.
- A toolbar control that swaps between different labels goes in a `SwapStack`
  (`components/ui/SwapStack.tsx`). Every state stays mounted, so the slot keeps
  the widest size and the switch cross-fades instead of jolting the layout;
  `visibility: hidden` removes the inactive copies from the tab order.
- A segmented control uses `Segmented` (`components/ui/Segmented.tsx`): the
  highlight is a measured element that slides between options, and locale
  changes remeasure it through a ResizeObserver.
- Never animate high-frequency content (log lines, progress values). Also do not
  put an entrance on a row whose data is replaced in place: `<For>` remounts the
  row and the animation replays as flicker.
- `prefers-reduced-motion` collapses every duration in one block at the end of
  `styles.css`; JS-side exit beats skip their delay through
  `prefersReducedMotion()`. The loading spinner is status, not decoration, and
  keeps turning.

### Dynamic native controls

Solid 2 writes `<select value>` through `writeSelectValue`: it tries the value,
remembers it, and re-applies it in a microtask, so options rendered in the same
frame are covered. Options that arrive later (an async list, hydration) are not
— the select then shows its first option while state says otherwise. Make the
selection explicit per option, which also keeps the display correct when the
option list or the locale is rewritten:

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
- **Class expressions are array/object form.** `class={["btn", { "btn--danger":
  danger() }]}` — no template literals stitching a base onto conditionals, and
  no `filter(Boolean).join(" ")`. A pure dynamic suffix stays a template
  (`class={["log-line", `log-line--${level}`]}`). Falsy array entries are
  skipped, so `props.class` can sit in the array. Modifier keys need quotes —
  `{ "toast--leaving": leaving() }`; `--` is not legal in a bare object key.
- `JSX` is exported by `@solidjs/web`, not `solid-js`.
- Default `<For>` gives `(item, indexAccessor)`; `keyed={false}` gives
  `(itemAccessor, number)`; a key function gives accessors for both.
- `<Errored>`'s `fallback` receives an **error accessor**, not the thrown
  value: `fallback={(error) => <p>{describeError(error())}</p>}` (that formatter
  lives in `effect/desktop.ts`, see IPC below). Rendering `error` prints the
  accessor's source.
- Avoid reactive reads at the top of a component body; read in JSX, a memo, or
  `untrack`. Flow callbacks (`<For>`, `<Show>`, `<Match>`) are owners, not
  tracking scopes: read their accessor arguments in JSX, not in the callback's
  first statements.
- **`onSettled` never runs if its owner disposes before the first settle** —
  the setup and the cleanup it returns are both dropped. So DOM teardown that
  must always happen registers `onCleanup` in the component body (`Modal`
  closing a still-open `<dialog>`, `Collapse` cancelling its animation,
  `CopilotBrowser` clearing its debounce timers, `createRuntime` disposing the
  managed runtime). Reach for `onSettled`'s returned cleanup only for work that
  genuinely starts after the first settle.

## Renderer diagnostics and styling

`pnpm dev` prints `[renderer:warning]` diagnostics from Solid's dev build.
Treat each code as a defect, not console noise.

### Driving the real renderer

Prefer the real Electron host over a stubbed browser: it keeps the preload
bridge and the dev-grade Solid build, so diagnostics are live.

1. `pnpm exec electron-vite dev --remoteDebuggingPort <port>`; read the
   `DevTools listening on ws://127.0.0.1:<port>` line for the port it actually
   bound.
2. `curl -s http://127.0.0.1:<port>/json/list` for the page target.
3. Drive it over CDP: `Runtime.enable`, then `Runtime.evaluate` to click
   `.nav-item` / open cards and to read the DOM back; collect
   `Runtime.consoleAPICalled`, `Log.entryAdded` and `Runtime.exceptionThrown`.
   Walk the views with a pause between clicks so the View Transition settles.
4. `window.maax` comes through contextBridge, so reassigning `invoke` from the
   page does not take effect and an on-the-fly failure stub cannot be installed
   there. For the no-core / failure screens run the built app against a throwaway
   profile:
   `pnpm exec electron out/main/index.js --user-data-dir=<temp dir>`.
   Afterwards delete config the probe wrote (a toggled schedule or locale) so
   the next run starts from the user's real state.

Stubbing stays the fallback for when Electron cannot run: point a browser at the
Vite dev server and install the stub before navigation
(`Page.addScriptToEvaluateOnNewDocument`). `window.maax.invoke` answers
`{ ok: true, value }` envelopes (a schema-valid `Bootstrap`, plus the results of
the commands the screen exercises), and `subscribe` returns an unsubscribe
function; a stub that returns `{ ok: false, error }` for everything else reaches
most UI.

An `animation: name …` whose `@keyframes` was deleted is silent too, so keep
keyframes and references together.

Class names are the other silent failure, in both directions. A class used by
TSX but missing from `styles.css` shows up as a misplaced control, an unstyled
menu or an icon in the wrong corner; a rule nothing references is dead CSS
(`.panel-icon`, the duplicated `.page--tools` block). Audit mechanically instead
of eyeballing:

- Every class literal in `class="…"` / `class={…}` is a candidate. Normalize
  each template's `${…}` to `*` and match CSS selectors by prefix **and**
  suffix, or one dynamic family (`log-line--*`) hides every variant behind a
  single "missing" entry.
- Strings inside the same `class={…}` expression that are comparison operands
  (`=== "running"`) are not classes; a naive scan reports them as missing rules.
- Run it both ways before shipping: no class without a rule, no rule without a
  class.

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
  annotated `@stability unstable` upstream. `.oxlintrc.json` `overrides` turns
  `effecttsgo/unstable-api-usage` off for the six modules that own that
  boundary (`json-store`, `settings`, `core-registry`, `workspace`,
  `copilot-setup`, `runtime`); `pnpm check` is clean, so any new occurrence is a
  module that took the service without joining the list. Put new filesystem code
  in one of them instead of growing the list.
  `json-store`'s `writeJson` already creates the parent directory (`recursive`)
  and `readJson` falls back when the file is missing, so a store does not need
  its own `makeDirectory`.
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
- Renderer failures have one formatter: `effect/desktop.ts#describeError` turns
  a `DesktopBridgeError` into `operation: reason` and anything else into its
  message. Toasts, the log mirror and `<Errored>` fallbacks all use it; do not
  rebuild the message inline or print the raw error object.

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
- Hosts are shared by core + resource server across devices. When testing
  multi-device behavior, verify the host count does not grow per device and a
  removed or disconnected device is detached from `HostEntry.devices`.
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

### Tools and run activity

- OperBox and Depot results arrive as `SubTaskExtraInfo` (`msg === 20003`)
  callbacks with `what: "OperBoxInfo"` / `"DepotInfo"`; parse them in
  `src/shared/tools.ts` and persist the latest snapshot per device. Depot's
  `details.data` is a JSON string of `itemId -> count`, and item names come
  from the active core's `item_index.json`. Never add a native API for this.
- The recruitment calculator is pure renderer/shared code over
  `recruitment.json` + `battle_data.json`. Tag ids stay Chinese because that is
  the key the game and MaaCore use; localize only the label.
- Record a terminal run exactly once. `recordRun` owns the history write and
  guards on `RunState.recorded`; completion callbacks, stop and host crashes all
  funnel through it. Do not record from the renderer or from an event handler.
- Schedules are local-time, per-device entries in `config/schedules.json`. They
  fire only while the app runs, inside a two-hour grace window, and are marked
  started/skipped/failed before the next check. A due schedule may connect the
  device itself; it must not take the renderer's global `busy` flag.
- Tray close behavior is mirrored into `src/main/app-behavior.ts` because the
  window close handler runs outside Effect. `window-all-closed` must keep the
  app alive when close-to-tray is enabled and a tray exists; otherwise a
  programmatic window close would strand a hidden process.
- Log/diagnostics exports are local only. The diagnostics folder intentionally
  includes device addresses and paths, so document that before sharing.

New small stores (`history`, `schedules`, `tools`) use the plain atomic
`json-file.ts` helper instead of adding another exception to the unstable
`effect/FileSystem` boundary list. Keep writes serialized and atomic; do not
write JSON with a bare `writeFile` in place.

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
  into the directory of a running core. An install/download must not take the
  renderer's global `busy` flag either: the active core keeps serving runs, so
  tasks stay startable while the new version downloads. Gate the core buttons
  with `coreBusy` instead; only commands that change run/device state own
  `busy`.
- Activation is a separate step. The automatic switch after an install waits
  for no live session and no active run; a manual switch is allowed while a
  device is connected but is refused while a run is preparing or running (main
  returns a typed error, Settings disables the button and shows a hint).
- Only platform suffixes the core host can actually load belong in
  `platformSuffixFor`; a wrong asset produces a "ready" core that cannot start.
- Repair re-downloads the **current** version and swaps the managed directory
  through a staging copy; restore the old tree if extraction or rename fails.
  Move relocates a managed core and then revalidates its registry entry, and is
  refused while a session holds that core. Imported cores are never moved or
  repaired automatically.

### Task plans and task types

- A plan mutation must broadcast `plans-updated`. The renderer keeps its own
  plan list; a stale list silently drops a plan switch because the select value
  points at an option that does not exist yet.
- New task types touch six places at once: `TaskTypeSchema`, an entry in
  `TASK_DEFINITIONS`, `getTaskDefaults`, `buildMaaTaskParams`,
  `TASK_PALETTE_ORDER` and `TaskCard`'s `summaryFor`. The exhaustive
  switches fail the type check if one is missed — do not cast around them.
- The stage picker's list is built in the main process: a hard-coded permanent
  list plus the live windows of `StageActivityV2.json` from `api.maa.plus`,
  cached per `client:locale` for ten minutes. A failed fetch still returns the
  permanent list with `warning` set, which the renderer shows as a `warning`
  toast, not an `error`.
- Required fields are validated in the main process before the first task is
  appended, so a missing copilot file cannot leave a half-built queue.
  `firstMissingField` honours `visibleWhen`: SingleStep requires the stage only
  in "set stage" and the operator/location only in "single action". A required
  field the form hides would block the queue with no way to fill it.
- A `file` field declares `accept`. Copilot JSON goes through
  `copilot.import` (validated and copied into `userData/copilot`);
  VideoRecognition records `accept: "video"`, is picked through `videos.pick`
  and keeps the raw path because MaaCore reads the file itself.
- A copilot batch's `copilot_list[].id` must be the entry's **position** in the
  whole list: the core sends it back with progress events. Never use the local
  item id or the PRTS id there.
- Copilot is **not** a queue task: it lives in its own tab, keeps its setup in
  `config/copilot.json` and starts a run with no `planId`. Do not add it back to
  `TASK_PALETTE_ORDER`; a first clear is one-off, everything after it uses the
  game's own auto-battle inside the Fight task.
- Manual start ("单作业" row action) is MaaCore's single-file path and the only
  way to run a sandbox assignment. It is a transient run choice, not a saved
  option: the renderer sends `copilot.start` with `itemId`, main builds a
  one-item setup with `createCopilotRunTasks(..., manual = true)`, and
  `buildMaaTaskParams` sends one `filename` while omitting
  `copilot_list`/`is_raid`. The saved batch and options stay unchanged. It
  starts from the current formation screen, so the user must enter 险地 →
  沙盘推演 and select assumptions first; the core cannot select them. Only a
  normal item is selectable; choosing another row moves the target, and
  "整批运行" clears it.
- The Copilot batch is reordered by native HTML5 drag on the keyed row
  (`<li draggable>` plus a `drag-handle`), not by rebuilding the array at render
  time. Keep item-id keys so moving a row preserves its switch, detail expansion
  and single-run selection; persist the whole reordered array through
  `onItems`, and disable dragging while a run is preparing or running.
- Every batch entry has an optional `enabled` switch (missing means on). All
  task builders filter `enabled === false`; the Copilot tab's start uses only
  enabled entries, and a single-item override forces its target on so a retired
  assignment can still be re-run explicitly. Use `CopilotSetupStore.patchItems`
  for these updates: it holds a `Semaphore` so an auto-retire cannot race a
  user toggle.
- A copilot run's `RunState.copilot` tracks the enabled items, their task
  config ids and the last loaded file. On `TaskChainCompleted` a normal batch
  retires every entry; on `TaskChainError` it retires only the files loaded
  before the failing one (`lastLoaded`). SSS/paradox complete one task per file,
  so each completion retires exactly that file. Retired entries are switched
  off, and each newly completed PRTS assignment is liked once through
  `PrtsClient.postJson("/copilot/rating", { id, rating: "Like" })` — never a
  direct `fetch`, never for local files (`copilotId === 0`), and deduped because
  the two difficulty entries of one assignment share a `copilotId`.
- A Copilot assignment has two operator lists: `opers` (fixed operators) and
  `groups` (interchangeable candidates, e.g. 地刺 ⇒ 狮蝎 / 伊桑). MaaCore
  validates every member of both, so a bad requirement inside a group rejects
  the whole file even when the fixed list looks fine. `CopilotDetail` and
  `CopilotSearchItem` carry both; render groups separately with a "one of"
  label (the search row keeps its compact fixed-operator chips, the expanded
  detail shows the groups).
- Before a Copilot launch, `repairCopilotFile` normalises downloaded PRTS
  assignments: MaaCore's `parse_oper_usage` rejects a whole file when an
  operator's `requirements.elite` is lower than its `skill_level` or `module`
  implies. Raise `elite` to that minimum for operators present in the active
  core's `battle_data.json`; leave unknown names alone (MaaCore skips the
  check), and emit a warning toast naming the operator. This is why a
  syntactically valid assignment can still surface as `CopilotFileReadError`;
  that log entry now says MaaCore could not parse the file, not that reading
  failed.
- MAA's multi-assignment mode (`copilot_list`) starts at the **target chapter's
  stage map**. From the home screen or another chapter, the core only swipes
  `FullStageNavigation`, hits `ExceededLimit`, and never reaches the stage.
  Keep the prerequisite visible in the Copilot tab; do not try to automate
  chapter switching from the home screen.
- The Copilot tab keeps its own `LogStream`. Command failures (`send`) are
  appended to the log as errors, and `ExceededLimit` on
  `FullStageNavigation` is formatted as a warning that names the map-screen
  requirement. A failed resolve/start must never be toast-only.
- Every `CopilotItem` carries `kind` (`normal`/`sss`/`paradox`). Detect it
  from the SSS protocol marker and the level catalogue's `lt_`/`mem_` stage-id
  prefixes. Normal uses one `Copilot` + `copilot_list`; SSS uses one
  `SSSCopilot` per file and **no auto formation**; Paradox uses one
  `ParadoxCopilot` per file. Never send an SSS or Paradox file through the
  normal branch, and refuse a mixed batch at add and start time. Their entry
  screens differ: normal needs the target chapter map, SSS the deployment
  preparation screen, Paradox the formation screen after choosing a skill.
- All list surfaces (browser results, the browser's added summary, the Copilot
  tab and task cards) label the hard bit through `copilotModeLabelKey`: chapters
  15+ show 险地, `tough_` stages show 磨难, everything else 突袭. Do not hardcode
  `copilot.raid` in a new surface.
- Copilot `difficulty` is a bitmask (1 normal, 2 raid, 3 both), not an enum.
  Expanding "both" into two entries that share one file is what makes a normal
  and a raid run back to back possible. The site usually omits the mask on main
  story uploads: a `tough_` stage id is the 磨难 map and must resolve with
  `is_raid` (otherwise the core enters the standard stage), and the browser
  offers both modes when the mask is unset so 险地 can be chosen as a raid run.
  MaaCore has no 沙盘推演 switch — its raid task only selects 突袭/磨难/险地.
  Chapters 15+ call the hard bit 险地, so label it accordingly; a sandbox
  assignment (its details say something like 沙盘全选右) still needs the user
  to enter 险地 → 沙盘推演 and pick the assumptions manually. The copilot task
  cannot select them, and multi-assignment mode navigates to the normal/hazard
  stage first, so such an assignment must be run in single-file mode from the
  formation screen.
- The browser's "added" state is the caller's live batch (`copilot.items` for
  the tab, the task's `copilot_list` for a task card); never keep a local copy,
  or the row buttons drift from the list behind the dialog.
- Batch entries in all three lists — the browser's "added" summary, the
  copilot tab and a task card — expand the details saved in their downloaded
  JSON through the shared `createCopilotDetails` controller and the
  `copilot.detail` command. The reader is confined to `userData/copilot`
  (`isCopilotPath`); a missing, malformed or out-of-folder file returns `null`
  and the entry simply has no detail toggle. Never replace it with a generic
  file-read IPC. The controller caches the answer per entry; the browser passes
  `enabled` so its reads wait until the dialog is open, while the tab and task
  card read on mount.

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
- `busy` is not a progress flag. It disables every mutating control, so it only
  belongs to commands that immediately change run/device state. A core install
  or a device connect can take minutes; those own `coreBusy` / `connectBusy`,
  which gate only their own buttons. The connect handler is serialized by
  `connectPending`, and the per-device `connecting` badge is what the user
  watches, so plans, tasks and other devices stay usable throughout.
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
- Copilot failures arrive as `SubTaskError` with `what`
  (`CopilotFileReadError`, `CopilotStageNotSupported`,
  `UserAdditionalOperInvalid`, `OperboxDataParseFailed`) or as
  `BattleFormationTask` with `why: "OperatorMissing"` and
  `details.opers`. Map them to errors that name the file, stage, operator and
  reason. `TaskChainError` itself carries only `taskchain` (plus
  `details.error` for a caught exception), so when it has no reason append the
  chapter-map/difficulty hint. `CopilotListLoadTaskFileSuccess` uses
  `details.file_name`, `stage_name` and `id`, not `filename`.

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

## Documentation and preview images

- `docs/preview-*.jpg` are committed snapshots referenced by the README.
  Regenerate them only for a substantial redesign of the workbench, and
  compress or re-encode before committing: an extra image per small UI fix
  bloats the repository for no reader benefit. Verify a small change by running
  the app instead.
- Keep technology claims in sync in one change. The README stack table,
  `docs/architecture.md` (process diagram, Renderer section) and `NOTICE` name
  dependencies; removing a library from `package.json` leaves stale claims such
  as "Kobalte toasts" until those files are edited too. Do not pin exact
  versions in prose: the table lists ecosystems only, and `package.json` /
  `pnpm-lock.yaml` remain the source of truth, so a dependency bump never needs
  a documentation edit.
- `docs/**` is ignored by Oxfmt, so tables and ASCII diagrams there are
  hand-aligned; check line widths after editing the process diagram.

## Verification matrix

| Change               | Minimum check                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Reactive control     | update twice; verify focus, visual selection, and persisted value                                                                             |
| Motion               | sample `getAnimations()` across frames: collapse reverses mid-flight, page switch runs a `content` view transition, reduced motion skips both |
| Reactive warning     | `pnpm dev` console (or the CDP loop above) stays free of `STRICT_READ_*` / `PENDING_ASYNC_*` while exercising the screen                      |
| Stylesheet / classes | class audit both ways: no TSX class without a rule, no rule without a class; check both themes locally                                        |
| Modal                | open it from a focused launcher: focus lands inside, Esc and backdrop close                                                                   |
| Dynamic list         | add/remove/reorder; confirm no unexpected remount                                                                                             |
| Snapshot list        | replace a scan/batch/history list: only new rows enter, untouched rows keep their DOM so entrance animations do not replay                    |
| Effect service       | type check, layer boot, and one failure path                                                                                                  |
| IPC contract         | invalid payload is rejected; valid payload round-trips                                                                                        |
| Native host          | connect, perform one operation, stop; inspect native log                                                                                      |
| Device connect       | connect an unreachable address: fails within the ADB probe timeout and the device leaves `connecting`                                         |
| Log formatter        | expected branch is not error; real failure is error                                                                                           |
| Tool callback parser | partial OperBox/Depot frames replace the snapshot; malformed payload is ignored                                                               |
| Schedule             | due only on a matching local weekday, not twice, inside the grace window                                                                      |
| Tray                 | close with the window manager hides the window and keeps the process alive; tray/reopen path works                                            |
| Diagnostics          | exported folder contains summary, workspace, schedules, history, tools and logs; no upload                                                    |
| Packaging            | build, launch unpacked app, load a core/resource                                                                                              |

Add tests only where the contract is stable: schemas, pure mappers, severity
classification, parser output. Avoid brittle DOM tests for screens that are
still changing quickly.

## Portability

Use repo-relative paths and runtime APIs such as `app.getPath("userData")`.
Do not put machine-specific absolute paths, usernames, device addresses, or
downloaded binary locations in skills, `AGENTS.md`, README, or docs.
