# Launching a debuggable instance

```sh
node src/cli.js lab
```

That patches the installed executable in place and starts it with a DevTools port.
Run `node src/cli.js watch` separately to inject mods.

## Why the exe needs patching at all

The shipped binary asks to be run as administrator:

```xml
<requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
```

A process started from a normal shell inherits that shell's token, so the manifest
blocks the launch before our environment variables could matter — and the variable
that enables the DevTools port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) has to be
set before the process starts.

## What the patch changes

One replacement, **the same byte length as the original** (padded with spaces, which
XML ignores), so no PE offset, section table entry, or signature blob moves:

| original | replacement |
|---|---|
| `level="requireAdministrator"` | `level="asInvoker"` |

That is the whole patch. No code is modified, the app behaves identically, and it
is still the installed binary.

### The bundle id is left alone on purpose

An earlier version of this tool also rewrote the bundle id
(`com.kuro.wuwatappo.cn` → `lab.…`) to give a side-by-side copy its own
single-instance mutex. That is wrong for how the app is actually used here: the id
decides where settings and the WebView2 profile live, so changing it moves every
piece of existing state to a new folder and looks exactly like "my login and
settings are gone". Since the patched exe *is* the only copy that runs, there is no
second instance to stay clear of.

Keeping the id also means the app uses its real data:

```
%APPDATA%\com.kuro.wuwatappo.cn\            click counters, locale
%LOCALAPPDATA%\com.kuro.wuwatappo.cn\      WebView2 profile (cookies, localStorage)
```

So the login, settings, and click counters are the real ones — nothing is cloned,
nothing is duplicated.

## Updates

This is the reason for patching in place rather than running a copy.

- The updater looks at the registry entry (`InstallLocation = E:\Programs\WuwaTappo`)
  and installs there. Because we run that same binary, updates work normally.
- An update overwrites `WuwaTappo.exe` with a fresh stock build, which **loses the
  patch**. The next `node src/cli.js lab` notices (`isPatched` returns false),
  refreshes the backup to the new stock build, and re-applies the patch.
- `WuwaTappo.exe.orig` is the pristine backup of the *stock* build the patch was
  made from. It is refreshed whenever a new stock build appears.

Restore the untouched app at any time:

```sh
node src/cli.js stop
node src/cli.js lab --restore
```

Verified byte-for-byte: the restored file's SHA-256 matches the stock build
(`dd340c92a7320d1ecf3697ba65b4ad23d8f196acb547d2ba3f75ba09d696d97`).

## Files this creates

```
E:\Programs\WuwaTappo\
  WuwaTappo.exe           patched in place
  WuwaTappo.exe.orig      pristine stock backup
  .wuwa-modkit.json       what was patched, when, and the hash
```

## Caveats

- **The patch removes the admin requirement.** The app runs with your normal user
  token. It previously ran elevated (it also writes a logon-triggered scheduled task,
  `wuwatappo.global`, when "start with Windows" is on — that task would launch the
  patched exe elevated).
- **Running from `lab` also sets a DevTools port.** Anyone on the machine who can
  reach `127.0.0.1:9222` can drive the app. Start it normally (without `lab`) when
  you are not developing.
- **One instance at a time.** The single-instance mutex is unchanged, so a second
  launch forwards to the first.
- **One UAC prompt at a time.** If a consent dialog is left open, later elevation
  requests queue behind it and look like a hang.