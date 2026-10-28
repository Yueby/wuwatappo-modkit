// node src/cli.js setup [status]      and      node src/cli.js uninstall [--restore-exe]
//
// The one-time installation. After it, running WuwaTappo.exe in any way at all (its shortcut, its own
// logon task, a double-click) is enough: the app opens its DevTools port by itself and the loader,
// which is already waiting, attaches to it and starts the mods.
//
//   1. the exe has its administrator requirement removed (the one byte edit; see docs/LAUNCHING.md)
//   2. the app is told, through the registry, to open its DevTools port on every start
//   3. the loader is started at every logon (a script in the Startup folder), waiting for the app
//   4. the loader is started now, if it is not already running
//
// Everything is in the current user's own areas (the app folder, HKCU, the Startup folder): no
// administrator is needed to set it up or to take it away again.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appState } from '../lib/app.js';
import * as autostart from '../lib/autostart.js';
import { launcher } from '../lib/autostart.js';
import { ensureFolders, installBundledMods, moveLegacyData } from '../lib/layout.js';
import { runningLoader } from '../lib/lock.js';
import { ensurePatched, isPatched, restoreOriginal } from '../lib/patch.js';
import { APP_EXE, LOG_FILE, MODS_DIR, MOD_DATA_DIR, WORK_DIR } from '../lib/paths.js';
import { countInstances } from '../lib/ps.js';
import { POLICY_KEY, APP_NAME, portOf, readArguments, removeArguments, setArguments } from '../lib/webview-policy.js';
import { field, log, section, style } from '../lib/output.js';
import { parseOptions } from './options.js';

// The lock an earlier version kept inside the repository: a loader started by it is still a loader.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LEGACY_LOCK = path.join(WORK_DIR, 'loader.lock');

export default async function setup(argv) {
  const options = parseOptions(argv);
  if (options.positional[0] === 'status') return status(options);

  try {
    await fs.access(APP_EXE);
  } catch {
    throw new Error(`the app is not at ${APP_EXE} (set WUWA_INSTALL_DIR, or put this program in the app's folder)`);
  }

  section('Setting up');

  // 1. The exe. Nothing is written if it is already patched, so a running app is no obstacle then.
  if (await isPatched()) {
    field('exe', style.dim('already patched'));
  } else {
    if ((await countInstances()) > 0) throw new Error('the app is running and its exe is not patched yet: close it (node src/cli.js stop) and run setup again');
    await ensurePatched({ log });
    field('exe', style.green('patched'));
  }

  // 2. The port, from the registry. Written (which asks for administrator rights) only if it is not
  // already what it should be, so running setup again after an app update does not ask again.
  const wanted = `--remote-debugging-port=${options.port}`;
  if ((await readArguments()) === wanted) {
    field('devtools', style.dim(`${APP_NAME} already opens port ${options.port} on every start`));
  } else {
    await setArguments({ port: options.port });
    field('devtools', `${APP_NAME} opens port ${options.port} on every start`);
  }
  field('registry', style.dim(`${POLICY_KEY}\\${APP_NAME}`));

  // 3. The folders in the app folder, and what goes in them. A loader that is already running is
  // stopped first: it keeps writing where it was told to, and what it wrote after its data was moved
  // would start a second copy. (Running setup again is how a new version of this program, or a new
  // place for these folders, is taken up; the new loader is started at the end.)
  for (const old of [runningLoader(), runningLoader({ file: LEGACY_LOCK })].filter(Boolean)) {
    try { process.kill(old); } catch { /* gone already */ }
    field('loader', style.dim(`stopped the old one (pid ${old})`));
  }
  await sleep(500);                                  // its Node parts end with it; let go of their files

  await ensureFolders();
  const bundled = await installBundledMods();
  field('mods', MODS_DIR);
  if (bundled.installed.length) field('', style.dim(`added: ${bundled.installed.join(', ')}`));
  if (bundled.kept.length) field('', style.dim(`already there, left as they are: ${bundled.kept.join(', ')}`));
  const moved = await moveLegacyData();
  field('mod data', MOD_DATA_DIR);
  if (moved.moved.length) field('', style.dim(`moved from the old place: ${moved.moved.join(', ')}`));
  if (moved.skipped.length) field('', style.yellow(`not moved (already has data in moddata, the old copy is kept): ${moved.skipped.join(', ')}`));

  // 4. The loader at logon.
  field('at logon', autostart.install());

  // 5. And now.
  const { node, cli, cwd } = launcher();
  spawn(node, [...(cli ? [cli] : []), 'start', '--no-launch', '--log-file', '--port', String(options.port)], {
    cwd, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
  field('loader', `started, waiting for the app (log: ${LOG_FILE})`);

  log(`\n${style.green('done')}  from now on, start ${style.bold('WuwaTappo.exe')} however you like: the mods start with it.`);
  if ((await appState(options.port)) === 'running') {
    log(`${style.yellow('note')}  the app that is running now was started before this, so it has no DevTools port yet.`);
    log('  Quit it (its tray menu) and start it again; the next start has one.');
  }
  log(style.dim('  node src/cli.js setup status    shows what is in place\n  node src/cli.js uninstall       takes it all away again'));
  return 0;
}

async function status(options) {
  section('Setup');
  field('exe patched', (await isPatched()) ? style.green('yes') : 'no (it will ask for administrator)');

  const args = await readArguments();
  field('DevTools port', args ? `${style.green('yes')}  ${args}` : 'not set');
  if (args && portOf(args) !== options.port) field('', style.yellow(`the loader is looking at port ${options.port}, not ${portOf(args)}: pass --port`));

  const logon = autostart.status();
  field('loader at logon', logon.installed ? style.green('yes') : 'no');

  const pid = runningLoader();
  field('loader now', pid ? `${style.green('running')} (pid ${pid})` : 'not running');
  field('mods', MODS_DIR);
  field('mod data', MOD_DATA_DIR);

  const app = await appState(options.port);
  field('app', { debuggable: style.green('running, with DevTools'), running: style.yellow('running, without DevTools (started before setup?)'), stopped: 'not running' }[app]);
  if (await autostart.appHasLogonTask()) {
    field('app logon task', `exists (${autostart.APP_TASK}): with setup it no longer matters, its start has the port too`);
  }
  return 0;
}

export async function uninstall(argv) {
  const options = parseOptions(argv);
  section('Taking it away');

  const pid = runningLoader();
  if (pid) {
    process.kill(pid);
    field('loader', `stopped (pid ${pid})`);
  } else {
    field('loader', style.dim('was not running'));
  }

  field('at logon', autostart.remove().existed ? 'removed' : style.dim('was not installed'));
  field('DevTools port', (await removeArguments()) ? 'removed from the registry' : style.dim('was not set'));

  if (options.restoreExe) {
    if ((await countInstances()) > 0) throw new Error('the app is running: close it (node src/cli.js stop), then run: node src/cli.js uninstall --restore-exe');
    const { restoredFrom } = await restoreOriginal();
    field('exe', `put back from ${restoredFrom}`);
  } else {
    field('exe', style.dim('left patched (--restore-exe puts the original back)'));
  }

  log(`\n${style.green('done')}  the app keeps its DevTools port until it is restarted.`);
  log(style.dim(`  Your mods (${MODS_DIR}) and what they keep (${MOD_DATA_DIR}) are left where they are.`));
  return 0;
}
