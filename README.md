# Wuwa Tappo modkit

CDP-based mod loader for **Wuwa Tappo** (Kuro's Tauri 2 / WebView2 desktop app).
Mods are plain JavaScript injected into the app's webviews; the installed
executable is never modified.

## Quick start

```sh
node src/cli.js lab          # patch the installed app, start it with DevTools on :9222
node src/cli.js watch        # inject ./mods/*.js and keep them applied
```

Edit a file in `mods/` and it is re-injected within a couple of seconds. Stop with
Ctrl+C. `node src/cli.js --help` lists everything.

## Commands

| command | does |
|---|---|
| `lab` | Patch the installed app in place, then start it with DevTools |
| `lab --rebuild` | Force the patch to be re-applied |
| `lab --restore` | Put the unpatched original back |
| `run` | Inject once into all windows, then exit |
| `watch` | Resident injector; survives reloads and mod edits |
| `eval <js>` | Evaluate an expression in every window |
| `state` | Which mods are live in which window |
| `stop` | Stop every instance, elevating if needed |
| `extract-assets` | Unpack the frontend bundle out of the exe |
| `commands` | List backend commands the frontend calls |

Common options: `--port <n>` (default 9222), `--mods-dir <path>` (default `./mods`),
`--force` (re-inject even if already present).

## Layout

```
src/cli.js              entry point, command dispatch
src/commands/           one file per command
src/lib/cdp.js          Chrome DevTools Protocol client (no dependencies)
src/lib/targets.js      window discovery over the DevTools HTTP endpoint
src/lib/inject.js       in-page mod runtime (compiled to source text)
src/lib/injector.js     session management + re-injection on navigation
src/lib/mods.js         mod discovery and change detection
src/lib/patch.js        patches the installed exe in place (with backup)
src/lib/launch.js       launching: detached, and through UAC
src/lib/ps.js           one-off PowerShell (elevation, process control)
scripts/                standalone asset/command extraction tools
mods/                   your mods (files starting with _ are not loaded)
docs/                   launch and modding notes
work/                   generated: extracted assets (git-ignored)
```

## Requirements

Node 22+ (uses the built-in `WebSocket`). No npm dependencies.

## Docs

- [docs/LAUNCHING.md](docs/LAUNCHING.md) — why the exe needs patching, what it changes
- [docs/MODDING.md](docs/MODDING.md) — mod API, backend command reference, gotchas
- [docs/APP-NOTES.md](docs/APP-NOTES.md) — what the app does, where its state lives