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
mod.onEvent(name, fn)       // subscribe to a backend event
mod.waitFor(selector, opts) // resolve when an element appears (MutationObserver)
mod.log(...args)            // console.log, prefixed with the mod name
mod.warn(...args)           // same, as a warning
```

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