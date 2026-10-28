# Writing mods

A mod is code injected into the app's webviews, plus a small description of what it shows
on the MOD page. It comes in two shapes:

```
mods/hello.js            a single script: runs in every window, nothing on the MOD page but a switch
mods/auto-click/         a package: package.json says what it is and what it exposes
  package.json
  main.js                the code that runs in the main window
```

Start a package by copying `mods/_template/` and dropping the underscore. Files and folders
starting with `_` or `.` are never loaded, so you can keep fragments around.

## package.json

A mod's manifest is an ordinary `package.json`, the way a VS Code extension's is. The standard
fields mean what they always do; what is specific to this loader sits under one key of its own,
`modkit`, so nothing collides with npm's vocabulary (in particular, `scripts` is npm's, and here
the window-to-file map is `modkit.windows`).

```json
{
  "name": "auto-click",
  "displayName": "自动点击",
  "version": "0.4.0",
  "description": "按设定间隔模拟鼠标点击，增加点击数",
  "private": true,
  "modkit": {
    "windows": { "main": "main.js" },
    "settings": [
      { "key": "running",  "type": "toggle", "title": "开始点击", "default": false, "persist": false },
      { "key": "interval", "type": "number", "title": "点击间隔（毫秒）", "default": 200, "min": 50, "max": 5000, "step": 10 },
      { "key": "state",    "type": "value",  "title": "状态", "default": "未运行" }
    ]
  }
}
```

| field | meaning |
|---|---|
| `name` | the id; optional, and if given it must equal the folder name |
| `displayName` | what the MOD page shows (defaults to `name`) |
| `description`, `version` | shown on the MOD page |
| `modkit.defaultEnabled` | whether the master switch starts on; default `true` |
| `modkit.windows` | which file runs in which window: `{ "main": "main.js", "panel": "ui.js" }`, or `"*"` for all of them. Default: `index.js` in every window, or none when there is a Node part |
| `modkit.host` | the mod's Node part, an ES module in the folder: `"host.js"` (see [The Node part](#the-node-part)) |
| `modkit.settings` | what the MOD page shows under the mod, in order (below) |

Other top-level fields (`author`, `license`, `private`, ...) are allowed and ignored. An
unknown key inside `modkit` is an error, so a typo like `windos` is reported rather than
silently doing nothing.

Windows are `main`, `panel`, `login`, `update`, `toast`, `about`, `oss-notice`. A mod only runs in
the windows named in `modkit.windows`; every window still receives the manifest, because the MOD
page is drawn in the panel while the code usually runs in main. That is why `settings` are data,
not code: the panel can draw them without running anything.

A manifest that does not parse or does not validate is not ignored: the mod is listed on the
MOD page as broken, with the reason. The same goes for a script that fails to compile or throws
while starting (whatever it had already added is undone).

The mod is not an npm package: nothing is installed or bundled, and the scripts are sent into the
page as text. `package.json` is used for its shape, which editors and people already know.

### Settings

| `type` | row on the MOD page | value the mod gets |
|---|---|---|
| `toggle` | on/off switch | `true` / `false` |
| `number` | number box; clamped to `min`/`max` | a number |
| `value` | read-only text on the right | nothing: the mod publishes it with `mod.live` |

Every setting has `key` (letters, digits, `_`), `title`, an optional `description` (the subtitle),
and for `toggle`/`number` a `default`. Two behaviours worth deciding on purpose:

- **Remembered** (the default). The value survives restarts. It is stored in `localStorage`,
  which all windows of the app share; changing it in one window reaches the others at once.
- **`"persist": false`**. The value is reset to its default every time the mod starts (app start,
  hot reload, or the master switch coming back on). Use it for any switch that makes the mod
  *do* something to the account, so that it cannot be on again after a restart without the user
  turning it on.

Stored values are validated against the manifest on every read: a hand-edited or older value
cannot give the mod a string where it expects a number.

### The master switch

Every mod gets a switch on its own row of the MOD page, remembered across restarts. Off means
the mod's code is not running at all: its timers, styles and rows are torn down (everything
registered with `mod.onDispose`). Its settings can still be edited while it is off. Switching
it on starts it again.
It is separate from a feature switch such as "开始点击": the master switch is whether the mod is
loaded, the setting is what it is doing.

## API

Inside a mod script, `mod` is:

```js
mod.config.get(key)            // current value of a declared setting
mod.config.set(key, value)     // change it (stored, and every window is told)
mod.config.onChange(key, fn)   // fn(next, previous), whichever window changed it
mod.live(key, value)           // publish the text of a `value` row; null clears it
mod.host.call(name, arg)       // ask the mod's Node part something; a promise of its answer
mod.host.on(name, fn)          // hear what the Node part sends
mod.invoke(cmd, args?)         // call a backend Tauri command, returns a promise
mod.onEvent(name, fn)          // subscribe to a backend event
mod.css(text)                  // inject a stylesheet; returns a remover function
mod.waitFor(selector, opts)    // resolve when an element appears (MutationObserver)
mod.onDispose(fn)              // run fn when the mod stops: reload, deletion, master switch, failure
mod.entry({ title, ... })      // add a row from code (below)
mod.log(...args)               // to the console and to the MOD page's log, under the mod's name
mod.warn(...args)              // the same, as a warning
```

