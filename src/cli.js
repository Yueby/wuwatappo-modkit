#!/usr/bin/env node
// Command line entry point.

import { COMMANDS } from './commands/index.js';
import { fail, log, style } from './lib/output.js';

const USAGE = `
${style.bold('wuwa-modkit')} — mod loader for Wuwa Tappo (Tauri 2 / WebView2)

${style.bold('Usage')}
  node src/cli.js <command> [options]

${style.bold('Commands')}
  lab                 Build and start a test copy of the app with CDP enabled
  run                 Inject mods into all open windows, then exit
  watch               Stay resident: keep mods applied across reloads and edits
  eval <js>           Evaluate JS in every app window
  state               Show which mods are live in each window
  extract-assets      Unpack the frontend (Vue/JS/CSS/images) from the exe
  commands            List backend commands found in the frontend

${style.bold('Options')}
  --port <n>          DevTools port (default 9222)
  --mods-dir <path>   Mod directory (default ./mods)
  --help              Show this help

${style.dim('Docs: docs/LAUNCHING.md, docs/MODDING.md')}
`;

export async function main(argv) {
  const [name, ...rest] = argv;

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

process.exitCode = await main(process.argv.slice(2));