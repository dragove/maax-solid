---
name: maax-maintenance
description: Maax maintenance guardrails. Use when editing task forms or Solid fields, Effect services/layers, IPC schemas, the MaaCore utilityProcess/callbacks, run-log formatting, screenshots, Fight stage/series options, or Electron packaging in this repo.
---

# Maax maintenance guardrails

Read [`.agents/skills/solid2/SKILL.md`](../solid2/SKILL.md) before changing TSX.
This file is not a Solid/Effect primer: it records the repo-specific traps that
have already caused regressions. When a rule and the current code disagree,
investigate the history before "fixing" the rule.

## Start here

1. **Classify the boundary.** Renderer-only field → Solid rules. Main-process
   service → Effect rules. Core/FFI → utility-process rules. Crossing IPC →
   update the schema/channel/bridge/handler chain first.
2. **Read the owning file.** Do not patch a symptom in a leaf component when the
   state is rebuilt in `AppShell`, `Tasks`, or a main-process service.
3. **Verify with the real path.** Form behavior: focus/selection in the running
   app. Core callbacks: inspect the actual callback payload, not only the UI
   label. Packaging: launch `dist/linux-unpacked/maax`.
4. **Finish with**: `pnpm check`, `pnpm test`, `pnpm build`; `pnpm package` when
   the change can affect packaged runtime.

## Solid 2: forms and editable lists

### Editing a row must not remount the form

**Symptom:** typing one character pauses the input, focuses are lost, and the
"Saving" indicator flashes after every keystroke.

**Cause:** `<For>` defaults to keying by object identity. Immutable task
updates replace the edited object, so the whole row is destroyed and recreated.

**Rule:** use `keyed={false}` for editable rows. The callback receives an
accessor and a **plain number** index:

```tsx
<For each={props.plan!.tasks} keyed={false}>
  {(row, index) => {
    const task = () => row();
    return (
      <TaskCard
        task={task()}
        onRemove={() => props.onRemoveTask(task().id)}
        onDragStart={() => setDragFrom(index)}
      />
    );
  }}
</For>
```

Do not write `index()` under `keyed={false}`. Do not pass `task` itself (the
accessor) as a value prop; pass `task()` and let the child read `props.task`.

### Never freeze a prop value in a component body

`FieldControl` is created once and receives new props. Locals such as
`const selected = Array.isArray(props.value) ? ... : []` go stale; the summary
outside may update while chips/selects stay visually wrong.

Use a function or memo for every value that can change:

```tsx
const selected = (): Array<string | number> =>
  Array.isArray(props.value) ? (props.value as Array<string | number>) : [];

const on = () => selected().some((value) => sameOption(value, option.value));
```

The same applies to `select`: keep `current` as `() => ...` and compare inside
`<option selected={String(current()) === String(option.value)}>`. Setting a
native `<select value={current}>` before its dynamic options mount can display
the wrong option even when the stored value is correct.

### Task-form checklist

- Add a field kind → update the `FieldKind` union **and** every `FieldControl`
  switch. A missing branch returns nothing and trips `TS7030`/`TS2322`.
- New task type → add its defaults, field definitions, catalog icon, and
  `buildMaaTaskParams` mapping in `src/shared/tasks.ts`.
- Defaults only apply to newly created tasks. Existing saved plans keep their
  stored params; migrate explicitly or tell the user.
- Do not use `classList`; Solid 2 uses `class={...}` (string/object accepted).
- `JSX` comes from `@solidjs/web`, not `solid-js`.
- `<For keyed={false}>` index is a number; default `<For>` index is an accessor.
- Avoid reactive reads at the top of a component body. Read in JSX, a memo, or
  `untrack`. The compiler's strict-read diagnostics are real design feedback,
  even when a particular warning appears to be a false positive.

### Async bootstrap

Do not read an async bootstrap value in `AppShell`'s component body
(`PENDING_ASYNC_UNTRACKED_READ`). Load bootstrap imperatively in the outer
`Workbench`, then render `<AppShell initial={resolvedSnapshot} />` only after it
resolves. Keep the resolved snapshot immutable for the shell's lifetime.

## Effect 4: services, layers, IPC

- This repo uses **Effect 4**. `Effect.catchAll` is a v3 name; use
  `Effect.catch`. Check diagnostic `outdated-api` before copying examples from
  older Maa/Effect code.
- Public service methods should be `R = never`. If a method needs `FileSystem`,
  provide it at layer construction or with `Effect.provideService(FileSystem, fs)`
  inside the method; do not leak a new requirement through the API type.
- Compose layers explicitly. When a service needs another layer, name the
  dependency type (see `CoreInstallerWithDeps`) rather than relying on inference.
- `ManagedRuntime` must include services used at module boundaries, including
  `EventBus` when event emission happens outside a request.
- Annotate ambiguous `Effect.tryPromise` / schema results. A decoded schema type
  assigned inline can collapse to `never`; define
  `type X = Schema.Schema.Type<typeof XSchema>` and annotate the `try` return.
- No `await` inside `Effect.gen`; use `yield* Effect.promise(...)` or
  `yield* Effect.tryPromise(...)`. Do not swallow typed errors with a bare
  `try/catch`; use Effect's error channel.
- `Effect.fail(maaxError(...))` is a warning because `maaxError` is already
  yieldable; prefer `yield* maaxError(...)` in generators when the type allows.
- IPC changes are atomic: `src/shared/schemas.ts` → `src/shared/ipc.ts` command
  and result maps → preload → `DesktopBridge` result schema → main handler →
  tests. Both sides decode; do not hand-write a parallel result interface.
