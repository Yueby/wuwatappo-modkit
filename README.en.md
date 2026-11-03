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
| **桌宠手感** (Pet feel) | Elastic motion for pressing, dragging, releasing, clicking and throwing a pet, with gravity, turning and rolling; the same for every pet | on |
| **气泡弹跳** (Bubble pop) | The emote bubbles a pet sends out are springy: they swell and spring back as they come out, and sway as they float up | on |
| **记住桌宠位置** (Pet position) | Records the positions of the person's own pet and the other players' pets, and restores them after a restart or on entering a room | on |

Plugins that act on the account (auto click, auto chest) are **off** after they are installed; they are switched on on the MOD page.

## Installing

1. Download `modkit.exe` from the [Releases page](https://github.com/Yueby/wuwatappo-modkit/releases/latest) (about 90 MB: it carries its own runtime). `modkit.exe.sha256` on the same page is its checksum, for anyone who wants to compare.
2. Put `modkit.exe` in Wuwa Tappo's install folder (the app's root), in the same folder as `WuwaTappo.exe`. **Not the folder of the shortcuts in the Start menu**: it has shortcuts and no `WuwaTappo.exe`. If it is in the wrong place the window says so when it opens, and says which folder the app is in.
3. Double-click `modkit.exe` and press **安装** (install) in the window. Windows asks for administrator rights **once** (UAC): answer yes.
4. If the app is running it is closed first and opened again when the install is done.

Once is enough. From then on, open Wuwa Tappo as usual and the plugins start with it. **After the app updates itself, open `modkit.exe` and press 安装 once more.**

Requires Windows. Developed and tested with Wuwa Tappo 1.0.2.

## Using it

### The MOD page

Open the settings panel with the pet's settings button. The last tab on the left is **MOD**.

- The page has two tabs, **已安装** (installed) and **插件市场** (the plugin market), and the plugins are cards, two to a line.
- An installed card: the name, the version and how it is doing (正常, 出错, 已关闭), then what it does and who wrote it; its buttons are **已启用 / 已关闭** (the master switch: off means the plugin does not run at all), **设置** (settings, which can be changed while it is off), and **更多** (more), which has **检查更新** (check for an update) and **卸载** (remove).
- **日志** at the top right is what the plugins wrote, the place to look when something goes wrong.
- At the bottom right: the framework's version and **检查更新** (check for updates). When a new version exists, the MOD tab gets a small dot and the list gets a row at the top; **更新** shows a progress bar while it downloads, then checks, installs, patches again and restarts the app. A development copy run from the source only says so (use `git pull`).
- Installed plugins with a newer version are shown the same way: checked when the settings panel opens and every half hour after (needs the internet; a failure is not said). The MOD tab gets the small dot, the list gets a row at the top ("有 N 个插件可以更新"), the plugin's own row says "有新版本 x.y.z", and **查看** goes to the plugin market, where each is updated with **更新** (what it declares is still shown first, for the person to confirm).

### Installing, updating and removing plugins

On the MOD page go to the **插件市场** tab (needs the internet), or in the launcher window press **插件…**, to see the plugins in the registry:

- Press **安装** on a card: its description is shown first, and **what it declares it does**: reading and writing files, using the network, using the clipboard, whether it has a background program of its own. Read it, then confirm. It takes effect at once; the app does not need to be restarted. An installed one reads **已安装**; one with a newer version comes first, with **更新到 vx.y.z**. **刷新** reads the registry again.
- For an installed plugin, **更多 → 检查更新** on its card in the **已安装** tab: if there is a newer one you are asked before it is updated.
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

**Pet feel**: elastic motion for what is done to a pet. The person's own pet and the other players' pets in the room behave the same.

- 按压形变 (press squash): the body is squashed down while the pet is held.
- 拖拽摆动 (drag swing): while dragged the pet is lifted and swings with the direction of the drag.
- 松手回弹 (release bounce): after release the pet lands and bounces.
- 点击弹跳 (click hop): the pet hops on a quick click (pressed and released at once).
- 抛掷 (throw): release quickly during a drag and the pet flies off at the speed of the hand and rebounds off the edges of the screen. The speed is taken from the pointer's path over the last 70 ms before the release, the same for the person's own pet and for another player's, so a light flick throws. With gravity on it falls and finally lands on the top of the taskbar; with gravity off it glides on until it stops. A slow release only puts it down.
- 旋转滚动 (turn and roll): a thrown pet turns, is turned faster by what it scrapes along, rolls like a wheel on the floor, for as far as the speed it lands with says (a light throw rolls a short way, a hard one across most of the screen, and it rebounds off an edge and goes on), always turning as fast as it moves, and rights itself, with a little wobble, before it stops. Off, it only leans the way it goes.
- Pressing the pet again while it flies stops it at once. The place it ends in is kept by the Pet position plugin.

