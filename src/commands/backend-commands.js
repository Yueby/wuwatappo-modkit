// node src/cli.js backend-commands [--assets <dir>]
//
// List the backend (Tauri) commands the frontend calls, read from the extracted bundle.
// Marks the ones that do something you cannot take back by calling them.

import path from 'node:path';
import { listCommands } from '../lib/frontend-commands.js';
import { ASSETS_DIR } from '../lib/paths.js';
import { parseOptions } from './options.js';
import { log, section, style } from '../lib/output.js';

// Names taken from the real command list, not guessed. Calling any of these has a side
// effect beyond the page: ending the app, installing an update, or wiping the login.
const RISKY = new Map([
  ['exit_app', 'terminates the app'],
  ['plugin:process|restart', 'restarts the app'],
  ['plugin:updater|download_and_install', 'installs an update'],
  ['plugin:updater|install', 'installs an update'],
  ['plugin:webview|clear_all_browsing_data', 'wipes cookies, i.e. the login'],
]);

export default async function backendCommands(argv) {
  const options = parseOptions(argv);
  const dir = options.assets ?? path.join(ASSETS_DIR, 'assets');

  const commands = listCommands(dir);
  section(`${commands.length} backend commands`);

  for (const { command, sources } of commands) {
    const risk = RISKY.get(command);
    log(`  ${command.padEnd(42)} ${style.dim(sources[0])}${risk ? `  ${style.red(risk)}` : ''}`);
  }
  return 0;
}