- Renderer-side `runtime.runPromise` belongs in event handlers, `onSettled`, or
  Effect boundaries — not in JSX/render computation.

## MaaCore utility process

MaaCore must never be loaded into Electron's main process. It installs global
signal handlers, and koffi callbacks run on the Node main thread while the core
message thread is blocked. Keep one utility process per core version/resource.

- Callback contract: enqueue the raw callback immediately; do no FFI, logging
  fan-out, process control, or `AsstDestroy` inside the callback. Destroy only
  after the callback returns and the command chain is idle.
- Filter `process.env` before `utilityProcess.fork`; Electron types allow only
  string values and an `undefined` value causes `Invalid value for env`.
- Use the **device id as the session id** when waiters such as connect are keyed
  by device. A random session id silently times out even though callbacks arrive.
- Initialize in this order: `AsstSetUserDir(existing writable dir)` →
  `AsstLoadResource(packageRoot)`. The load root contains `resource/config.json`;
  a global override is `<root>/resource/global/<Server>`.
- Parse core versions as semver: `v6.20.0-linux-x86_64` is version `v6.20.0`,
  not the whole filename.
- Image API: try 8 MiB, retry 16 MiB, and use the library's null-size sentinel
  rather than a hard-coded pointer value. Force a fresh image with
  `AsstAsyncScreencap(handle, 1)` before `AsstGetImage`.
- Show two screenshot timings: measured request duration, and the core's
  `ScreencapCost` (a `ConnectionInfo` message, not `SubTaskExtraInfo`) when it
  arrives. Core reports min/avg/max periodically, so measured time must still
  work on the first screenshot.
- Never call `AsstSetTaskParams` with a partial object when the API resets
  omitted fields; send the complete task param object.
- Core downloads: require a native user confirmation, download to a staged
  directory, extract the archive, validate `resource/config.json` +
  `libMaaCore.so`, then register atomically. Dev-only URL/confirmation overrides
  must be disabled when packaged.

### Fight series and stages

- `series` is an integer and the GUI must not compute AUTO: `0` = MaaCore auto,
  `-1` = leave the in-game setting alone, `1..10` = fixed. New tasks default to
  `0`.
- Core accepts `7..10` only when the active resource supports the new series
  list. On old/global resources an invalid value rejects the **entire** Fight
  parameter update. Keep the UI warning, or detect the resource flag before
  sending.
- Stage recommendations: fetch `gui/StageActivityV2.json` per client
  (`Bilibili` uses the `Official` key), filter by `UtcStartTime` /
  `UtcExpireTime` / `TimeZone`, preserve API order, and merge with the curated
  permanent list. The API order is the de-facto recommendation; WPF does not
  have a scoring algorithm.
- The stage field must accept manual codes. Do not replace free text with a
  closed dropdown.

### Callback log semantics

`SubTaskError` (20000) is not uniformly a warning. `ProcessTask` emits it for
ordinary recognition misses and expected branch exits (`CreditShop-NoMoney`,
`EndOfClueExchange`, etc.). WPF only surfaces:

- `AutoRecruitTask`
- `RecognizeDrops`
- `StartGameTask` / `StopGameTask`
- `DepotRecognitionTask` with `DepotTemplateLoadError`

Format those as errors; demote everything else to debug and use
`payload.first[0]` (or `subtask`/`taskchain`) so logs never say `unknown`.
`ScreencapCost` and `FastestWayToScreencap` are debug-level connection info.

## Electron and packaging

- `koffi` is a runtime dependency, not a dev dependency. Keep
  `allowBuilds.koffi` in `pnpm-workspace.yaml` and `asarUnpack` for
  `node_modules/koffi/**` + `node_modules/@koromix/**`.
- electron-vite needs both main inputs: the app entry and the core-host entry.
  The dev core-host path and the packaged asar path must both be valid.
- Do not expose the remote-debugging port in production; it is a dev-only
  facility.
- `npmRebuild: false` is intentional for the prebuilt koffi addon. Verify the
  `.node` exists under `app.asar.unpacked` after packaging.
- electron-builder's "platform-specific optional dependencies not bundled"
  warning is expected on a Linux x64 build; confirm the Linux binary is present
  and the packaged app actually starts before treating it as benign.
- Core/resource trees are external (imported/downloaded), not bundled; the app
  must fail with a clear setup state, not crash the window.

## Verification matrix

| Change                | Minimum verification                                                |
| --------------------- | ------------------------------------------------------------------- |
| Task field / form     | type a full value, check focus and saved params; toggle every chip  |
| Select / stage picker | open the menu, filter, select, reopen, verify persisted value       |
| Core callback / log   | feed the real payload; check debug vs error level                   |
| Screenshot            | connect a device, take a screenshot, check dimensions + timing      |
| IPC / schema          | reload renderer, verify both decode paths and a failed payload      |
| Core host / FFI       | connect, screenshot, start + stop a run; check core log for errors  |
| Packaging             | `pnpm package`, launch the unpacked binary, connect and load a core |

Run `pnpm check` and `pnpm build` on every change. Add a test only where the
boundary is stable and the invariant is worth pinning (schema mapping, log
severity, stage parsing); avoid brittle DOM/UI tests for this rapidly changing
MVP.

## Keep documents portable

Do not put machine-specific absolute paths, device addresses, usernames, or
downloaded-core locations in this skill, `AGENTS.md`, README, or docs. Use
repo-relative paths and generic runtime locations such as
`app.getPath("userData")`.
