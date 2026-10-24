# Startup benchmark

`scripts/measure-startup.mjs` compares the three ways the current Linux build
can be launched. All three load the same `app.asar` from
`dist/linux-unpacked/resources`.

| Mode            | Launched with                                         | Layout                           |
| --------------- | ----------------------------------------------------- | -------------------------------- |
| `unpacked`      | `dist/linux-unpacked/maax`                           | electron-builder directory       |
| `appimage`      | `dist/*.AppImage`                                    | type-2 AppImage, squashfs + FUSE |
| `asar-electron` | local Electron binary + `resources/app.asar`         | asar plus the workspace Electron |

## Prepare

```bash
pnpm build
pnpm exec electron-builder --dir
pnpm exec electron-builder --linux AppImage
pnpm bench:startup --runs 7
```

The default run is one discarded warmup plus seven measured launches per mode.
Artifacts are launched interleaved and the order rotates between rounds, so a
slow first image read or a short CPU burst is spread across modes instead of
landing on one of them. Raw results go to `dist/startup-benchmark.json`.
Pass `--appimage <path>` to compare an alternate AppImage without replacing the
artifact in `dist/`.

## What is measured

- **launch → shell**: from the harness `spawn()` to the first task after a
  `requestAnimationFrame` callback following insertion of the AppShell
  (`.shell`). The renderer records `performance.timeOrigin +
  performance.now()`, so its timestamps are comparable with `Date.now()` in
  the launcher and main process.
- **FCP**: the renderer's `first-contentful-paint` entry. The AppShell is the
  first contentful paint; the shell marker remains the primary end-to-end
  result because it does not depend on when the compositor presents the frame.
- **Memory**: PSS and RSS summed over the launched process and all descendants,
  sampled three seconds after the shell marker. PSS is the more useful total:
  shared Chromium pages are divided among processes instead of counted once per
  process in RSS. The sample covers main, zygote, utility, GPU and renderer
  processes; it does not include the kernel page cache used by the AppImage
  squashfs.

`MAAX_BOOT_TRACE` is set only by the script. The main process appends NDJSON
markers and receives renderer markers through `console-message`. Without that
variable the trace module returns immediately, so normal runs do no trace file
I/O and the renderer is not loaded with `?bootTrace=1`.

## Caveats

- Results are warm starts: build artifacts are already in the page cache.
- Keep the artifacts on the same filesystem when comparing. `/tmp` is tmpfs on
  many Linux systems, and an AppImage stored there skips disk I/O for its
  squashfs reads.
- The AppImage runtime mounts its squashfs through FUSE before Electron starts,
  and every app read then goes through that mount. Both costs are part of the
  AppImage result.
- The AppImage target uses electron-builder's static-runtime toolset
  (`toolsets.appimage` in `electron-builder.yml`) with zstd. In a same-session comparison, the
  previous FUSE2/gzip image took about 2.34 s to the first AppShell frame and
  the static/zstd image about 1.07 s. Toolset and compression choice dominates
  AppImage startup; measure it with the artifact on the same filesystem.
- `asar-electron` runs unpackaged (`app.isPackaged === false`), so it enables
  the development-only remote debugging port and renderer console forwarding.
- The shell marker is emitted after the frame that inserted the AppShell, but
  compositor presentation can trail it by about one frame. FCP and the raw event
  list in the JSON make that visible.
