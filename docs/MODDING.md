# Writing mods

A mod is code injected into the app's webviews, plus a small description of what it shows
on the MOD page. It comes in two shapes:

```
mods/hello.js            a single script: runs in every window, nothing on the MOD page but a switch
mods/auto-click/         a package: package.json says what it is and what it exposes
  package.json
  main.js                the code that runs in the main window
```

Mods run from `mods\` in the app folder (`E:\Programs\WuwaTappo\mods`). It starts empty: the program
carries no mods, they are installed into it (`mods install`). The repository's `examples/` holds the
templates; start a package by copying `_template` there and dropping the underscore. Files and folders
starting with `_` or `.` are never loaded, so you can keep fragments around.

## Developing a plugin: dev mode

While you write a plugin you do not install it. **Dev mode** uses the folder it is written in, as it is:

```sh
node src/cli.js dev on E:\Projects\wuwatappo-mods\mods   # a folder of plugins, or one plugin's folder
node src/cli.js dev off                                  # back to what is installed in mods\
node src/cli.js dev                                      # where things stand
```

or, in the launcher window, the 开发模式 box (and 选择文件夹… to choose the folder). The loader notices within a
second, with nothing restarted.

- A plugin in a dev folder is used **instead of** an installed one of the same name (the one from the registry is
  left alone, and is back as soon as dev mode is off). Other installed plugins keep working, and may need a plugin
  that is only in the dev folder.
- **Hot reload**: save a file and the page script is injected again, in place of the old copy (it is disposed
  first: `mod.onDispose`), and a Node part is restarted when one of its files changed (not for an edit to a page
  script). A plugin that does not load shows the reason on the MOD page, like any other.
- Nothing is copied and there is nothing to publish; the MOD page marks these plugins 开发中, and the plugin dialog
  does not offer to install, update or remove them (they are not the registry's copy).
- The folders are remembered in `<app folder>\moddata\.modkit\dev.json`, so switching back on is one word.

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
| `modkit.api` | the version of modkit's interface the mod was written for; default `1`; `2` has `mod.app` (below), `3` has `mod.app.store` and `mod.app.action`, `4` has `mod.page` and the pets' elements. A mod that says more than this modkit has is listed as broken ("update modkit") instead of failing in ways nobody can read |
| `modkit.requires` | other mods it needs, with the versions that will do: `{ "other-mod": "^1.2.0" }` (see [Mods using each other](#mods-using-each-other)) |
| `modkit.permissions` | what it will do beyond showing a page, for whoever installs it to read: `["network", "files"]`. Declared, **not enforced** |
| `engines.node` | the standard field: the Node versions it works with, e.g. `">=22"`. A mod needing a newer Node than runs the loader is listed as broken |
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
mod.app                        // the app's own state: the pets' places (API 2, below)
mod.page                       // the pages: each window's components, watching them, putting nodes in (API 4, below)
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

A **日志** button at the right end of the title row (the empty space beside `MOD（3）`, where the room page
puts its 离开房间) opens the log: a dialog of what mods have written with
`mod.log` / `mod.warn` and a Node part with `host.log` / `host.warn` / `host.error`. One line each,
oldest first and the newest at the bottom, as `time  mod name（window or Node）  text`; a warning or an
error says so in words, since the app's palette has no colour for it. The view follows new lines unless
it has been scrolled up to read, and 清空, at the right end of the dialog's own title row, clears it in every window. It keeps the latest 500 lines and
nothing is stored: each window keeps what it wrote and the panel collects it, so lines written before
the panel was opened are still there, and a restart starts empty. A mod that fails to load or throws
while starting leaves its error there too.

Everything uses the app's own classes, so fonts, colours and scrollbar match without a mod
writing any HTML or CSS. The app has no section headings, no red and no green, and the page
invents none.

## The Node part

A page cannot write a file, open a socket without CORS, start a program, or use a package from
npm. A mod that needs any of that has a second half that runs in Node, as a process of its own:

```json
{
  "name": "notes",
  "type": "module",
  "modkit": { "host": "host.js", "windows": { "main": "main.js" } }
}
```

```js
// host.js: runs in Node, in a process of its own
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

A mod's Node part keeps its files in `host.dataDir`, which is `moddata\<mod name>\` in the app folder. It is
created for it; `mods remove <id> --purge` deletes it.

