# App notes

Reverse-engineering notes for Wuwa Tappo 1.0.1. What is here was learned by static
analysis of the binary plus live inspection over CDP. Nothing here is official.

## Binaries

`E:\Programs\WuwaTappo\`

| file | notes |
|---|---|
| `WuwaTappo.exe` | 74 MB, Rust + Tauri 2.10.3. Kuro signature, **HashMismatch**. Manifest requires administrator. |
| `uninstall.exe` | 67 MB, PDB name `wuwa_uninstaller_shell`. Signature valid. |

Both are x64, no .NET/comctl CLR directory, no Go build id. Rust panic paths
(`...\.cargo\registry\src\index.crates.io-...`) survive in the binary, which is
what makes the dependency set readable: `tauri 2.10.3`, `tao 0.34.6`,
`hyper-util 0.1.20`, `tauri-plugin-single-instance 2.4.2`.

## Frontend

Vite + Vue 3.5, brotli-compressed into `.rdata`, 127 assets. Unpack with
`node src/cli.js extract-assets` into `work/assets/assets/`. The bundle is
minified but not obfuscated; module boundaries and function names survive.

Windows are separate webviews, one route each:

| route | window |
|---|---|
| `/` | main pet window |
| `#/panel` | settings / bag panel (see "The panel only renders while open") |
| `#/login` | login |
| `#/update` | update overlay |
| `#/toast` | toast host |
| `#/about` | about |
| `#/oss-notice` | open-source notice |

162 backend commands in 1.0.2 (`node src/cli.js backend-commands` lists them, and marks the five
that end the app, install an update, or wipe the login). An earlier version of that command
reported 117: it assumed Tauri's `invoke` was exported under a fixed name, which was only true of
some of the calls.

## Networking

API host in this build: `kurowuwabuddy2602.test.modiarts.com` — a `test` hostname
in a release build. Update manifest:
`https://kurowuwabuddy2602.test.modiarts.com/app/json-host/latest_host.json`,
minisign-verified by the Tauri updater. Installer download host:
`download-mc-wuwatappo.kurogames-global.com`.

Endpoints the frontend calls:

```
api/auth/login            api/frontend/user/me         api/frontend/chests/open
api/auth/uid-login        api/frontend/user/logout     api/frontend/bags/list
api/auth/uid-send-code    api/frontend/user/renew-token api/frontend/rooms
api/auth/player/query     api/common/activity-config   api/frontend/rooms/join
api/common/atlas          api/frontend/presets         api/frontend/redeems/use
api/frontend/assets/synthesis
api/frontend/assets/favorites (and /cancel)
```

## Where state lives

```
%APPDATA%\com.kuro.wuwatappo.cn\
  cumulative_click_cn-cn-prod.dat
  key_press_count_cn-cn-prod.dat
  ui-locale.txt
%LOCALAPPDATA%\com.kuro.wuwatappo.cn\
  logs\Wuwa Tappo.log          # plain-text boot/socket/settings log
  EBWebView\                   # WebView2 profile: localStorage holds the auth token
```

The click counters are tiny plain files read/written through
`load_*_count` / `save_*_count`. They are local display state, not authority.

## Auth

- Inland: Kuro KrSDK (`KrSDK.core.init`, `openLoginView`) loaded as a script tag.
- Overseas: an OAuth page whose URL is **not configured in this build** —
  the code throws `未配置 VITE_OVERSEAS_AUTH_PAGE_URL`.
- Token: `__KrSDK_USER_TOKEN__` / `__KrSDK_USER_INFO__` in `localStorage`.

## The click economy

This is the part worth understanding before automating anything.

**Clicks are local.** Clicking the pet increments `localClickCount` in the store.
Nothing is sent. The counter is flushed to disk periodically.