A key that is not declared under `modkit.settings` throws, on purpose: a typo should be an error, not a
setting that always reads its default.

**State and timers belong in the window that runs the mod; the MOD page only shows and changes
settings.** The page and the mod talk through `mod.config` and `mod.live`, which work across
windows, so the mod never needs to know where the page is.

### Rows added from code

When a manifest cannot say it, a mod that runs *in the panel window* can add a row itself:

```js
mod.entry({
  title: '清空缓存',
  button: { label: '清空', onClick: () => clear() },
});
```

Pick one control: `toggle: { value, onChange(next) }`, `button: { label, onClick, disabled? }`,
`number: { value, min?, max?, step?, onChange(next) }`, `value: 'text'`, or
`render: () => HTMLElement` (the app's classes `setting-btn`, `setting-input`, `setting-range`,
`setting-value` are available). Any field may be a value or a function returning one; call
`window.modkit.changed()` after the state changes to redraw. Rows appear in their mod's settings
dialog, after the manifest's settings, and go away when the mod stops. A row is invisible when the mod runs only in
another window, which is why settings are declared in the manifest instead.

## The MOD page

The settings panel has a **MOD** entry in its left navigation. It is part of the framework
(`src/runtime/panel-tab.js`), not a mod: it is injected into every window before any mod runs,
and it cannot be removed by deleting something from `mods/`.

The page is a list. It opens with the same header the 联机 page has, the one place the app puts a
title beside a count: `MOD（3）` (3 mods loaded), and under it the overall state — `全部正常`, or
`1 个出错`. Below it is one row per mod: its name, its description (or the error, if it failed),
a **设置** button when it has anything to set, and the master switch.

The button opens the mod's settings in a dialog: the same layer the 合成 page uses for the
atlas — dimmed over the content with the tab strip left visible, a card with the app's close
button — headed by the mod's name and description, then its settings in the order the manifest
lists them. It closes with the close button, Escape, or a click on the dimmed part, and when the
user leaves the MOD page. Values a running mod publishes with `mod.live` update in place.

The last row of the list is **日志**, the way into the log: a dialog of what mods have written with
`mod.log` / `mod.warn` and a Node part with `host.log` / `host.warn` / `host.error`. One line each,
oldest first and the newest at the bottom, as `time  mod name（window or Node）  text`; a warning or an
error says so in words, since the app's palette has no colour for it. The view follows new lines unless
it has been scrolled up to read, and 清空 clears it in every window. It keeps the latest 500 lines and
nothing is stored: each window keeps what it wrote and the panel collects it, so lines written before
the panel was opened are still there, and a restart starts empty. A mod that fails to load or throws
while starting leaves its error there too.

Everything uses the app's own classes, so fonts, colours and scrollbar match without a mod
writing any HTML or CSS. The app has no section headings, no red and no green, and the page
invents none.

## The Node part

A page cannot write a file, open a socket without CORS, start a program, or use a package from
npm. A mod that needs any of that has a second half that runs in Node, in the loader's process:

```json
{
  "name": "notes",
  "type": "module",
  "modkit": { "host": "host.js", "windows": { "main": "main.js" } }
}
```

```js
// host.js: runs in Node, in a worker thread of its own
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function (host) {
  const file = path.join(host.dataDir, 'notes.txt');          // a folder for this mod; it exists
  host.handle('save', async text => { await fs.appendFile(file, text + '\n'); return 'ok'; });
  host.log('started');
  return () => host.log('stopped');                            // optional: runs when it stops
}
```

```js
// main.js: the page half
const answer = await mod.host.call('save', 'hello');           // 'ok'
mod.host.on('saved', info => mod.log(info));                   // what host.emit('saved', ...) sends
```

Copy `mods/_template-node/` to start. A package with a Node part needs **`"type": "module"`** in its
package.json (Node treats the folder as a package, and warns on every start otherwise).

**It only exists while `watch` is running.** The loader process is what hosts it, so a one-shot
`run` does not start it (and says so), and it stops with `watch`, or when the app is closed. The page
half keeps working without it; `mod.host.call` then rejects with a message that says why (within
a few seconds of the loader going: it tells the pages it is alive every 2 s, and a page does not
wait for a loader it has not heard from).

**When it runs.** While the mod's master switch is on. Switching the mod off stops it (its dispose
hooks run first; one that does not finish within 2 s is killed), switching it on starts a fresh
copy. Editing any source file of the mod's folder that the Node part could import (`.js`, `.mjs`,
`.cjs`, `.json`, not `node_modules`, not the page scripts) restarts it with the new code, imported
files included. A page script edit does not. If it throws on start or crashes later it is
marked broken on the MOD page with the message, and stays stopped until its files change or the
switch is turned off and on. It is a thread, so stopping it ends every timer, socket and child process
it left behind. Settings with `"persist": false` are reset when it starts, as for a page script.

