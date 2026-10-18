# Maax architecture

Maax is an Electron desktop client for MaaAssistantArknights (MaaCore). It is
built around one rule: **the UI and the native core never share a process**.

## Process model

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer (sandboxed, contextIsolation, no Node)              │
│ Solid 2 · CSS Modules-ish global stylesheet · Kobalte toasts │
└───────────────▲─────────────────────────────────────────────┘
                │ typed IPC (Effect Schema, one command channel + one event channel)
┌───────────────┴─────────────────────────────────────────────┐
│ Main process (Electron)                                     │
│ Effect ManagedRuntime · settings/workspace · core registry   │
│ download manager · device sessions · run orchestration       │
└───────────────▲─────────────────────────────────────────────┘
                │ MessagePort protocol (requests + batched callbacks)
┌───────────────┴─────────────────────────────────────────────┐
│ MaaCore utility process (Node 24.22, one per core version)   │
│ koffi → libMaaCore.so · AsstHandle lifecycle · screenshots   │
└─────────────────────────────────────────────────────────────┘
```

### Why the core lives in a utility process

MaaCore installs process-wide `SIGSEGV`/`SIGABRT`/`SIGFPE`/`SIGILL` handlers
and exits the process on a native fault. Its koffi callback also runs on the
Node event-loop thread and blocks MaaCore's message thread while JavaScript is
executing. Hosting the core in the UI process would therefore freeze the app on
a callback and lose the window on a core crash.

One utility process per installed core version/resource additionally gives us:

- side-by-side core versions without SONAME / `RTLD_GLOBAL` collisions;
- clean upgrade and rollback (the loaded `.so` is never replaced in place);
- a supervisor that can reject pending requests and surface a typed error when
  the helper exits.

The main process never loads native code. The utility is disposable; the UI
does not know how it is implemented.

### Callback contract

- The callback validates and copies the JSON string only; it never calls a
  lifecycle API (calling `AsstDestroy` inside a callback deadlocks).
- Events are queued in the utility and flushed to the main process in batches.
- The main process parses the JSON, emits the raw event to the renderer for the
  log panel, and projects known events onto run/device state.
- All Asst calls for one session are serialized by the utility process's
  command chain.

## Core management

- `userData/config/cores.json` is the registry. Imported cores can live outside
  `userData`; downloaded cores live in `userData/cores/<version>`.
- The MaaCore archive is not bundled with the app. The user confirms the
  download from the official release API before anything is written.
- Installation is staged in `userData/cores/.install-*` and then renamed into
  place, so an interrupted download never produces a half-usable core.
- `libMaaCore.so` and `resource/` must stay together: MaaCore uses `$ORIGIN`
  RUNPATH and a full resource tree is required (all roguelike themes).
- The user data directory passed to `AsstSetUserDir` is writable and separate
  from the (usually read-only) core directory.

## Main-process services

| Service | Responsibility |
| --- | --- |
| `AppPaths` | All userData/config/core/log paths in one place |
| `Settings` | Schema-validated preferences, atomic JSON writes |
| `Workspace` | Devices and task plans, atomic JSON writes |
| `CoreRegistry` | Installed/imported cores, validation, active version |
| `CoreInstaller` | Official release metadata, confirmed download, tar extraction |
| `CoreHostClient` | utility process lifecycle and request/callback transport |
| `Application` | Device sessions, connection state machine, run projection |
| `EventBus` | Synchronous event fan-out to every BrowserWindow |

External boundaries are wrapped in `Effect.tryPromise`, typed with
`Schema.TaggedError` (`MaaxError`), and the IPC envelope carries a serializable
error. UI state is projected from snapshots and validated events; the renderer
never reads core state directly.

## IPC

`preload` exposes only:

```ts
window.maax.invoke(command, payload)
window.maax.subscribe(listener) // returns unsubscribe
```

`src/shared/ipc.ts` defines the command list and payload/result types,
`src/shared/schemas.ts` defines every runtime contract. The renderer's
`DesktopBridge` Effect Service decodes the envelope and the result with Effect
Schema. Unknown commands and invalid payloads are rejected before touching
application services.

## Renderer

- Solid 2 signals/memos own view state. Async bootstrap is loaded at the
  application boundary; one resolved `Bootstrap` snapshot is handed to the
  shell and then updated by live events.
- The whole app shell has a single source of truth for the selected device,
  plan, run and logs; pages are pure projections.
- Task forms are driven by `src/shared/tasks.ts`, a declarative catalogue of
  supported task types, defaults, localized labels and field definitions.
  `buildMaaTaskParams` maps the UI model to MaaCore's parameter JSON.
- Styling is a hand-written CSS design system (tokens, panels, task cards,
  log stream). There is no Tailwind and no Solid-1 UI dependency.

## Security

- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  CSP with no remote script; external navigation is blocked and only HTTPS
  links leave the app through `shell.openExternal`.
- IPC: per-command Effect Schema validation; no raw `ipcRenderer` exposure.
- Core paths come from the registry or a user-picked directory; arbitrary
  renderer-supplied paths are not loaded as native libraries.
- Downloads are confirmed by a native dialog and restricted to the official
  release metadata.

## Known limits / next steps

- Linux x86_64/aarch64 is the tested platform. The core host assumes
  `libMaaCore.so`; Windows/macOS need their own library filename and archive
  format handling.
- Core download currently uses `tar` for `.tar.gz`; Windows `.zip` needs a zip
  reader (`yauzl` or equivalent) in a later pass.
- The app updater is not wired yet; core/resource updates are independent of
  the app version.