**One process per mod.** Each Node part is a child process of the loader, not a thread and not an
import. A native addon that crashes, or an npm package that assumes it owns the process (changes the
directory, exits, installs signal handlers), takes down only that mod. Its working directory is the
mod's own folder, so `node_modules` next to it and relative paths behave. What it prints with
`console.log` / `console.error` goes to the loader's output and to the MOD page's log, and when it
dies the last thing it printed, the error, is what the page shows as the reason. It cannot outlive
the loader: if the loader goes, so does it. Stopping it ends every timer and socket it left behind,
and, on Windows, every program it started without `detached: true` (a program it starts detached is
the mod's own business).

**When it runs.** While the mod's master switch is on, and every mod it requires is up. Switching the mod off stops it (its dispose
hooks run first; one that does not finish within 2 s is killed), switching it on starts a fresh
copy. Editing any source file of the mod's folder that the Node part could import (`.js`, `.mjs`,
`.cjs`, `.json`, not `node_modules`, not the page scripts) restarts it with the new code, imported
files included. A page script edit does not. If it throws on start or crashes later it is
marked broken on the MOD page with the message, and stays stopped until its files change or the
switch is turned off and on. Settings with `"persist": false` are reset when it starts, as for a page script.

### `host` in host.js

```js
host.id, host.dir, host.dataDir           // the mod's name, its folder, a folder to keep files in
host.log(...), host.warn(...), host.error(...)   // to the loader's output and to the MOD page's log
host.live(key, value)                     // publish the text of a `value` row (what mod.live does); null clears it
host.handle(name, (arg, { window }) => value)   // answers mod.host.call(name, arg); may be async
host.provide(name, (arg, { from }) => value)    // a service other mods may call (below)
host.call(mod, name, arg)                 // a service of a mod this one requires; rejects if it is not running
host.emit(name, arg, { window? })         // to mod.host.on(name, fn): every window, or one
host.evaluate(window, javascript)         // run JavaScript in a window ('main', 'panel', ...) and get the value back
host.config.get(key)                      // the mod's settings, as the MOD page shows them; immediate
host.config.set(key, value)               // store one (through the page, so every window hears of it)
host.config.onChange(key, (next, previous) => ...)
host.onDispose(fn)                        // runs when it stops
```

Arguments, answers and events are copied between processes and windows as JSON data. A call that
the Node part does not answer within 30 s rejects. A call made while the part is still starting
waits for it.

**Trust.** The Node part is ordinary Node with no sandbox: it can do anything your user account can.
That is the same standing a page script has (it can call any command the app has), but it is worth
remembering when installing someone else's mod. The usual rule applies to it as to a page script:
anything that acts on the account is behind a `"persist": false` switch.

## Mods using each other

A mod that builds on another says so, and may then use what the other offers:

```json
{ "name": "report", "modkit": { "host": "host.js", "requires": { "notes": "^1.0.0" } } }
```

```js
// notes/host.js: offers a service
host.provide('append', async ({ text }) => { await fs.appendFile(file, text + '\n'); return 'ok'; });

// report/host.js, or from a page script with mod.call('notes', 'append', { text })
await host.call('notes', 'append', { text: 'hello' });
```

- **Only what is listed in `requires`** can be called. Calling a mod that is not listed is refused
  with a message that says to add it. The service is told who is calling (`{ from }`).
- **What is required has to be there.** Missing, broken, a version outside the range (the standard
  ranges: `1.2.3`, `^1.2.0`, `~1.2`, `>=1 <3`, `1.x`, `||`; a mod with no `version` satisfies only
  `*`), or a loop of mods needing each other: the mod is listed as broken with that said, and so is
  whatever required it.
- **Order.** A Node part starts after the Node parts of the mods it requires are ready, waits (the MOD
  page says `等待：…` and for whom) while any of them is off or not up, and is stopped when one stops and
  started again when it is back. A required mod with no Node part counts once its switch is on.
- A call to a service that is not running rejects with the reason; it does not wait.

## Installing mods

```sh
node src/cli.js mods browse               # the plugin registry (docs/REGISTRY.md); `mods get <name>` installs one
node src/cli.js mods install <source>     # a folder, a .zip / .tgz, a git URL (add #branch), an npm package name, or a .js file
node src/cli.js mods list                 # what is installed, where from, whether it loads
node src/cli.js mods update [id]          # ask the same place again (every installed mod if no id)
node src/cli.js mods remove <id> [--purge]
```

