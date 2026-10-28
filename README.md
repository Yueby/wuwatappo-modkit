# Wuwa Tappo modkit

CDP-based mod loader for **Wuwa Tappo** (Kuro's Tauri 2 / WebView2 desktop app).
Mods are JavaScript injected into the app's webviews, and, if they want, a Node half that runs as a
process of its own (files, sockets, any npm package). Each is a folder with a `package.json` that
declares the switches and numbers it shows on the MOD page (remembered across restarts, one master
switch per mod), what it needs, and what it will do. The installed executable gets one
length-preserving byte edit (it stops demanding administrator) and nothing else.

## Quick start

```sh
node src/cli.js setup        # once (one UAC prompt). From then on just run WuwaTappo.exe: the mods start with it
node src/cli.js uninstall    # takes that away again
```

`setup` has the app open its DevTools port by itself on every start, and has the loader start at every
logon, waiting for the app. Nothing has to launch the app for you.

Without installing anything, for one session:

```sh
node src/cli.js start        # patch if needed, start the app with DevTools, keep mods applied (stays running)
```

or in two steps, which is what to use while writing a mod:

```sh
node src/cli.js lab          # patch the installed app, start it with DevTools on :9222
node src/cli.js watch        # inject the mods of the app folder and keep them applied
```

Mods live in `<app folder>\mods` (empty to begin with: the program carries none, they are installed with
`mods install`). Edit a file there and it is re-injected within a couple of seconds. Stop with Ctrl+C.
To write a mod, copy `examples/_template/` into it (see [docs/MODDING.md](docs/MODDING.md)).
`node src/cli.js --help` lists everything.

## Commands

| command | does |
|---|---|
| `lab` | Patch the installed app in place, then start it with DevTools |
| `lab --rebuild` | Re-apply the patch from the stock backup |
| `lab --restore` | Put the unpatched original back |
| `setup` / `setup status` / `uninstall` | One-time install: the app opens its DevTools port on every start, the loader starts at logon. After it, run `WuwaTappo.exe` any way you like |
| `start` | Start the app with DevTools if it is not running, then stay resident (`--no-launch`, `--log-file`) |
| `autostart install` / `remove` / `status` | Run `start` at logon, from a script in your Startup folder |
| `mods list` / `install <source>` / `update [id]` / `remove <id>` | Install a mod from a folder, `.zip`/`.tgz`, git URL, npm package or `.js` file |
| `run` | Inject once into all windows, then exit (a mod's Node part is not started) |
| `watch` | Resident injector and host of the Node parts; survives reloads and mod edits |
| `eval <js>` | Evaluate an expression in every window |
| `state` | Which mods are live in which window |
| `stop` | Stop every instance, elevating if needed |
| `extract-assets [--exe p] [--out d]` | Unpack the frontend bundle out of the exe |
| `backend-commands [--assets d]` | List the backend commands the frontend calls |

Options: `--port <n>` (default 9222), `--mods-dir <path>` (default: `mods` in the app folder), `--force`
(re-inject even if already present). An unknown `--option` is an error, not ignored.

## Where things are

```
<app folder>\                 where WuwaTappo.exe is (E:\Programs\WuwaTappo; WUWA_INSTALL_DIR overrides it)
  WuwaTappo.exe               the patched exe
  WuwaTappo.exe.orig          the original, for uninstall
  mods\                       the mods that run: a folder (or a .js) each
  moddata\<mod>\              what a mod's Node part keeps (host.dataDir)
  moddata\.modkit\            the loader's own: loader.lock and modkit.log
```

Nothing else is written outside the repository, apart from one registry value and one Startup script
(see docs/LAUNCHING.md). `node src/cli.js setup` creates the folders, adds the mods that ship with the
program that are not there yet (it never overwrites one that is), and moves data from where it used to be.

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
    host.js               a mod's Node part: starting and stopping it, carrying messages between pages and mods
    host-runner.js        what runs inside its child process (the `host` object a mod gets)
    app.js                is the app up, with a DevTools port; starting it
    webview-policy.js     the registry value that makes the app open its DevTools port by itself
    lock.js               one loader at a time
    autostart.js          the logon script in the Startup folder
    install.js            installing, updating, removing and listing mods
    semver.js             version ranges, for "requires" and "engines"
    page-scripts.js       generates the JavaScript that is evaluated *inside* the page
    manifest.js           a mod's package.json: parsing and validation
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
examples/               example mods (auto-click, click-journal) and the _template* to copy. Not part of the program
                          and never installed by it: <app folder>\mods starts empty
scripts/                developer tools, not part of the CLI (icon preview)
tests/                  `npm test` runs the offline ones (no app needed); `npm run test:app` needs the app running
docs/                   launching, modding, and what is known about the app
work/                   generated and git-ignored: the unpacked frontend
```

Dependencies point one way: `scripts/` and `tests/` use `src/`; `src/commands/` uses
`src/lib/`; `src/lib/` uses nothing of ours above it. `runtime/` is not imported by anything:
it is read from disk and sent into the page.

## Requirements

Node 22+ (uses the built-in `WebSocket`). No runtime npm dependencies. `npm run build` makes the single
exe, `dist/modkit.exe` (see [docs/PACKAGING.md](docs/PACKAGING.md)); that needs the devDependencies (esbuild, postject).

## Docs

- [docs/LAUNCHING.md](docs/LAUNCHING.md) — why the exe needs patching, what it changes
- [docs/MODDING.md](docs/MODDING.md) — mod API, backend command reference, gotchas
- [docs/PACKAGING.md](docs/PACKAGING.md) — the plan for one exe, what was checked for it, what is left
- [docs/APP-NOTES.md](docs/APP-NOTES.md) — what the app does, where its state lives
