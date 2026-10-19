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

## Verification matrix

| Change           | Minimum check                                                     |
| ---------------- | ----------------------------------------------------------------- |
| Reactive control | update twice; verify focus, visual selection, and persisted value |
| Dynamic list     | add/remove/reorder; confirm no unexpected remount                 |
| Effect service   | type check, layer boot, and one failure path                      |
| IPC contract     | invalid payload is rejected; valid payload round-trips            |
| Native host      | connect, perform one operation, stop; inspect native log          |
| Log formatter    | expected branch is not error; real failure is error               |
| Packaging        | build, launch unpacked app, load a core/resource                  |

Add tests only where the contract is stable: schemas, pure mappers, severity
classification, parser output. Avoid brittle DOM tests for screens that are
still changing quickly.

## Portability

Use repo-relative paths and runtime APIs such as `app.getPath("userData")`.
Do not put machine-specific absolute paths, usernames, device addresses, or
downloaded binary locations in skills, `AGENTS.md`, README, or docs.
