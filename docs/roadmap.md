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
- [x] Remaining task types: Roguelike, Reclamation, SingleStep,
      VideoRecognition. Roguelike covers all six themes (including 黑流树海),
      their mode lists, the starting-operator order with per-slot support,
      opening reset, foldartals, seeds, Playtime nodes, Blackflow start-run
      rewards and both mechanic fast-flight switches; Reclamation covers both
      themes and the crafting mode; SingleStep maps stage/start/action;
      VideoRecognition takes a recording path.
- [x] Copilot workspace: add assignments by PRTS id, `prts://s/<id>` set
      link or by browsing, and run them as a batch. Each row checks 普通 and
      突袭/磨难/险地 independently (both run, neither skips); H stages only offer
      普通. A cleared difficulty unchecks itself and single-assignment runs ignore
      the checkboxes.
- [x] Copilot browsing: assignments and sets tabs. Search PRTS by keyword,
      stage, operator, author and sort order; browse curated sets with author
      filtering, expand a set to its assignments and add all of them at once.
      The stage catalogue is disk-cached and operator suggestions come from the
      core's own list.
- [x] Tools: recruitment calculator, operator box, depot. Recruitment reads
      the active core's tables; OperBox/Depot results stream from the core's
      `SubTaskExtraInfo` callbacks and are kept per device.
- [x] Scheduled runs and run history/statistics. A per-device daily schedule
      fires inside a two-hour grace window while the app is running; every
      terminal run is recorded once and summarised by day and task type.
- [x] Component manager UI (install/repair/rollback/move core). Install and
      import remain additive; managed cores can be repaired from the release
      archive or moved to another directory, and older versions stay selectable
      for rollback.
- [x] Multi-device sessions with one host per core version. Hosts are keyed by
      core + resource server and shared by every attached device, so two devices
      on the same core reuse one utility process while their runs stay separate.
- [x] Tray mode, native notifications, close-to-tray. Notifications already
      covered run completion; close-to-tray keeps scheduled runs alive and the
      tray menu reopens or quits the app.
- [x] Log export and diagnostics bundle. Logs are written through a save
      dialog; the diagnostics bundle adds runtime, settings, cores, devices,
      schedules, history and tool snapshots to a reviewable folder.

## v2 — polish and platform breadth

- [ ] Application self-update (electron-updater or a signed custom updater).
- [x] Windows core host (`MaaCore.dll` / `.zip`), ADB discovery and MuMu
      connection profiles.
- [ ] macOS core host variant and archive format.
- [ ] Incremental resource updates from the MAA resource channel.
- [ ] Theme editor, compact/terminal layouts, keyboard command palette.
- [ ] End-to-end tests against a recorded core event fixture.
- [ ] CI packaging matrix and release artifacts.