**Only one thing syncs clicks to the server:** logout. `userLogout(click_num)`
(`POST api/frontend/user/logout`). The server returns the authoritative total, and
the store adopts it (`applyClickReportSuccess`). There is no separate heartbeat
endpoint; `reportHeartbeat` is analytics only.

**Chests are server-side.** `openChest({place, click_num})`
(`POST api/frontend/chests/open`) sends the client's cumulative click count; the
server decides the cost (`click_consume`), deducts, rolls the reward, and returns
the item. The client only renders the result.

Consequences:

- Editing the local counter (`save_key_press_count`) changes what the UI shows, but
  the server's own numbers are what a chest opening is judged against.
- Real automation must produce real clicks, through the app's own click path, so
  the counter grows through the normal route. A synthetic counter that the server
  has never seen will not buy chest openings.

### What counts a click, and what animates the pet

The main window listens for native events (`plugin:event|emit` from the page reaches the same
listeners as the Rust hook's). Read from the 1.0.2 main-window bundle; the pet's pose is a ref
(1 idle, 2 left paw, 3 right paw, left and right alternate) that picks the body image.

| event | counts | pet animation |
|---|---|---|
| `global-clap-mouse` | on receipt (+1) | on receipt: paw down, back to idle after 220 ms |
| `gamepad-button-press` | on receipt (+1) | same |
| `mouse-button` (`press`, left) | on receipt, with hit-testing on the coordinates | same |
| `key-press` | not counted, except F5 in game mode | paw down, 220 ms timer |
| `key-release` | **counted here**, for a key that had been pressed | paw put back at once |

Consequences for anything that fakes input:

- A duration is never measured; only the order of events matters.
- One `global-clap-mouse` is the whole click: count and animation, no payload read, nothing to
  pair. The auto-click mod uses it.
- Keyboard events are the awkward route. A press followed straight away by its release counts
  but leaves the animation on screen for milliseconds (the release resets the pose), and a press
  that is never released makes the app ignore that key from then on. F5, F7 and F8/F9 have other
  jobs (game mode, switching screens).
- Observed on a running app: with clicks arriving every 100 ms the body image alternates between
  a paw-down image and the idle image roughly every 5 ms and 110 ms, which is the key route
  collapsing its own animation.

There is also a client-side gate: the click handler refuses to open below
`totalClickCount < As` before calling the API at all, and the animation function
`wp()` already serialises clicks on its own timeline (it `await`s the animation
before the next one counts).

## Native side — not yet examined

- Global input hook: `SetWindowsHookExW`, `GetAsyncKeyState`, `SendInput`, with a
  log line `input grab failed, fallback listen`.
- Elevated autostart: writes a task XML and runs
  `schtasks /Create /TN wuwatappo.global /XML ...`, logon trigger with a 5 s delay,
  purpose stated in the task description as "align requireAdministrator".
- Updater: Tauri updater with a minisign public key embedded.

These are all outside the webview and therefore outside what the mod loader can
change. Reaching them means a native hook (proxy DLL + MinHook) or a binary patch,
both of which need disassembly work first.

## The panel only renders while it is open

The panel window (`#/panel`) is created at startup and sits on a static
`Loading…` until the **main window** tells it to render. The protocol, read from the
1.0.2 bundle:

- main -> panel: event `cat-panel-state`, a full snapshot; sent by the main window
  only while its own flag for "panel is open" is true
- panel -> main: event `cat-panel-action`; on mount the panel sends `{type:"ready"}`
- the flag is set by the pet toolbar's settings button (`.settings-btn`); calling the
  Rust command `open_panel_window` directly only shows the window and does **not** set
  it

Consequences when tooling:

- right after launch the panel has no `.tab-btn` elements at all; that is normal, not
  a hang — it appears when the user opens the panel
- reloading the panel (`Page.reload`, `location.reload()`) renders it again only if the
  main window currently thinks it is open; otherwise it stays on `Loading…` until the
  settings button is clicked. Re-sending `ready` by hand does not help
- anything that needs the panel's DOM must wait for it (`mod.waitFor`, or a
  `MutationObserver`), and must survive the panel being closed and reopened

