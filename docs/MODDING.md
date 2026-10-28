# Writing mods

A mod is a `.js` file in `mods/`. It runs inside each app webview after the Tauri
bootstrap is ready, in an async function — so `await` works at the top level.
The last expression (or a `return`) is recorded as the mod's result.

Files whose names start with `_` or `.` are ignored, so you can keep fragments
around without them loading.

## API

```js
mod.invoke(cmd, args?)      // call a backend Tauri command, returns a promise
mod.css(text)               // inject a stylesheet; returns a remover function
mod.entry({ title, description?, render? })   // add a card to the MOD page (see below)
mod.onDispose(fn)           // run fn when this mod is unloaded (reload, delete, failure)
mod.onEvent(name, fn)       // subscribe to a backend event
mod.waitFor(selector, opts) // resolve when an element appears (MutationObserver)
mod.log(...args)            // console.log, prefixed with the mod name
mod.warn(...args)           // same, as a warning
```

### The MOD page

The settings panel has a **MOD** entry in its left navigation. It is part of the
framework (`src/runtime/panel-tab.js`), not a mod: it is injected into every window
before any mod runs, so `mod.entry` is always available, and it cannot be removed by
deleting something from `mods/`.

The page lists the mods that are loaded (with an "error" row and the message if one
failed) and, below that, every card added through `mod.entry`:

```js
mod.entry({
  title: '自动点击',
  description: '一句话说明',
  render() {                       // optional; called each time the page is drawn
    const b = document.createElement('button');
    b.textContent = running ? '停止' : '开始';
    b.onclick = () => { toggle(); window.modkit.changed(); };   // ask for a redraw
    return b;
  },
});
```

- `render()` runs on every redraw, so build the element from the mod's current state
  instead of caching it.
- Call `window.modkit.changed()` after the state behind a card changes.
- A card is removed automatically when its mod is unloaded. That includes a mod that
  throws partway through: whatever it had already added is undone, and the error shows
  on the MOD page.

### Loading and unloading

Editing a mod file reloads it in every open window: the old copy is disposed first
(its cards, styles and anything registered with `mod.onDispose` go), then the new one
runs. Deleting a mod file unloads it the same way on the next pass of `watch` (or
the next `run`). Register timers and listeners with `mod.onDispose` or they will keep
running after a reload.

Mods run **once per window**, not once per app. There are seven windows:
`main`, `panel`, `login`, `update`, `toast`, `about`, `oss-notice`. Most mods
should start with a guard:

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

Run `node src/cli.js commands` for the full list. Two things to know:

- Some commands require an `environment` argument (`cn-cn-prod` in this build).
  Omitting it fails with `missing required key environment`.
- **`exit_app` terminates the app.** Do not call it while iterating; you will
  lose the window you are working in.

## Seeing console output and errors

Mods run in the page, so their `console.log` goes to the webview console. Watch it
over CDP:

```sh
node src/cli.js eval 'document.getElementById("modkit-tab")?.innerText'
```

Check what is actually installed, per window:

```sh
node src/cli.js state
```

A mod that throws does not break the others: its failure is recorded as
`{ status: 'error' }` and logged, and the remaining mods still run.

## Reload behaviour

The app is a Vue SPA spread over several webview windows. Reloading a window
destroys everything a mod added; `watch` notices the navigation and re-injects
within about a second and a half. One-shot `run` does not — use `watch` while
developing.

## What a mod can and cannot reach

A mod lives in the page's JavaScript world. That gives it:

- full DOM/CSS control over every window;
- every registered Tauri backend command, with the app's privileges;
- `localStorage` of the test profile (remember: separate from the real install);
- network requests from the page, with the user's session cookies.

It does **not** give it: Rust-side logic, the input hook, the scheduled task, the
updater, or anything else outside the webview. Those need native work (see
`docs/APP-NOTES.md`).

## Rules of thumb

- Start with a `location.hash` guard.
- Keep timers in a module-scope variable and clear them on `hashchange` if the
  window reuses the document.
- Anything user-visible: make it off by default with a toggle.
- Anything that spends in-game resources or reaches the server: treat as real and
  test deliberately, not in a loop.