Install first shows what the mod declares — whether it has a Node part (which runs with the rights of
your account), its `permissions`, the mods it needs, the npm packages it depends on — then puts it in
`mods/<id>/` and remembers where it came from (`.modkit-source.json`) for `update`. A running
`watch` / `start` picks it up by itself.

- **npm dependencies** of the mod are installed with `npm install --omit=dev --ignore-scripts`, so a
  dependency's install script does not run unless you say `--allow-scripts` (some native packages
  need it). `--no-deps` skips them. This is what lets a mod's `host.js` `import` an npm package.
- A mod that already exists needs `--force`, or `update`. An update that cannot be installed
  (invalid manifest, a dependency that cannot be fetched) leaves the old version exactly as it was.
- A mod that is renamed at its source is a new mod, not an update of the old one.
- `remove` keeps what the mod's Node part wrote (`moddata\<id>` in the app folder) unless `--purge`. Its settings
  are in the app's storage and are used again if it is installed again.
- Mods are not signed or reviewed: install what you would run.

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

## The app's own state: `mod.app`

Some of what the app knows is in no command and no element: where the person's pet is, and where each other
player's pet is, are variables inside the app's own script (the page is drawn from them, so editing the page
changes nothing the app knows about, and the saved place is read once, at start). A mod that needs them says so in
`package.json`, and the loader opens them:

```json
"modkit": { "api": 2, "permissions": ["app-internals"], "windows": { "main": "main.js" } }
```

While an installed mod declares `app-internals`, the loader holds the main window's scripts at their response, adds a
few statements to the app's main one on its way into the page (`src/lib/app-patch.js`: they hand out what is
listed below, nothing else is changed, and nothing on disk is touched), and loads that window once more so that the
page reads it. The person is told when they install it ("读取并改动应用内部状态"), and the main window loads again once
each time the app starts (a second or two). With no such mod installed, nothing is held or changed.

```js
mod.app.available()             // true when it is open in this window (the main one); false elsewhere
mod.app.status()                // { applied, missing }: what the loader could add to the app's script, or null
mod.app.pet.position()          // { left, top } of the person's own pet, in the page's pixels, or null
mod.app.pet.move(left, top)     // put it there, as if it had been dragged there (the app clamps it and saves it, and the window is told where it is)
mod.app.pet.onDragged(fn)       // the person let go of it after dragging it; returns what stops listening
mod.app.members.list()          // [{ id, left, top, draggable }]: the other players' pets in the room
mod.app.members.place(id, l, t) // put one there (and the window is told where it is); false when it is not in the room or cannot be moved
mod.app.members.clamp(l, t)     // { left, top }: the nearest place the app lets a pet be at
mod.app.members.onDragged(fn)   // fn(id): the person let go of a player's pet after dragging it
```

Two more need no change of the app's script, and work in every window (declare `"api": 3`, and "app-internals" so that
the person is told):

```js
mod.app.store.available()        // the app's stores (Pinia) can be read here
mod.app.store.names()            // ["GlobalState"]
mod.app.store.state(name)        // a plain copy of a store's state, or null (all of it: the login too)
mod.app.store.raw(name)          // the store itself, with its actions (updateUserInfo, setLocalClickCount, ...); null when there is none
mod.app.store.onAction(name, fn) // fn({ action, args, after(cb), onError(cb) }) when the app runs one of the store's actions
                                 // (applyClickReportSuccess, setLocalClickCount, ...); it is only watched, nothing is replaced
mod.app.action(type, payload)    // a command of the kind the app's panel sends its main window (the event "cat-panel-action"):
                                 // set-pet-hidden { hidden }, set-room-id-input { value }, create-room, join-room, leave-room,
                                 // toggle-room-member { memberId }, ... (APP-NOTES.md lists the ones the app has)
```

Nothing here is held back: a mod can read all of a store and call its actions, and send any command, as it could
through `mod.invoke` and the page anyway; what it does is the mod's own, and is what its `permissions` should say.

The places of the other players' pets are the app's own and local: setting one does not send anything to the room.
The pets are told as `left` / `top` of the dock, the same numbers the page's `style` has. A pet that is not yet in
its slot (`data-room-cat-positioned` is not `"true"` on its element) has no place of its own to set.

