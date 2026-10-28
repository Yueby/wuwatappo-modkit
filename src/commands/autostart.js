// node src/cli.js autostart <install|remove|status>
//
// Start the loader (`start`) when you log on to Windows, from a script in your Startup folder.

import { appHasLogonTask, install, remove, status, APP_TASK } from '../lib/autostart.js';
import { field, log, section, style } from '../lib/output.js';
import { LOG_FILE } from '../lib/paths.js';
import { parseOptions } from './options.js';

export default async function autostart(argv) {
  const { positional } = parseOptions(argv);
  const [action = 'status'] = positional;

  if (action === 'install') {
    const file = install();
    section('Installed');
    field('script', file);
    field('runs', status().command);
    field('log', LOG_FILE);
    log(`\n  From the next logon the loader starts by itself and waits for the app (it does not start it),`);
    log(`  and keeps your mods applied. ${style.bold('node src/cli.js autostart remove')} undoes it.`);
    log(style.dim('  The app needs its DevTools port: node src/cli.js setup does that and this together.'));
    await warnAboutAppTask();
    return 0;
  }

  if (action === 'remove') {
    const { file, existed } = remove();
    log(existed ? `removed ${file}` : `nothing to remove (${file} is not there)`);
    return 0;
  }

  if (action === 'status') {
    const now = status();
    section('Autostart');
    field('installed', now.installed ? style.green('yes') : 'no');
    field('script', now.file);
    if (now.command) field('runs', now.command);
    await warnAboutAppTask({ quiet: !now.installed });
    return 0;
  }

  throw new Error(`unknown action "${action}": use install, remove or status`);
}

// The app's own logon task starts it with no DevTools port, and if it gets there first the loader
// has nothing to attach to.
async function warnAboutAppTask({ quiet = false } = {}) {
  if (quiet || !(await appHasLogonTask())) return;
  log(`\n${style.yellow('note')}  the app has a logon task of its own (${APP_TASK}). If it starts the app before the`);
  log(`  loader does, the app has no DevTools port and the loader cannot attach. Deleting that task needs an`);
  log(`  administrator prompt, so it is left to you:`);
  log(`    ${style.bold(`schtasks /Delete /TN "${APP_TASK}" /F`)}   (in an elevated terminal)`);
}
