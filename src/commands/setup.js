// node src/cli.js setup [status]      and      node src/cli.js uninstall [--keep-exe]
//
// The one-time installation. After it, running WuwaTappo.exe in any way at all (its shortcut, its own
// logon task, a double-click) is enough: the app opens its DevTools port by itself and the loader,
// which is already waiting, attaches to it and starts the mods.
//
//   1. the exe has its administrator requirement removed (the one byte edit; see docs/LAUNCHING.md)
//   2. the app is told, through the registry, to open its DevTools port on every start
//   3. the loader is started at every logon (a script in the Startup folder), waiting for the app
//   4. the loader is started now, if it is not already running
//   5. an app that is running is closed first and started again at the end, so that it has the port
//

// Everything is in the current user's own areas (the app folder, HKCU, the Startup folder): no
// administrator is needed to set it up or to take it away again.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appState, startAppByItself } from '../lib/app.js';
import * as autostart from '../lib/autostart.js';
import { launcher } from '../lib/autostart.js';
import { readDev } from '../lib/devmode.js';
import { ensureFolders, installLoaderCopy, removeLoaderCopy } from '../lib/layout.js';
import { runningLoader } from '../lib/lock.js';
import { ensurePatched, forgetPatch, isPatched, restoreOriginal } from '../lib/patch.js';
import { APP_EXE, APP_EXE_BACKUP, LOG_FILE, MODS_DIR, MOD_DATA_DIR } from '../lib/paths.js';
import { countInstances, startThroughShell, stopApp } from '../lib/ps.js';
import { POLICY_KEY, APP_NAME, portOf, readArguments, removeArguments, setArguments } from '../lib/webview-policy.js';
import { isPackaged } from '../lib/bundle.js';
import { listMods } from '../lib/install.js';
import { field, log, section, style } from '../lib/output.js';
import { parseOptions } from './options.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// What setup does about an app that is running. It has to be closed and started again when it has no
// DevTools port (it was started before this, so it never will), or when its exe is not patched yet (the
// file cannot be written while it runs). One that is patched and already answers on the port is left alone.
export function setupAppPlan({ state, patched }) {
  if (state === 'stopped') return { stop: false, restart: false };
  if (state === 'debuggable' && patched) return { stop: false, restart: false };
  return { stop: true, restart: true };
}

// And what uninstall does: the original exe cannot be put back while the app runs, so it is closed and
// started again (as the original, which asks for administrator rights). Nothing to restore, or --keep-exe,
// leaves the app alone.
export function uninstallAppPlan({ running, hasBackup, keepExe }) {
  const restore = !keepExe && hasBackup;
  return { restore, stop: restore && running, restart: restore && running };
}

export default async function setup(argv) {
  const options = parseOptions(argv);
  if (options.positional[0] === 'status') return status(options);

  try {
    await fs.access(APP_EXE);
  } catch {
    throw new Error(`the app is not at ${APP_EXE} (set WUWA_INSTALL_DIR, or put this program in the app's folder)`);
  }

  section('Setting up');

  // 0. The folders first. They are there whatever a later step does, so someone who looks in the app
  // folder after pressing install finds them even if something after this needs another go.
  const made = await ensureFolders();
  field('mods', `${MODS_DIR}${made.includes(MODS_DIR) ? style.dim('  (made, empty)') : ''}`);
  field('mod data', `${MOD_DATA_DIR}${made.includes(MOD_DATA_DIR) ? style.dim('  (made, empty)') : ''}`);

  // 1. The exe. A running app is closed for it (and for the port), and started again at the end.
  const patched = await isPatched();
  const plan = setupAppPlan({ state: await appState(options.port), patched });
  if (plan.stop) {
    field('app', 'closing it; it is started again at the end, with the DevTools port');
    await stopApp({ say: message => field('', style.yellow(message)) });
  }
  if (patched) {
    field('exe', style.dim('already patched'));
  } else {
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
  for (const old of [runningLoader()].filter(Boolean)) {
    try { process.kill(old); } catch { /* gone already */ }
    field('loader', style.dim(`stopped the old one (pid ${old})`));
  }
  await sleep(500);                                  // its Node parts end with it; let go of their files

  const installed = (await listMods(MODS_DIR)).length;
  field('', style.dim(installed
    ? `${installed} mod(s) installed: node src/cli.js mods list`
    : 'no mods yet: node src/cli.js mods install <folder | .zip | git URL | npm name>'));

  // 4. The loader at logon. Packaged, it runs from a copy of this program, so that this one, in the app
  // folder, is never in use and a new version can simply be put over it.
  if (isPackaged()) await installLoaderCopy();
  field('at logon', autostart.install());

  // 5. And now.
  const { node, cli, cwd } = launcher();
  spawn(node, [...(cli ? [cli] : []), 'start', '--no-launch', '--log-file', '--port', String(options.port)], {
    cwd, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
  field('loader', `started, waiting for the app (log: ${LOG_FILE})`);

  // 6. The app again, if it was running, the way anyone starts it: nothing is added for it, so that it
  // coming up with its port is the proof that the registry setting does its job.
  if (plan.restart) {
    try {
      await startAppByItself({ port: options.port });
      field('app', style.green('started again, DevTools port is up'));
    } catch (err) {
      field('app', style.yellow(`started again, but the DevTools port did not come up: ${err.message.split('\n')[0]}`));
    }
  }

  log(`\n${style.green('done')}  from now on, start ${style.bold('WuwaTappo.exe')} however you like: the mods start with it.`);
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
  const dev = await readDev();
  field('dev mode', dev.enabled ? `${style.green('on')}  ${dev.dirs.join(', ')}` : dev.dirs.length ? `off  (${dev.dirs.join(', ')} is remembered)` : 'off');

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
  if (pid) await sleep(500);                         // let go of its files first
  await removeLoaderCopy().catch(() => {});
  field('DevTools port', (await removeArguments()) ? 'removed from the registry' : style.dim('was not set'));

  // The exe: the original is put back, which is what taking this away means. (--keep-exe leaves the
  // patched one: it runs as before, only without anything to start the mods.)
  const hasBackup = await fs.access(APP_EXE_BACKUP).then(() => true, () => false);
  const running = (await countInstances()) > 0;
  const plan = uninstallAppPlan({ running, hasBackup, keepExe: options.keepExe });
  if (options.keepExe) {
    field('exe', style.dim('left patched (--keep-exe)'));
  } else if (!plan.restore) {
    field('exe', style.dim('was never patched by this program: nothing to put back'));
  } else {
    if (plan.stop) {
      field('app', 'closing it: the original cannot be put back while it runs');
      await stopApp({ say: message => field('', style.yellow(message)) });
    }
    const { restoredFrom } = await restoreOriginal();
    await forgetPatch();
    field('exe', `original put back from ${restoredFrom}`);
    if (plan.restart) {
      try {
        await startThroughShell(APP_EXE);
        field('app', 'started again, as the original (it asks for administrator rights)');
      } catch (err) {
        field('app', style.yellow(`could not start it again: ${err.message.split('\n')[0]}; start it yourself`));
      }
    }
  }

  log(`\n${style.green('done')}`);
  log(style.dim(`  Your mods (${MODS_DIR}) and what they keep (${MOD_DATA_DIR}) are left where they are.`));
  return 0;
}