Each effect has its own switch in the plugin's settings, and there is a strength setting (0.5 to 2, 1 by default). It needs the permission to read and change the app's own state, to know whether a pet is held and whether it is moving.

**Bubble pop**: the emote bubbles a pet sends out (the person's own and the other players') are springy. A bubble is still the app's one second, and rises and ends where it did; it comes out small, swells past its size and springs back, and sways a little as it floats. It only changes styles, and does not touch the account or the emotes themselves. The settings have a strength (0.5 to 2, 1 by default).

**Pet position**: records the positions of the person's own pet and of the other players' pets in the room (the last place each was dragged to), and restores them after a restart or on entering a room.

- Positions are kept per player, up to 60; past that the earliest set are dropped. They stay on this computer and are not sent to the room.
- After a restart or on entering a room the app puts the pets back in its default places, and the plugin restores them to the recorded places in under a second.
- 自动还原位置 (restore automatically): a setting that can be turned off. Off, positions are only saved and no pet is moved while the app runs.
- 记录当前位置 (record current position): a button in the settings that records the positions of all pets as they are now.
- Changing the corner or the size of the pet in the app's own settings discards the old position, and a new one is recorded afterwards. The same when the screen resolution changes.
- When a place is occupied and the app does not let a pet stay there, the plugin retries at increasing intervals and does not contend with the app.
- It needs the permission to read and change the app's own state, to set a pet's position directly. It does not simulate the mouse, does not add clicks and sends nothing to the room.

## What it does to the computer

For anyone who wants to know before installing:

- **The app's exe**: its “must run as administrator” requirement is removed (one flag changed, same file size). The original is kept as `WuwaTappo.exe.orig` beside it.
- **The registry**: a value named `WuwaTappo.exe` under `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`, set to `--remote-debugging-port=9222`. It applies to this app only, and makes it open a debugging port when it starts: that is how plugins are loaded. The port can only be reached from this computer (127.0.0.1). Writing it needs administrator rights, so installing and removing each ask for UAC once.
- **Startup**: a small script with no window in the Windows Startup folder, which waits in the background for the app to start after logon.
- **Folders**: in the app's install folder, `mods` (plugins), `moddata` (what plugins save) and `moddata\.modkit` (a copy of the loader, and its log).
- **The network**: only the checks for updates (launcher, MOD page) and the plugin list go out, to GitHub. The loader itself does not read or send login information. Whether a plugin uses the network or files is declared in the plugin list and shown before installing; none of the plugins above uses the network.

### Removing it

Press **卸载** in the launcher window: the background loader is stopped, the startup script and the registry value are deleted, and **the app's exe is put back to the original** (if the app is running it is closed first and opened again). The plugins and their data in `mods` and `moddata` stay where they are; delete them by hand if they are not wanted.

## Things to know

- **Auto click and auto chest act on the account.** They do what a person clicking would do (auto chest only presses the button the app itself shows), but whether automation is allowed by the app's terms is for each player to decide, at their own risk.
- Both check whether someone is logged in (only that a login is there, not what it is), and do nothing when nobody is.
- **A plugin is somebody else's code, and can do whatever the app's windows can.** The plugins in the registry are looked at by hand before they are merged, and what a plugin declares is shown before it is installed, but only install plugins that can be trusted.
- When a chest is ready and what it gives are decided by the server. The loader and the plugins cannot change that, and do not try to.

## Questions

**Opening modkit.exe says its place is wrong (位置不对).** `modkit.exe` has to be in the same folder as `WuwaTappo.exe`. The usual mistakes are the Start menu folder of the shortcuts and the Downloads folder. The message names the folder the app is in (found from a shortcut, the running app and the install record): move `modkit.exe` there, close the window and open it from there. `modkit.exe placement` checks it from the command line.

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
| `update` | Look on GitHub for a newer launcher and take it (`--check` only asks); the MOD page in the app has the same **检查更新** at its bottom right |
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
