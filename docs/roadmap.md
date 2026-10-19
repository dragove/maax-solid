# Maax roadmap

## MVP — usable daily driver

- [x] Electron 44 / Solid 2 / Effect 4 baseline and secure IPC.
- [x] Utility-process MaaCore host with koffi, batched callbacks, screenshots.
- [x] Local core import, core registry, active version.
- [x] Confirmed official core download + staged tar installation.
- [x] Device profiles, ADB connect/disconnect, screenshot preview.
- [x] Device-scoped task plan with StartUp, Fight, Recruit, Infrast, Mall,
      Award, CloseDown.
- [x] Fight series Auto/NotSwitch/1–10 and a searchable, categorized stage picker
      with live event stages.
- [x] Run/stop, live task-chain and subtask projection, log stream.
- [x] Schema-validated settings/workspace persistence with atomic writes.
- [x] Chinese/English UI, dark/light/system themes.
- [x] Reproducible Linux package; koffi verified inside the packaged app.
- [x] Resource overlay updates from the GitHub MaaResource archive, keeping
      the last three versions for rollback.
- [x] Automatic host recovery: a crashed core no longer requires a manual
      reconnect.
- [x] Component update from the official release channel: checks the published
      MaaCore release, installs it side by side and switches when no device is
      connected (this is also how models and templates get updated).

## v1 — parity with the useful parts of MaaX

- [x] Multiple task plans per device: create, duplicate, rename, switch,
      import and export.
- [x] Copilot (auto battle) as its own tab: assignments are added, run once
      and cleared, never queued. SSS Copilot, Paradox Copilot, Depot, OperBox and
      Custom stay available as queue tasks.
- [ ] Remaining task types: Roguelike, Reclamation, SingleStep,
      VideoRecognition.
- [x] Copilot workspace: add assignments by PRTS id, `prts://s/<id>` set link
      or by browsing, run them as a batch, and expand a dual-difficulty file into
      normal and raid runs.
- [x] Copilot browsing: search PRTS by keyword, stage, operator, author and
      sort order from inside the app, with a disk-cached stage catalogue and the
      core's own operator list.
- [ ] Tools: recruitment calculator, operator box, depot.
- [ ] Scheduled runs and run history/statistics.
- [ ] Component manager UI (install/repair/rollback/move core).
- [ ] Multi-device sessions with one host per core version.
- [ ] Tray mode, native notifications, close-to-tray.
- [ ] Log export and diagnostics bundle.

## v2 — polish and platform breadth

- [ ] Application self-update (electron-updater or a signed custom updater).
- [ ] Windows and macOS core host variants, archive formats, emulator discovery.
- [ ] Incremental resource updates from the MAA resource channel.
- [ ] Theme editor, compact/terminal layouts, keyboard command palette.
- [ ] End-to-end tests against a recorded core event fixture.
- [ ] CI packaging matrix and release artifacts.