### `host` in host.js

```js
host.id, host.dir, host.dataDir           // the mod's name, its folder, a folder to keep files in
host.log(...), host.warn(...), host.error(...)   // to the loader's output and to the MOD page's log
host.live(key, value)                     // publish the text of a `value` row (what mod.live does); null clears it
host.handle(name, (arg, { window }) => value)   // answers mod.host.call(name, arg); may be async
host.emit(name, arg, { window? })         // to mod.host.on(name, fn): every window, or one
host.evaluate(window, javascript)         // run JavaScript in a window ('main', 'panel', ...) and get the value back
host.config.get(key)                      // the mod's settings, as the MOD page shows them; immediate
host.config.set(key, value)               // store one (through the page, so every window hears of it)
host.config.onChange(key, (next, previous) => ...)
host.onDispose(fn)                        // runs when it stops
```

Arguments, answers and events are copied between threads and windows as JSON-able data. A call that
the Node part does not answer within 30 s rejects. A call made while the part is still starting
waits for it.

**Trust.** The Node part is ordinary Node with no sandbox: it can do anything your user account can.
That is the same standing a page script has (it can call any command the app has), but it is worth
remembering when installing someone else's mod. The usual rule applies to it as to a page script:
anything that acts on the account is behind a `"persist": false` switch.

## Loading and unloading

Editing a mod file reloads it: the old copy is disposed first, then the new one runs. Editing one
window's script reloads only that window's copy. Deleting a mod unloads it on the next pass of
`watch` (or the next `run`). Register timers and listeners with `mod.onDispose` (the
`mod.config.onChange` and `mod.css` helpers do it for you), or they keep running after a reload.

A mod script's top level may `await` and `return`. A mod runs **once per window that has a script
for it**, not once per app; a single-file mod has one for all seven windows, so start it with a
guard:

```js
if (location.hash !== '#/panel') return;   // this mod only cares about the panel
```

## A minimal mod

```js
// mods/hello.js — put a badge on the panel window
if (!location.hash.includes('/panel')) return;

mod.css(`#hello{position:fixed;right:8px;bottom:8px;background:#123;color:#8ff;
  font:12px system-ui;padding:4px 8px;border-radius:6px;z-index:2147483647}`);

const badge = document.createElement('div');
badge.id = 'hello';
badge.textContent = 'hello from a mod';
document.body.appendChild(badge);
```

## Calling the backend

Commands come in two kinds. Both go through `mod.invoke`.

**App commands** take a plain object:

```js
await mod.invoke('get_main_taskbar_insets');            // -> {left, top, right, bottom}
await mod.invoke('set_main_skip_taskbar', { skip: true });
```

**Plugin commands** use a `plugin:` prefix and pipe:

```js
await mod.invoke('plugin:app|version');                 // -> "1.0.1"
await mod.invoke('plugin:autostart|is_enabled');        // -> false
```

Run `node src/cli.js backend-commands` for the full list. Two things to know:

- Some commands require an `environment` argument (`cn-cn-prod` in this build).
  Omitting it fails with `missing required key environment`.
- **Five commands have effects beyond the page** (the list marks them in red):
  `exit_app` ends the app and `plugin:process|restart` restarts it, either one drops the window
  you are working in; `plugin:updater|install` and `plugin:updater|download_and_install` install
  an update; `plugin:webview|clear_all_browsing_data` wipes the cookies, which is the login.

## Seeing console output and errors

Mods run in the page, so their `console.log` goes to the webview console. Watch it
over CDP:

```sh
node src/cli.js eval 'document.getElementById("modkit-tab")?.innerText'
```

Check what is actually installed, per window (`idle` means the mod has no script for that window):

```sh
node src/cli.js state
```

A mod that throws does not break the others: its failure is shown on the MOD page and logged,
and the remaining mods still run.

## Reload behaviour

The app is a Vue SPA spread over several webview windows. Reloading a window
destroys everything a mod added; `watch` notices the navigation and re-injects
within about a second and a half. One-shot `run` does not — use `watch` while
developing.

## What a mod can and cannot reach

A mod lives in the page's JavaScript world. That gives it:

- full DOM/CSS control over every window;
- every registered Tauri backend command, with the app's privileges;
- `localStorage`, shared by every window of the app (it is where the login and the modkit's
  settings live), and `BroadcastChannel` between windows;
- network requests from the page, with the user's session cookies.

It does **not** give it: Rust-side logic, the input hook, the scheduled task, the
updater, or anything else outside the webview. Those need native work (see
`docs/APP-NOTES.md`).

## Rules of thumb

- A single-file mod starts with a `location.hash` guard; a package names its windows in `modkit.windows`.
- Anything user-visible: off by default.
- Anything that acts on the account (clicks, chests, requests): a feature switch with
  `"persist": false`, so it only ever runs because the user turned it on this session. Treat it
  as real, and test it deliberately rather than in a loop.
