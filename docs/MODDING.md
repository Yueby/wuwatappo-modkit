# Writing mods

A mod is code injected into the app's webviews, plus a small description of what it shows
on the MOD page. It comes in two shapes:

```
mods/hello.js            a single script: runs in every window, nothing on the MOD page but a switch
mods/auto-click/         a package: mod.json says what it is and what it exposes
  mod.json
  main.js                the code that runs in the main window
```

Start a package by copying `mods/_template/` and dropping the underscore. Files and folders
starting with `_` or `.` are never loaded, so you can keep fragments around.

## mod.json

```json
{
  "name": "自动点击",
  "version": "0.2.0",
  "description": "按设定间隔模拟按键，增加点击数",
  "scripts": { "main": "main.js" },
  "settings": [
    { "key": "running",  "type": "toggle", "title": "开始点击", "default": false, "persist": false },
    { "key": "interval", "type": "number", "title": "点击间隔（毫秒）", "default": 200, "min": 50, "max": 5000, "step": 10 },
    { "key": "state",    "type": "value",  "title": "状态", "default": "未运行" }
  ]
}
```

| field | meaning |
|---|---|
| `id` | optional; if given it must equal the folder name (the folder name is the id) |
| `name`, `description`, `version` | shown on the MOD page (`name` defaults to the id) |
| `defaultEnabled` | whether the master switch starts on; default `true` |
| `scripts` | which file runs in which window: `{ "main": "main.js", "panel": "ui.js" }`, or `"*"` for all of them. Default: `index.js` in every window |
| `settings` | what the MOD page shows under the mod, in order (below) |

Windows are `main`, `panel`, `login`, `update`, `toast`, `about`, `oss-notice`. A mod only runs in
the windows named in `scripts`; every window still receives the manifest, because the MOD page
is drawn in the panel while the code usually runs in main. That is why `settings` are data, not
code: the panel can draw them without running anything.

A manifest that does not parse or does not validate is not ignored: the mod is listed on the
MOD page as broken, with the reason. The same goes for a script that fails to compile or throws
while starting (whatever it had already added is undone).

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
registered with `mod.onDispose`), and its settings are hidden. Switching it on starts it again.
It is separate from a feature switch such as "开始点击": the master switch is whether the mod is
loaded, the setting is what it is doing.

## API

Inside a mod script, `mod` is:

```js
mod.config.get(key)            // current value of a declared setting
mod.config.set(key, value)     // change it (stored, and every window is told)
mod.config.onChange(key, fn)   // fn(next, previous), whichever window changed it
mod.live(key, value)           // publish the text of a `value` row; null clears it
mod.invoke(cmd, args?)         // call a backend Tauri command, returns a promise
mod.onEvent(name, fn)          // subscribe to a backend event
mod.css(text)                  // inject a stylesheet; returns a remover function
mod.waitFor(selector, opts)    // resolve when an element appears (MutationObserver)
mod.onDispose(fn)              // run fn when the mod stops: reload, deletion, master switch, failure
mod.entry({ title, ... })      // add a row from code (below)
mod.log(...args)               // console.log, prefixed with the mod name
mod.warn(...args)              // same, as a warning
```

A key that is not declared in `mod.json` throws, on purpose: a typo should be an error, not a
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
`window.modkit.changed()` after the state changes to redraw. Rows appear under their mod's own
row while it is on, and go away when it stops. A row is invisible when the mod runs only in
another window, which is why settings are declared in the manifest instead.

## The MOD page

The settings panel has a **MOD** entry in its left navigation. It is part of the framework
(`src/runtime/panel-tab.js`), not a mod: it is injected into every window before any mod runs,
and it cannot be removed by deleting something from `mods/`.

The page opens with the same header the 联机 page has, the one place the app puts a title beside
a count: `MOD（3）` (3 mods loaded), and under it the overall state — `全部正常`, or `1 个出错`.
Below it, for each mod: its own row (name, description or the error, and the master switch), then
— while it is on — its settings in the order the manifest lists them. Mods are told apart by
spacing only: the app has no section headings, no red and no green, and the page invents none.
Everything uses the app's own classes, so fonts, colours and scrollbar match without a mod
writing any HTML or CSS.

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

- A single-file mod starts with a `location.hash` guard; a package names its windows in `scripts`.
- Anything user-visible: off by default.
- Anything that acts on the account (clicks, chests, requests): a feature switch with
  `"persist": false`, so it only ever runs because the user turned it on this session. Treat it
  as real, and test it deliberately rather than in a loop.