Measured with a control experiment: reload while closed -> stays on `Loading…`;
click the settings button -> renders in 0.25 s; reload again (now open) -> renders in
0.25 s by itself. Network latency to the app's servers is not involved (the dictionary
and config requests return in well under 200 ms).

## Autostart under the patch

The app registers a logon task, `\WuwaTappo\ElevatedAutostart` (trigger: logon + 5 s,
`RunLevel = Highest`, action: the installed exe). That task was created while the app
was still running as administrator, and it keeps working after patching: it launches the
patched exe with a highest-privilege token, so the app comes up elevated at logon.

What the patch does take away is the app's ability to *manage* the task. Started as a
normal user, `schtasks /Create` and `/Delete` are refused, so toggling "start with
Windows" in the settings page no longer changes anything, and the app logs an
`unhandled_rejection` ("schtasks create failed") on each start while that setting is on.
This is harmless to rendering — the failure is not awaited — but the toggle is inert.
To change autostart, run `lab --restore` (back to the administrator build), change the
setting, then `lab` again.

## Frontend assets change with every app version

The extracted bundle (`work/assets`) is specific to the build it came from: chunk file
names carry content hashes and all of them change on an update. After the app updates,
re-extract from the stock backup before reading any code:

```sh
node src/cli.js extract-assets "E:\Programs\WuwaTappo\WuwaTappo.exe.orig" work/assets
```

Reading a stale bundle misleads: an earlier pass of this investigation analysed the
1.0.1 sources against a running 1.0.2 app.

## The panel's tab strip

Measured from the running app, and what the MOD tab is built around:

- **Highlight is driven by the main window, not by the click.** Pressing a tab sends
  `tab-click` to the main window; it answers with a snapshot whose `activeTab` makes Vue
  repaint `.tab-btn--active`. If the pressed tab is already the selected one the main
  window sends nothing, so nothing repaints. Anything that removes the class by hand (the
  MOD tab does, while its page is open) has to put it back itself.
- **Two icon images per tab**, swapped by CSS when selected:
  unselected 48x48, glyph ~26px, colour `240,206,169` (light, reads on the dark sidebar);
  selected 54x54, glyph ~29px, colour `142,94,67` (dark, sits on the bright pill).
  One dark image for both states makes the unselected tab vanish into the sidebar.
- **Folding replaces every label with an empty comment node** (`v-if`) and adds
  `.tab-bar--collapsed`; the buttons themselves are the same elements before and after.
  Buttons are therefore identified by position, never by label text. The highlight stays
  on the selected tab while folded.
- The selected-state look (border, pill, label colour) comes from
  `.tab-btn--active:not(:last-of-type)`. A button placed *before* the last one gets it for
  free; that is why the MOD tab sits just before the fold toggle.

### Testing it by hand

Check the precondition before trusting any result: **the main window must consider the
panel open**. Ask it (emit `cat-panel-action {type:"ready"}` and see whether a
`cat-panel-state` snapshot comes back) instead of inferring it from the panel's DOM,
which can show a stale, open-looking panel while the main window thinks it is closed.
Several wrong conclusions in this project came from skipping that check; `tests/` does it.
Use real mouse events (`Input.dispatchMouseEvent`), not `element.click()`.

## The settings page's markup and look

Read from the running app (computed styles) and the stylesheet. The classes are global
(no `data-v-*` scoping), so any element carrying them is styled by the app. The MOD page
is built from exactly this.

```
div.module-block.settings-module     padding 90px 26px 32px 32px, flex column
  div.panel-content                  overflow-y:auto, 5px scrollbar styled by the app
    div.setting-item                 #fbedd5, radius 5px, padding 8px 26px, margin-bottom 10px
      div.setting-label
        div.setting-title            18px, #8e5e43
        div.setting-sub              14px, #8e7b6a     (optional)
      div.setting-content            the control
        label.setting-switch > input[type=checkbox] + span.setting-slider
        button.setting-btn           input.setting-input     input.setting-range
        span.setting-value           18px, #8e7b6a
```

