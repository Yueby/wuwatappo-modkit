# Wuwa Tappo plugin loader

[中文](README.md) · English

A small tool that lets you install plugins into **Wuwa Tappo** (the Wuthering Waves themed desktop pet). Once it is installed, the app's settings panel gets a **MOD** page where plugins are switched on and off, set up, and installed from the plugin registry.

> This is an unofficial third-party project, not connected to the app's developer. It works on this computer only, and it does not get around any of the app's server-side rules (see [Things to know](#things-to-know)).

## Plugins

The plugins live in their own repository, [wuwatappo-mods](https://github.com/Yueby/wuwatappo-mods). They are installed with the 安装 / 插件… buttons, with no manual download.

| Plugin | What it does | Default |
|---|---|---|
| **自动点击** (Auto click) | Clicks the pet at the interval set, raising the click count. In a room, the people in the room see every click | off |
| **自动开箱子** (Auto chest) | Opens a chest when it is ready (opening costs clicks). The upper and the lower chest are switched separately | off |
| **房间历史** (Room history) | Records who comes into and leaves a room, with the room number, the time and how long each person stayed. Kept on this computer only; shown on the 联机 page, from where a room can be entered again | on |
| **记住桌宠位置** (Pet position) | Remembers where your pet, and each other player's pet in the room, was last dragged to; when a restart or a room moves them, sets them back | on |

Plugins that act on the account (auto click, auto chest) are **off** after they are installed; they are switched on on the MOD page.

## Installing

1. Download `modkit.exe` from the [Releases page](https://github.com/Yueby/wuwatappo-modkit/releases/latest) (about 90 MB: it carries its own runtime). `modkit.exe.sha256` on the same page is its checksum, for anyone who wants to compare.
2. Put `modkit.exe` in Wuwa Tappo's install folder, the one that has `WuwaTappo.exe` in it.
3. Double-click `modkit.exe` and press **安装** (install) in the window. Windows asks for administrator rights **once** (UAC): answer yes.
4. If the app is running it is closed first and opened again when the install is done.

Once is enough. From then on, open Wuwa Tappo as usual and the plugins start with it. **After the app updates itself, open `modkit.exe` and press 安装 once more.**

Requires Windows. Developed and tested with Wuwa Tappo 1.0.2.

## Using it

### The MOD page

Open the settings panel with the pet's settings button. The last tab on the left is **MOD**.

- One row per plugin: its name and description, a **设置** (settings) button and a **switch**. The switch is the master switch: off means the plugin does not run at all. Settings can be changed while it is off.
- Two buttons at the top right: **日志** (log: what the plugins wrote, the place to look when something goes wrong) and **安装** (the plugin list).

### Installing, updating and removing plugins

On the MOD page press **安装**, or in the launcher window press **插件…**, to open the plugin list (needs the internet):

- Select a plugin: its description is shown, and **what it declares it does**: reading and writing files, using the network, using the clipboard, whether it has a background program of its own. Read it, then press **安装**. It takes effect at once; the app does not need to be restarted.
- When an installed plugin has a newer version the button reads **更新**.
- **卸载** deletes the plugin's folder. Only with “同时删除它保存的数据” ticked is its saved data deleted as well; otherwise its settings are still there if it is installed again.

A plugin can also be installed by hand: put its folder in the `mods` folder of the app's install folder (the **打开插件文件夹** button of the launcher window opens it).

### The launcher window

The window that opens when `modkit.exe` is double-clicked:

| Button | What it does |
|---|---|
| 安装 / 卸载 | Install or remove the loader itself (not a plugin) |
| 打开插件文件夹 | Opens the `mods` folder of the app's install folder |
| 刷新 | Checks the state again, and whether there is a newer version |
| 插件… | Opens the plugin list |

Every time the window opens, the launcher looks for a newer version of itself; if there is one it is downloaded, checked, put in place and opened again. The version is at the top left (for example `启动器 v0.3.6`).

## How each plugin is used

**Auto click**: switch it on on the MOD page and it clicks. **点击间隔（毫秒）** in its settings is the time between two clicks, 50–5000, 200 by default; smaller is faster. The two rows below show its state and the number of clicks this time. It needs a login. Switching it off, or reloading it, stops it at once.

**Auto chest**: switch it on and a chest is pressed when its time is up. **开上面的箱子** and **开下面的箱子** switch the two chests separately; **检查间隔（秒）** is how often it looks, 3 seconds by default. Opening costs clicks: when there are not enough it cannot open, and tries again after a while, waiting longer each time. The state row shows how long each chest has left.

**Room history**: while it is on, it writes down who comes in, who leaves and who drops out of the room, with the room number, the time and how long they stayed. The records are shown right on the **联机** page of the app's settings panel, under the list of the people in the room, one row for each room: **展开** shows what happened in a room, **复制** copies the room number, and when the person is not in a room **进入** puts the number into the page's room box and joins that room. The plugin's own **设置** has the same list, with **清空** to delete all the records, and **最多保留** is how many records are kept (300 by default). Records stay on this computer. When the app is started again, or its page loaded again, and it comes back to the same room, that is the same stay and not a new one; leaving the room and coming in again is two. If the plugin is switched on when people are already in the room, the ones already there are only read while the settings panel is open; enter the room again for a complete record.

**Pet position**: it works as soon as it is installed, with nothing to set up. Drag your pet where it should be and the plugin remembers it; the same for the other players' pets in the room, kept for each player (the plugin's **设置** shows the remembered places and its state). After that, when a restart, or the app moving the pets for a room (the app puts the other players' pets back in its default slots every time a room is entered), puts them somewhere else, the plugin sets them back to the remembered places, in under a second. With **位置被挤动后放回去** off it only keeps the place the app saves (which matters at the next start) and never moves a pet while the app runs. With **也记住其他玩家的桌宠** off it only looks after your own pet. **记下现在的位置** takes the places all the pets are at now as the ones to keep. Some things to know:
- The plugin needs the permission to "read and change the app's own state" (listed when it is installed): the pets' places are variables inside the app, and nothing else can set them. The loader loads the main window once more each time the app starts (a second or two); in return nothing pretends to be the mouse any more, so it does not matter whether the mouse is moving, no click is counted, and nothing is sent to the room.
- Changing where the pet goes (the corner) or its size in the app's own settings lets the old place go; a new one is taken afterwards. The same when the screen's resolution changes.
- The places of the other players are kept for each player, up to 60; past that the ones set longest ago are forgotten. They stay on this computer and are not sent to the room.
- When a room holds the place and the app will not let a pet stay there, it tries again after longer and longer waits, and does not fight the app.

## What it does to the computer

For anyone who wants to know before installing:

- **The app's exe**: its “must run as administrator” requirement is removed (one flag changed, same file size). The original is kept as `WuwaTappo.exe.orig` beside it.
- **The registry**: a value named `WuwaTappo.exe` under `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`, set to `--remote-debugging-port=9222`. It applies to this app only, and makes it open a debugging port when it starts: that is how plugins are loaded. The port can only be reached from this computer (127.0.0.1). Writing it needs administrator rights, so installing and removing each ask for UAC once.
- **Startup**: a small script with no window in the Windows Startup folder, which waits in the background for the app to start after logon.
- **Folders**: in the app's install folder, `mods` (plugins), `moddata` (what plugins save) and `moddata\.modkit` (a copy of the loader, and its log).
- **The network**: only the launcher's check for updates and the plugin list go out, to GitHub. The loader itself does not read or send login information. Whether a plugin uses the network or files is declared in the plugin list and shown before installing; none of the plugins above uses the network.

### Removing it

Press **卸载** in the launcher window: the background loader is stopped, the startup script and the registry value are deleted, and **the app's exe is put back to the original** (if the app is running it is closed first and opened again). The plugins and their data in `mods` and `moddata` stay where they are; delete them by hand if they are not wanted.

## Things to know

- **Auto click and auto chest act on the account.** They do what a person clicking would do (auto chest only presses the button the app itself shows), but whether automation is allowed by the app's terms is for each player to decide, at their own risk.
- Both check whether someone is logged in (only that a login is there, not what it is), and do nothing when nobody is.
- **A plugin is somebody else's code, and can do whatever the app's windows can.** The plugins in the registry are looked at by hand before they are merged, and what a plugin declares is shown before it is installed, but only install plugins that can be trusted.
- When a chest is ready and what it gives are decided by the server. The loader and the plugins cannot change that, and do not try to.

## Questions

**There is no MOD tab after starting the app.** Make sure it was installed with the launcher's 安装, and that the app was restarted afterwards (installing does that by itself). Opening the launcher window and pressing 刷新 shows the current state. If the app has been updated, press 安装 once more.

**Windows says “unknown publisher”, or the antivirus complains.** `modkit.exe` is not code-signed, and it changes another program, so it is easy to stop. The source is in this repository: build it yourself with `npm run build`, or compare the download with `modkit.exe.sha256` from the Releases page.

**Will the login be lost?** No. The app's data folder and login are not changed.

**The settings panel is a bit slow.** With auto click at a very small interval (many clicks a second), an open settings panel has a lot of updates to deal with. The loader already merges them; if it is still slow, raise the interval, or close the panel when it is not needed.

**I do not want it any more.** To drop one plugin: switch it off on the MOD page, or remove it. To drop everything: press 卸载 in the launcher window.

**Something is wrong.** Open an [issue](https://github.com/Yueby/wuwatappo-modkit/issues), with what the MOD page's 日志 says and the version in the launcher window.

---

# Contributing

This part is for people who want to write a plugin or change the loader. To use it, the above is all that is needed.

## Writing a plugin

A plugin is a folder with a `package.json` (its name, version, settings, which window it runs in) and the scripts it runs. **Dev mode** loads a folder as it is saved, with no install:

- In the launcher window tick **开发模式** and choose the plugin's folder; or from the command line `node src/cli.js dev on <folder>`.
- A change is loaded into the app within a second or two of saving; `dev off` goes back to the installed plugins.
- Start from a copy of `examples/_template/`. The whole interface, the `package.json` fields and the Node part (a background program of its own) are in [docs/MODDING.md](docs/MODDING.md).

Send a finished plugin to [wuwatappo-mods](https://github.com/Yueby/wuwatappo-mods) (see its [CONTRIBUTING.md](https://github.com/Yueby/wuwatappo-mods/blob/main/CONTRIBUTING.md)). The MOD page uses the app's own styles, and what a plugin shows to the player is written as labels and statements, with no 我 / 您 / 他 and the like: those rules are in CONTRIBUTING.

## Running from source

Node 22 or newer. No npm dependencies at run time (the build needs `esbuild` and `postject`, which `npm install` gets).

```sh
node src/cli.js setup        # the one-time install (one UAC prompt); after it, just run the app
node src/cli.js uninstall    # puts everything back
node src/cli.js start        # without installing: patch, start the app with the debug port, keep plugins applied (stays running)
node src/cli.js --help       # every command
```

When writing a plugin, two steps work well: `lab` (patch the app and start it with the debug port) and `watch` (inject the plugins and reload them when a file changes).

### Commands

| command | does |
|---|---|
| `lab` / `lab --rebuild` / `lab --restore` | Patch the installed app and start it with the debug port / patch again / put the original back |
| `setup` / `setup status` / `uninstall` | One-time install: the app opens its debug port on every start, the loader starts at logon; `uninstall` takes it away |
| `start` | Start the app with the debug port if it is not running, then stay resident (`--no-launch`, `--log-file`) |
| `window` | The launcher window with the install / uninstall buttons (what a double-click on the exe opens) |
| `update` | Look on GitHub for a newer launcher and take it (`--check` only asks) |
| `dev [on <folder>\|off]` | Dev mode: use a folder's plugin in place, loaded as it is saved |
| `mods browse` / `get <name>` | What the registry lists / install one (it shows what the plugin declares and asks first) |
| `mods list` / `install <source>` / `update [id]` / `remove <id>` | Manage installed plugins; a source is a folder, `.zip`/`.tgz`, git URL, npm package or `.js` file |
| `mods check <folder>` | Is this folder a plugin that can be loaded (`--registry`: what the registry also needs) |
| `run` / `watch` | Inject once and exit / stay resident, injecting and hosting the Node parts |
| `eval <js>` / `state` | Evaluate an expression in every window / which plugins are live in which window |
| `stop` / `selftest` | Stop every instance / check that this build works |
| `extract-assets` / `backend-commands` | Unpack the app's frontend / list the backend commands it calls |

Options: `--port <n>` (debug port, 9222), `--mods-dir <path>` (default: `mods` in the app folder), `--force`. An unknown option is an error, not ignored.

### Where things are

```
<app folder>\                 where WuwaTappo.exe is (WUWA_INSTALL_DIR overrides it)
  WuwaTappo.exe               the patched exe
  WuwaTappo.exe.orig          the original, for uninstall
  mods\                       the plugins that run: a folder (or a .js) each
  moddata\<plugin>\           what a plugin's Node part keeps
  moddata\.modkit\            the loader's own: loader.lock, modkit.log, dev.json (dev mode)
```

### Layout

```
src/
  cli.js / entry.js / main.js   command line entry / the packaged exe's entry / what a command line means, and the usage text
  window.ps1                    the launcher window (PowerShell + WinForms; runs this program for each button)
  commands/                     one file per command; index.js is the registry
  lib/                          everything the commands are built from (CDP client, injector, plugin discovery and
                                validation, patching, install / update / registry, dev mode, self-update, ...)
  runtime/                      framework scripts injected into every window before any plugin
    modkit-registry.js            window.modkit: plugin lifecycle, settings, master switch, state shared between windows
    panel-tab.js                  the MOD tab and page in the settings panel (panel window only)
    panel-feed.js                 how often the main window tells the settings panel its state (main window only)
examples/                       the _template* plugins to copy
scripts/                        developer tools (building the exe, icon preview)
tests/                          `npm test` runs the offline ones; `npm run test:app` needs the app running
docs/                           one document per subject
```

Dependencies point one way: `scripts/` and `tests/` use `src/`; `src/commands/` uses `src/lib/`; `src/lib/` uses nothing of ours above it. `runtime/` is not imported by anything: it is read from disk and sent into the page.

### Tests and building

```sh
npm test            # offline tests; the app is not needed
npm run test:app    # live tests: need the app running with the loader injected; they click the settings panel (tell the player first, and keep auto click and auto chest off)
npm run build       # makes dist/modkit.exe and dist/modkit.exe.sha256
```

A push to `main` that changes the version in `package.json` makes GitHub Actions run the tests, build, and publish the release.

### Docs

- [docs/MODDING.md](docs/MODDING.md): the plugin interface, `package.json`, the Node part, gotchas
- [docs/REGISTRY.md](docs/REGISTRY.md): the plugin registry: listing, installing, what is checked
- [docs/LAUNCHING.md](docs/LAUNCHING.md): why the exe needs patching, what it changes
- [docs/PACKAGING.md](docs/PACKAGING.md): how the single exe is built
- [docs/RELEASING.md](docs/RELEASING.md): making a release, and how the exe updates itself
- [docs/APP-NOTES.md](docs/APP-NOTES.md): what the app does, where its state lives, what has been measured
