# Packaging as one exe

The plan: a single `.exe` put in the app folder (next to `WuwaTappo.exe`). Run it to install (`setup`) or take
away (`uninstall`); run it again after an app update. It is also what the logon script starts, and what runs a
mod's Node part, so the machine needs no Node installed.

`npm run build` makes it: `dist/modkit.exe`, about 88 MB. The build runs the exe's own `selftest` (it reads what it
carries, makes the folders, loads a mod, starts a mod's Node part that imports a package from its own
`node_modules`) and fails if that does. The exe carries the framework scripts and **no mods**: mods come from
elsewhere and are installed into `<app folder>\mods`, which `setup` makes empty.

postject warns that "the signature seems corrupted": the copy of `node.exe` was signed by the Node project and no
longer is. It runs; nothing here is signed.

What was checked before building, so the design does not rest on guesses:

## Checked: a Node single-executable app can do what this design needs

A one-file test app was built with Node 24's single-executable support (`node --experimental-sea-config`, then
`postject` into a copy of `node.exe`) and run:

| needed | result |
|---|---|
| `node:sea` says it is packaged, `process.execPath` is the exe itself | yes |
| `fork()` starts a child process | yes: it starts the exe again, with the arguments given (`process.argv[1]` is just the path passed to `fork`, not run as a script), so the mode has to come from the environment (`MODKIT_ROLE=host-runner`), not from arguments |
| the child can load a file from disk that is not in the exe: `import()` of an ES module in a mod's folder | yes, with `vm.compileFunction('return import(spec)', ['spec'], { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })`; a plain `import()` is not available in a packaged script |
| that module can `import` a package from `node_modules` next to it, and `node:` modules | yes |
| the working directory given to `fork` is honoured | yes |
| size | about 92 MB: it contains the Node runtime |

Two things to expect: the loader of a plain `import()` prints an ExperimentalWarning for
`USE_MAIN_CONTEXT_DEFAULT_LOADER` on stderr (the loader forwards a mod's stderr to its log, so set
`NODE_NO_WARNINGS=1` for the child), and the exe's signature is no longer valid after injection (it is not
signed by anyone anyway; SmartScreen may say so the first time).

## What the code had to change (done)

- **One script.** A packaged app is one CommonJS file. The sources are many ES modules with a top-level `await`
  in `cli.js`; a bundler (esbuild, as a build-time tool only; the project keeps no runtime dependencies) turns
  them into one, and `cli.js` needs its top-level `await` wrapped in a function.
- **`import.meta.url`** is used to find files next to the source (`host.js` finds `host-runner.js`; `paths.js`
  finds the repository). Packaged, neither exists: the host runner becomes the same exe in another role, and the
  repository root is not a thing (only the app folder is; `resolveInstallDir()` already takes it from the exe).
- **Files that are read from disk and sent to the page** have to be inside the exe: `src/runtime/*.js` (the
  framework scripts, with the icon placeholders filled in at load) and nothing else (the exe carries no mods).
  Node's SEA `assets` option embeds files; `sea.getAsset()` reads them.
- **The logon script** already runs `launcher()` — the exe itself when packaged — so it needs no change.
- **The role switch**: `host.js` starts a mod's Node part with `fork(<host-runner.js>)`; packaged, it forks the exe
  with `MODKIT_ROLE=host-runner` and the runner code is in the bundle.
- `extract-assets`, `backend-commands`, `lab`, `eval`, `state` are development tools; they can stay in the
  exe or be left out of it.

## Not checked

- Whether the app's own installer or updater leaves unknown files and folders in the app folder (`mods\`,
  `moddata\`, the exe) alone. An update has not happened since they were put there. If it does not, the exe and
  the folders would have to live somewhere else, or `setup` would have to put them back.
- Whether Windows Defender / SmartScreen objects to an unsigned exe that edits another program's exe and writes
  to the registry. It is the same thing the scripts do now, from a file that is easier to flag.