The script is minified, so the loader looks for the shape of the functions it needs and for the names of what they
return (property names survive minifying, local names do not). When an app version changes the shape, the piece it
cannot find is listed in `status().missing`, `available()` is false, and nothing of the app is broken: the mod says it
cannot work with that version and waits for a loader that can. The extracted scripts of 1.0.2 and 1.0.3 are both
found by it (`tests/app-patch.test.js` runs on them when they are extracted).

What a mod does with it is its own: the pet-position plugin in the registry is the example (remember where the person
dragged each pet, put it back after a restart or a room).

## The pages: `mod.page` and the pets as elements

Every window is a page drawn from Vue components with names (`MainPanelBagTab`, `SettingsModule`, `EmotionMenu`, ...). `mod.page`
finds them, tells when one appears (a tab opened, a dialog shown), and puts a node of the mod's own into the page and
keeps it there when the app draws that part again. It works in every window (declare `"api": 4`), and needs nothing
patched:

```js
mod.page.window                     // "main", "panel", "login", "update", "toast", "about", "oss-notice"
mod.page.route()                    // "/", "/panel", ...
mod.page.components()               // [{ name, el, props }] on the page now; el is null for one without an element of its own
mod.page.find(name)                 // the first with that name, or null
mod.page.onComponent(name, fn)      // fn({ name, el, props }) now and each time one appears; what fn returns runs when it goes away
mod.page.onElement(selector, fn)    // the same for an element, by selector
mod.page.mount(target, node, opts)  // put a node in and keep it there; target is an element, a selector, or { component: name };
                                    // opts.where is "append" (default), "prepend", "before" or "after"; returns what takes it away

mod.app.pet.element()               // .pet-dock       (the whole dock)
mod.app.pet.content()               // .pet-dock-content (the pet's body)
mod.app.pet.onElement(fn)           // fn(el) when the body appears (and again if the app draws it anew)
mod.app.pet.css(text)               // a stylesheet nested under the pet's body: mod.app.pet.css('.cat-mainbox { filter: drop-shadow(0 0 10px gold) }')
mod.app.members.element(id)         // a player's pet as an element
mod.app.members.onElement(fn)       // fn(el) for each player's pet as it appears
mod.app.members.css(text, id?)      // a stylesheet for all the players' pets, or the one
```

`mount` is what a mod puts things on a page with: the page is drawn again by the app (a tab is left and opened again, a
list is redrawn), and what was put in by hand is gone, so the node is looked after: when its target is drawn anew it is put
back, when the target is gone it is taken out, and when the mod stops it goes. Components are named by the app's own
source (they survive minifying): the pet window has `index`, `EmotionMenu`, `RewardCountdownBubble`; the panel has
`MainModulePanel` with a tab each (`SettingsModule`, `MainPanelBagTab`, `MainPanelRoomTab`, ...), and inside them `BagAtlas*`,
`ShortcutInput`, `RoleSwitchEmoteConfirmOverlay`; the login window has `LoginDialogs`, `LoginSelectDialog`,
`ForeignRoleSelectDialog`, `UidLoginDialog`. `mod.page.components()` lists what a page has now.

What is put into a component is plain DOM (the page is not Vue's to the mod): the app does not know of it, and an update
of the app can change a component's markup. A mod keeps to the component's outer element and its own nodes.

## What a mod can and cannot reach

A mod lives in the page's JavaScript world. That gives it:

- full DOM/CSS control over every window;
- every registered Tauri backend command, with the app's privileges;
- `localStorage`, shared by every window of the app (it is where the login and the modkit's
  settings live), and `BroadcastChannel` between windows;
- network requests from the page, with the user's session cookies;
- with "app-internals", the pets' places (above).

It does **not** give it: Rust-side logic, the input hook, the scheduled task, the
updater, or anything else outside the webview. Those need native work (see
`docs/APP-NOTES.md`).

## Rules of thumb

- A single-file mod starts with a `location.hash` guard; a package names its windows in `modkit.windows`.
- Anything user-visible: off by default.
- Anything that acts on the account (clicks, chests, requests): a feature switch with
  `"persist": false`, so it only ever runs because the user turned it on this session. Treat it
  as real, and test it deliberately rather than in a loop.
