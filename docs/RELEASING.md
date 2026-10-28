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

1. Download `modkit.exe.sha256` and `modkit.exe` to `modkit.exe.new` beside the running exe. If the SHA-256 differs, or
   the download stops short, it is deleted and nothing else happens.
2. Run the downloaded exe with `--version` and compare with the tag. (This runs it, after the hash matched.)
3. Rename the running exe to `modkit.exe.old` and the new one to `modkit.exe`. A running exe cannot be overwritten on
   Windows but can be renamed (measured). If the second rename fails the first is undone.
4. Run the new exe's `setup`, then its `window`; the old window closes (exit code 10 from `update --reopen`).
5. `modkit.exe.old` cannot be deleted while the old window's program runs (measured); the next window opening deletes it.

## What this trusts

The checksum says the file is the one that was uploaded, nothing more: whoever can change the release can change both
files. There is no signature (a key would have to be kept apart from the repository). If that matters later, the place
is `downloadRelease` in `src/lib/release.js`: verify an ed25519 signature of the exe against a public key built into
the exe, and refuse otherwise.

`update` from the repository only checks; replacing is for the packaged exe.
