# Launching a debuggable copy

`node src/cli.js lab` builds and starts it. This page explains why it is not simply
"run the exe with an environment variable".

## Two blockers in the installed app

**1. It demands administrator.** The manifest has
`<requestedExecutionLevel level="requireAdministrator" />`. A process started from a
normal shell inherits that shell's token, so launching it from an unelevated
terminal is refused before our environment variables matter, and we cannot attach
anything to a process we cannot start consistently.

**2. It is single-instance, keyed by bundle id.** `tauri-plugin-single-instance`
takes a mutex from the identifier `com.kuro.wuwatappo.cn`. If a real install is
already running, a second copy starts, forwards its arguments to the first, and
exits — no second webview, no debug port. The same identifier also picks the
WebView2 user-data folder (`%LOCALAPPDATA%\com.kuro.wuwatappo.cn\EBWebView`), so
sharing it would mean sharing cookies and localStorage with the real install.

## What the test copy changes

Two replacements, both **the same byte length as the original**, so no PE offset,
section table entry, or signature blob moves:

| original | replacement | effect |
|---|---|---|
| `level="requireAdministrator"` | `level="asInvoker"` | runs from a normal shell |
| `com.kuro.wuwatappo.cn` | `lab.kuro.wuwatappo.cn` | separate mutex, separate data folder |

No code is modified. The app behaves identically; it just does not require elevation
and does not collide with a real install.

Built copy: `work/lab/WuwaTappo.exe`. Rebuild with `node src/cli.js lab --rebuild`.

### Status of the original binary

The installed `WuwaTappo.exe` carries a valid Kuro signature but verifies as
**HashMismatch** — it was altered after signing, presumably by the official build
pipeline (the uninstaller's signature verifies cleanly). We do not rely on that
signature for anything; the copy we run is unsigned anyway.

## Environment passed to the debug copy

```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
WEBVIEW2_USER_DATA_FOLDER=%TEMP%\wuwa-modkit-webview2
```

The second variable keeps even our debug profile away from the real install's
`localStorage`, where the login token lives.

## Why `--elevated` does not enable DevTools

There is a second launch mode, `node src/cli.js lab --elevated`, which starts the
*real* executable through UAC so it can share that install's profile and login.
It works as a launcher, but **the DevTools port never opens**, and that is not a
bug in the tooling.

The evidence, read from the live webview child process:

```
--user-data-dir="...\com.kuro.wuwatappo.cn\EBWebView\EBWebView"
```

Two things in one line. The profile is pinned explicitly, and it has an extra
`EBWebView` level compared to the default. That means the app (or wry on its
behalf) passes its own `--user-data-dir`. WebView2 gives an explicit
`--user-data-dir` priority over `WEBVIEW2_USER_DATA_FOLDER`, and
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` loses out in the same way — the flag is
simply absent from the child's command line.

So the debug port can only be enabled on a launch path where that pinning does not
apply, which in practice means the patched copy. `--elevated` is still kept: it is
the way to run the real install with a working login, just not with a debugger
attached.

## Stopping instances

`node src/cli.js stop` ends every instance. It tries a normal kill first; if an
instance is still alive it is elevated (typically started by the autostart task),
and the kill is retried inside a UAC-elevated session. This matters because an
unelevated `Stop-Process` reports success while doing nothing to an elevated
process.

## Caveats

- **The real install is untouched.** `E:\Programs\WuwaTappo` is only read.
- **Debug profile is throwaway.** Log in again inside the test copy if you need an
  authenticated session; it does not share credentials with the real app.
- **The app registers an elevated autostart task** (`wuwatappo.global`, logon
  trigger + 5 s delay) when autostart is enabled in its settings. Currently it is
  enabled on this machine, so the real app starts as administrator at login.
- **Port conflict.** Only one debug instance can own 9222. If `lab` reports the port
  is in use, an earlier copy is probably still running — `stop` clears it.
- **One UAC prompt at a time.** Windows queues elevation requests. A dialog left
  open from an earlier attempt blocks every later one, which looks like a hang.