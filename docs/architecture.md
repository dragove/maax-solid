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

### Resource updates

MaaCore ships with a complete `resource/` tree. The GitHub MaaResource archive
carries only the JSON half of it (tasks, stages, pipeline data) plus
`version.json`; templates, OCR models and `config.json` come from that installed
tree. An update is therefore an **overlay**, never a replacement:

1. `github.com/MaaAssistantArknights/MaaResource` `Version` is read from
   `raw.githubusercontent.com/.../resource/version.json` (single small file) and
   compared with `<core>/resource/version.json`; the file on disk is the
   authority, the registry copy is only a cache for display.
2. The 14 MB branch archive is downloaded, extracted with `src/main/zip.ts`
   (yauzl, entry-type and path validation) and only
   `MaaResource-main/resource/` is used.
3. Files that differ are moved into place atomically; every replaced or added
   file is recorded in a backup under `userData/resource-backups/<core>/<stamp>`.
   The three newest backups are kept, and a rollback restores the exact previous
   bytes (added files are deleted again).
4. Nothing is written while a device holds a session: the main process refuses
   and the UI disables the actions (B1). Any host for that core is stopped
   before the overlay is applied, because MaaCore keeps resource state in the
   process.

Files that the archive does not carry stay at their installed version, so a core
release remains the only way to update models and templates.

### Component updates

`cores.check-update` compares the active core version with the published release
(`api.maa.plus/.../version/stable.json`) and reports the new version, its publish
date and the archive size. Installing reuses the core installer: the archive is
downloaded to a staging directory, extracted with the system `tar`, and renamed
into `userData/cores/<version>`, so the running core is never touched. The new
version becomes active immediately unless a device still holds a session; in
that case the switch waits for the next disconnect. Windows and macOS archives
still need their own host variants, so `platformSuffixFor` only lists Linux.

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
  `buildMaaTaskParams` maps the UI model to MaaCore's parameter JSON, and
  `firstMissingField` rejects a queue whose copilot file or custom task names are
  still empty before anything is appended to the core.
- A plan is a device-scoped ordered task list. Create, duplicate, rename,
  import, export and remove all run in `Workspace`; every mutation broadcasts
  `plans-updated` so the renderer never shows a stale plan list.
- Copilot assignments are plain JSON files. Importing one copies it into
  `userData/copilot` and stores the absolute path in the task parameters,
  because MaaCore reads the file itself. `copilot.resolve` accepts a PRTS id, a
  `prts.plus` link or a `prts://s/<id>` set; sets are expanded by fetching each
  member, with four downloads in flight.
- Clearing a stage with a copilot is a **one-off action**, not a daily task:
  the Copilot tab keeps its own saved setup (`config/copilot.json`: the batch
  plus run options) and `copilot.start` appends exactly one task to the
  connected session, without a plan. Runs created that way carry no `planId`.
  The queue palette therefore does not offer `Copilot`; the other copilot-based
  tasks (SSS, Paradox) remain queue entries because they are repeatable.
- A copilot task runs a **batch**: `params.copilot_list` becomes
  `copilot_list: [{ id: <position>, filename, is_raid }]` for MaaCore, which
  executes the entries in order and reports progress by that position. Normal
  and raid runs of one file are two entries sharing a filename — the PRTS
  `difficulty` bitmask (1 normal, 2 raid, 3 both) decides how many entries
  `copilot.resolve` creates.

#### Talking to PRTS politely

prts.maa.plus is a community service, so every request goes through
`src/main/services/prts.ts`:

- one request in flight at a time, with a 750 ms minimum gap;
- identical GETs are served from a 60 s in-memory cache, so re-running a search,
  paging back, or expanding details costs nothing;
- the stage catalogue (`GET /arknights/level`, ≈690 KB, 3.5k entries) is cached
  on disk with its ETag and revalidated at most every 12 hours via
  `If-None-Match`; a 304 keeps the cached copy.

A detail view never fetches anything: `copilot/query` already returns the whole
document, including operator requirements. Measured for a full browse → add
session: two requests on open (catalogue + one query), zero for details,
suggestions and repeat searches, one per added assignment.

Search parameters, as the site actually implements them:

| Parameter | Meaning |
| --- | --- |
| `document` | full-text keyword: stage names, operator names, uploader, description |
| `level_keyword` | substring of the **internal** stage id (`main_01-07`, `act52side`) |
| `operator` | Chinese operator name |
| `uploader_id` | numeric author id |
| `orderBy`, `desc` | `hot`/`views`/`upload_time`, true = descending |
| `page`, `limit` | paging |

The catalogue is what makes stage search usable: its `cat_three` field carries
the display code (`1-7`, `YW-EX-3`, `H9-5（标准）`) and `stage_id` the id the API
filters on, so typing `1-7` resolves to `main_01-07` locally.

Operators come from the active core's `resource/battle_data.json` instead of the
network: ~1400 entries with names in Chinese, English, Japanese, Korean and
Traditional Chinese, plus rarity, profession and the game's own sort order. The
catalogue drops `TRAP` summons, matches Chinese or English names, and is cached
per core path with the file mtime, so a core update refreshes it automatically.
PRTS filters on the **Chinese** name, which is what the picker sends.
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
