// What a command line means. Shared by the two ways this program is started: `node src/cli.js ...` from
// the repository, and the packaged exe (src/entry.js).

import { COMMANDS } from './commands/index.js';
import openWindow from './commands/window.js';
import { isPackaged } from './lib/bundle.js';
import { fail, log, style } from './lib/output.js';
import { VERSION } from './lib/version.js';

const USAGE = `
${style.bold('wuwatappo-modkit')} ${VERSION} — mod loader for Wuwa Tappo (Tauri 2 / WebView2)

${style.bold('Usage')}
  node src/cli.js <command> [options]

${style.bold('Commands')}
  window              Open the window with the install / uninstall buttons (what a double-click on the exe does)
  update              Look on GitHub for a newer version and take it (--check only asks, --json)
  setup [status]      One-time install: after it, just run WuwaTappo.exe and the mods start with it
  uninstall           Take setup away again and put the original exe back (--keep-exe leaves it patched)
  start               Keep mods always on: start the app with DevTools if needed, then stay resident
    --no-launch         do not start the app, wait for one
    --log-file          also write to <app folder>\\moddata\\.modkit\\modkit.log
  dev [on <folder>|off]  Develop a plugin from its own folder: no install, every edit loaded as it is saved
  autostart <action>  install | remove | status (run start at logon)
  mods <action>       browse | get <name> | list | install <source> | update [id] | remove <id> | check <folder>
                        browse / get: the plugin registry. A source for install is a folder, .zip/.tgz,
                        git URL, npm name or .js file
    --force --no-deps --allow-scripts --purge --yes --json
  lab                 Patch the installed app, then start it with DevTools
    --rebuild           force the patch to be re-applied
    --restore           put the unpatched original back
  run                 Inject mods into all open windows, then exit
  watch               Stay resident: keep mods applied across reloads and edits
  eval <js>           Evaluate JS in every app window
  state               Show which mods are live in each window
  stop                Stop every instance, elevating if one is running as admin
  extract-assets      Unpack the frontend (Vue/JS/CSS/images) from the exe
  backend-commands    List the backend commands the frontend calls
  selftest            Check this build works (what it can read, that a Node part starts)

${style.bold('Options')}
  --port <n>          DevTools port (default 9222)
  --mods-dir <path>   Mod directory (default: mods in the app folder)
  --help              Show this help
  --version           Print the version

${style.dim('Docs: docs/LAUNCHING.md, docs/MODDING.md, docs/REGISTRY.md, docs/PACKAGING.md, docs/RELEASING.md')}
`;

// With no command, the packaged exe opens its window (a double-click on it). Run from the repository it
// shows the help, as before.
export async function main(argv) {
  const [name, ...rest] = argv;

  if (!name && isPackaged()) return openWindow();

  if (name === '--version' || name === '-v' || name === 'version') {
    log(VERSION);
    return 0;
  }

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    log(USAGE);
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    fail(`unknown command "${name}"`);
    log(USAGE);
    return 2;
  }

  try {
    return (await command(rest)) ?? 0;
  } catch (err) {
    fail(err.message);
    if (process.env.DEBUG) console.error(err);
    return 1;
  }
}
