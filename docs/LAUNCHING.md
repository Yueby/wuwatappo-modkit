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

## Install once, then just run the app

```sh
node src/cli.js setup            # one UAC prompt, once
node src/cli.js setup status     # what is in place
node src/cli.js uninstall        # takes it away (one UAC prompt); --restore-exe also puts the original exe back
```

After `setup`, start `WuwaTappo.exe` however you like (its shortcut, a double-click, its own logon task)
and the mods start with it. Three pieces make that so:

1. **The exe is patched** (the existing one-byte edit: it no longer demands administrator).
2. **The app opens its DevTools port by itself**, from a registry value:
   `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` →
   `WuwaTappo.exe = --remote-debugging-port=9222`. This is WebView2's documented override. It is
   appended to the app's own arguments (its profile and login are untouched; checked: login and click count
   were intact across a restart), it is named for this program only (a `*` would open a port in every
   WebView2 program on the machine), and unlike an environment variable it is honoured by a process
   running elevated. Writing under `Software\Policies` needs administrator rights (it belongs to SYSTEM):
   that is the UAC prompt of `setup` and of `uninstall`, and the only time this tool asks for one.
3. **The loader runs at every logon**, from a script in the Startup folder, waiting for the app
   (`start --no-launch`). It attaches whenever the app has a port, injects, and runs the mods' Node parts.

So the app's own logon task (`\WuwaTappo\ElevatedAutostart`) no longer gets in the way: the app it starts has
the port too. The port is on `127.0.0.1` only, but any program on this machine can drive the app through
it for as long as it is there; `uninstall` closes it.

A running app has to be restarted once after `setup`: it was started before, without the port.

## Always on

`start` is `lab` and `watch` in one: it patches the exe if that is needed, starts the app with the
DevTools port if it is not running, and then stays resident. Run it again and nothing doubles: only one
loader runs (it holds `work/loader.lock`; a lock left by a crashed loader is taken over), and an
app that is already up with DevTools is simply attached to.

```sh
node src/cli.js start                 # now
node src/cli.js autostart install     # at every logon, with no window; what it says goes to work/logs/modkit.log
node src/cli.js autostart status
node src/cli.js autostart remove
```

`autostart` (which `setup` does for you) writes one file, `wuwa-modkit.vbs`, in your own Startup folder (no administrator, nothing
in the registry or the task scheduler); deleting it is removing it.

- **The app has a logon task of its own** (`\WuwaTappo\ElevatedAutostart`, made while it still ran as
  administrator). Without `setup`, if it starts the app before the loader does, the app has no DevTools
  port and the loader cannot attach. With `setup` it does not matter. (The app's "start with Windows"
  switch no longer works under the patch anyway.)
- The loader launches the app **once**, when it starts. If you close the app, it does not start it again;
  start it with `start` (the loader already running just carries on and attaches).
- The log is kept to about 1 MB, plus the previous one as `modkit.log.1`.

## Caveats

- **The patch removes the admin requirement** — for launches by hand. The app then
  runs with your normal user token. The existing logon task
  (`\WuwaTappo\ElevatedAutostart`, `RunLevel = Highest`) is unaffected and still
  starts the patched exe elevated at login.
- **The "start with Windows" toggle stops working.** Unelevated, the app cannot create
  or delete that task, so flipping the switch changes nothing and each start logs a
  harmless `schtasks create failed`. To change it, `lab --restore`, change the
  setting, then `lab` again. Details in docs/APP-NOTES.md.
- **Running from `lab` also sets a DevTools port.** Anyone on the machine who can
  reach `127.0.0.1:9222` can drive the app. Start it normally (without `lab`) when
  you are not developing.
- **One instance at a time.** The single-instance mutex is unchanged, so a second
  launch forwards to the first.
- **One UAC prompt at a time.** If a consent dialog is left open, later elevation
  requests queue behind it and look like a hang.