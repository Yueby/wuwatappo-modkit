# Wuwa Tappo modkit

CDP-based mod loader for **Wuwa Tappo** (Kuro's Tauri 2 / WebView2 desktop app).
Mods are JavaScript injected into the app's webviews, each with a `mod.json` that declares the
switches and numbers it shows on the MOD page (remembered across restarts, one master switch per
mod). The installed executable gets one length-preserving byte edit (it stops demanding
administrator) and nothing else.

## Quick start

```sh
node src/cli.js lab          # patch the installed app, start it with DevTools on :9222
node src/cli.js watch        # inject ./mods/*.js and keep them applied
```

Edit a file in `mods/` and it is re-injected within a couple of seconds. Stop with Ctrl+C.
To write a mod, copy `mods/_template/` (see [docs/MODDING.md](docs/MODDING.md)).
`node src/cli.js --help` lists everything.

## Commands

| command | does |
|---|---|
| `lab` | Patch the installed app in place, then start it with DevTools |
| `lab --rebuild` | Re-apply the patch from the stock backup |
| `lab --restore` | Put the unpatched original back |
| `run` | Inject once into all windows, then exit |
| `watch` | Resident injector; survives reloads and mod edits |
| `eval <js>` | Evaluate an expression in every window |
| `state` | Which mods are live in which window |
| `stop` | Stop every instance, elevating if needed |
| `extract-assets [--exe p] [--out d]` | Unpack the frontend bundle out of the exe |
| `backend-commands [--assets d]` | List the backend commands the frontend calls |

Options: `--port <n>` (default 9222), `--mods-dir <path>` (default `./mods`), `--force`
(re-inject even if already present). An unknown `--option` is an error, not ignored.

## Layout

```
src/
  cli.js                entry point and usage text
  commands/             one file per CLI command; index.js is the registry
    options.js            argument parsing shared by all of them
  lib/                  everything the commands are built from (depends on nothing above)
    paths.js              every directory the tool reads or writes, named once
    cdp.js                Chrome DevTools Protocol client (no dependencies)
    targets.js            finding the app's windows over the DevTools HTTP endpoint
    injector.js           one live session per window; re-injects on navigation and edits
    page-scripts.js       generates the JavaScript that is evaluated *inside* the page
    manifest.js           mod.json: parsing and validation
    mods.js               discovery of framework scripts and user mods (files and folders)
    patch.js              patches the installed exe in place, with backup and restore
    launch.js             starting the app detached
    ps.js                 PowerShell: process count, kill, run-as-administrator
    assets.js             unpacking the frontend out of the exe
    frontend-commands.js  finding the backend commands in the unpacked frontend
    icon.js               draws the MOD tab's two icons
    output.js             console formatting
  runtime/              framework scripts injected into every window before any mod
    modkit-registry.js    window.modkit: mod lifecycle, settings, master switch, state shared
                          between windows (every window)
    panel-tab.js          the MOD tab and page in the settings panel (panel window only)
mods/                   your mods: single files or folders with a mod.json (_ = not loaded)
scripts/                developer tools, not part of the CLI (icon preview)
tests/                  `npm test` runs the offline ones; `npm run test:app` needs the app running
docs/                   launching, modding, and what is known about the app
work/                   generated and git-ignored: the unpacked frontend
```

Dependencies point one way: `scripts/` and `tests/` use `src/`; `src/commands/` uses
`src/lib/`; `src/lib/` uses nothing of ours above it. `runtime/` is not imported by anything:
it is read from disk and sent into the page.

## Requirements

Node 22+ (uses the built-in `WebSocket`). No npm dependencies.

## Docs

- [docs/LAUNCHING.md](docs/LAUNCHING.md) — why the exe needs patching, what it changes
- [docs/MODDING.md](docs/MODDING.md) — mod API, backend command reference, gotchas
- [docs/APP-NOTES.md](docs/APP-NOTES.md) — what the app does, where its state lives