Font family is the app's bundled `975MaruSC`. Spacing between rows is each row's own
`margin-bottom: 10px`, not a gap on the container. An earlier version of the MOD page used
hand-picked 12-14px system-font cards, which is why it looked out of place.

The text styles on the real settings page, by (size, colour): 18px `#8e5e43` (titles, buttons,
inputs), 18px `#8e7b6a` (values), 14px `#8e7b6a` (subtitles); copyright block 13px. The
stylesheet's whole palette is browns, creams and oranges — **no red and no green anywhere** —
and the page has **no section headings**. Check a new page the same way: collect the
computed (size, colour, family) of every text-bearing element and diff the set against the
settings page; anything extra is out of place.

### Titles across the panel's pages

Surveyed from the panel chunk and the stylesheet. Only the 联机 page has a page title:

```
div.room-info
  div.room-qty        20px #8e5e43, line 24px, margin-bottom 10px   "房间（5/20）"  (rooms_member_count)
  div.room-number     18px #8e7b6a, line 22px                         "房间号： xxxx"
  button.common-btn.leave-room-btn   absolute, bottom right
ul.room-members       margin-top 28px
```

Settings has no heading at all; 背包 has `.my-preset-title` (18px #8e7b6a) and 合成 a 14px
centred `.synthesis-tip`; 图鉴 is a grid. The count is written as a noun plus a full-width
parenthesis, which is how the MOD page words its own: `MOD（3）`. Strings come from the
server (`/app/dict/zh.json`), not the bundle, which is why they are not greppable locally.
Measured on the live page, the MOD header and the room header agree on size, colour, line
height, left edge and width.

## What the seven windows share

Measured on the running app, because the mod system's cross-window design rests on it:

- **`localStorage` is one store.** All seven windows read the same 13 keys (they share the
  `tauri.localhost` origin and the WebView2 profile). A write in one window fires a `storage`
  event in the other six, but not in the writer.
- **`BroadcastChannel` reaches every window.** A message posted in the panel arrived in the
  other six, and not back in the sender.
- So a setting written in the panel is visible in main at once, and nothing needs to go through
  the Rust side. Settings are stored under `modkit:cfg:<id>`, `modkit:tmp:<id>` (values that
  reset when the mod starts) and `modkit:on:<id>` (master switch); run state and live figures
  are only sent over the channel, so a restart cannot leave stale ones behind.
- The profile is the app's own, so `clear_all_browsing_data` (which wipes the login) wipes the
  stored settings with it.

## Processes the loader starts

Measured on Windows: a child process Node starts without `detached` is gone within 1.5 s of its parent
exiting, whether the parent exits by itself or is killed (libuv puts non-detached children in a job
object that closes with the parent). So a mod's Node part, started with `fork()`, ends when the loader
does, and whatever it started (not detached) ends when it does; no cleanup code is needed or present.

## Calling out of a window

The loader can be called by the pages, not only the other way round: `Runtime.addBinding` adds a
function to every window (the app's WebView2 supports it), and a call to it arrives as a
`Runtime.bindingCalled` event on the DevTools session. This is how a mod's Node part is reached
(see docs/MODDING.md). Measured on the running app:

- on `main` and `panel` the call arrives with its payload intact;
- **the function stays in the window after the session that added it has closed** (a new session
  still finds `typeof binding === 'function'`). Its being there therefore says nothing about
  whether anyone is listening, which is why the loader beats every 2 s and a page only calls out
  within 6 s of the last beat;
- `Runtime.removeBinding`, sent from another session, did not take it out of the page that was
  already open; `delete window.<name>` did. Probes that add a binding must clean up like that.
