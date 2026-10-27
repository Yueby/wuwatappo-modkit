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
| `#/panel` | settings / bag panel |
| `#/login` | login |
| `#/update` | update overlay |
| `#/toast` | toast host |
| `#/about` | about |
| `#/oss-notice` | open-source notice |

45 backend commands; `node src/cli.js commands` lists them.

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