# Releasing, and how the exe updates itself

The exe looks for a newer version every time its window opens (and on 刷新), and takes it without asking: it
downloads it, checks it, replaces itself, runs the new version's `setup` (which re-applies the patch and replaces the
loader that is running), and opens a new window. The window shows the version it is: `启动器 v0.1.0`.

## Making a release

Raise `version` in `package.json` (the one place a version is written; the build puts it into the exe) and push to
`main`. That is all: `.github/workflows/release.yml` runs the tests, and when there is no release called `v<version>`
yet it builds the exe and publishes it, tag included, with generated notes. A push that does not change the version
only runs the tests (the release is already there); a pull request only runs the tests.

What the build does (`npm run build`, the same thing you can run by hand): it makes `dist/modkit.exe` and
`dist/modkit.exe.sha256`, runs the exe's selftest, and checks that the exe says the version it was built as. The
release has both files, and the tag is the version (`v0.2.0`).

By hand, if it ever has to be:

```sh
npm run build
gh release create v0.2.0 dist/modkit.exe dist/modkit.exe.sha256 --title v0.2.0 --generate-notes
```

The asset names matter: they are fetched from `releases/download/<tag>/modkit.exe` and `modkit.exe.sha256`.

The exe is a copy of the `node.exe` of the runner that built it (Node 24, set in the workflow), with the program put
into it. A release is never replaced: to fix one, raise the version again.

## How it checks

`update --check` asks `github.com/<repo>/releases/latest` and reads where it redirects to (`.../releases/tag/<tag>`;
no release yet redirects to `.../releases`). That is not the API, so there is no rate limit to run into. The repository
is `REPO` in `src/lib/release.js`; GitHub follows a renamed repository, so the old name keeps working after a rename.

A tag that is not a version (`nightly`) is ignored. A version that is not newer than the running one is not taken, so
a release cannot be used to move people back.

## How it takes it

1. Download `modkit.exe.sha256` and `modkit.exe` to `modkit.exe.new` beside the running exe. While it comes, the program
   says how far it is: `update --progress` prints `progress <bytes> <of>` about five times a second, which the window
   draws as a bar and `45.3 / 90.1 MB（50%）`; in a terminal the line is rewritten in place. (A window's own script is
   part of the exe, so the window that does an update is the old one: the first update to a version that has this shows
   no bar, the ones after it do.) If the SHA-256 differs, or
   the download stops short, it is deleted and nothing else happens.
2. Run the downloaded exe with `--version` and compare with the tag. (This runs it, after the hash matched.)
3. Rename the running exe to `modkit.exe.old` and the new one to `modkit.exe`. A running exe cannot be overwritten on
   Windows but can be renamed (measured). If the second rename fails the first is undone.
4. Run the new exe's `setup`, then its `window`; the old window closes (exit code 10 from `update --reopen`).
5. `modkit.exe.old` cannot be deleted while the old window's program runs (measured); the next window opening deletes it.

## Where the program has to be

In the app's own folder, beside `WuwaTappo.exe` (src/lib/placement.js): that folder is taken to be the app's (paths.js), and the
mods, the data, the patch and the loader's files all go there. Put anywhere else (the Start menu folder of the app's shortcuts,
which is what opening a shortcut's location can lead to, or Downloads), `setup` and `start` stop with a message, and the window,
which asks `placement --json` when it opens, says so in a dialog, keeps 安装 and the rest off, and offers to open the folder the app
is in. That folder is found from a shortcut next to the program, the running app, and the uninstall entry the app's installer
writes (`HKCU...UninstallWuwaTappo`, whose InstallLocation has quotes in the value itself), and each is checked for a
`WuwaTappo.exe`. The program that runs from `moddata.modkit` (the loader's copy, an update waiting there) is not misplaced:
its app folder is two up.

## Updating from the MOD page

The same update, started from inside the app: the MOD page shows the version at its bottom right with **检查更新**, and
when there is a newer one a dot on the MOD tab, a row at the top of the list, and **更新** (src/lib/updater.js, asked for
by the page through src/lib/manager.js: `self-check` and `self-update`; only the panel window is believed). The loader does
what `update` does, except that it is the loader and not the exe in the app folder that runs:

1. The check is made when the panel opens and every half hour after (the loader remembers an answer for ten minutes), and
   says nothing if it fails. A failed check the person asked for is said in words.
2. **更新**: the download goes to `moddata.modkitmodkit-update.exe`, and the page draws a bar from `progress <received>
   <total>` events (about five a second), then the steps 校验 and 安装. The same SHA-256 check and `--version` check as above.
3. The exe the person opens (where `setup` last saw it, `moddata.modkitlauncher.json`, or `modkit.exe` in the app folder)
   is replaced by rename, as above.
4. The page is told it is restarting, and a second later the new program's `setup --restart-app` is started apart from the
   loader (detached, its output going to the loader's log). Setup stops the old loader (this process), patches, puts a copy
   of the new program where the loader runs from, starts the new loader, and starts the app again whether or not it needed
   it. The window is closed with the app, so nothing is said after "restarting".
5. A loader that is too old to know `self-check` does not answer; the page says to press 安装 in the launcher once.

Run from the repository (`node src/cli.js start`), it checks and says there is a newer version, and does not take it.

What the tests cover: the order of the steps, what the page is told, what is left behind when a step fails (tests/updater.test.js,
with GitHub, the download and setup stood in for). Measured by hand: a process started detached from the loader goes on
when the loader is killed. Not measured: a packaged exe replacing itself through this path on a real install.

## What this trusts

The checksum says the file is the one that was uploaded, nothing more: whoever can change the release can change both
files. There is no signature (a key would have to be kept apart from the repository). If that matters later, the place
is `downloadRelease` in `src/lib/release.js`: verify an ed25519 signature of the exe against a public key built into
the exe, and refuse otherwise.

`update` from the repository only checks; replacing is for the packaged exe.
