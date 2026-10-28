// node src/cli.js start [--no-launch] [--log-file] [--rebuild]
//
// What to run to have mods "always on": make sure the app is patched and running with DevTools,
// then stay resident like `watch` (inject, run every mod's Node part, follow reloads and edits).
// Safe to run again and again: only one loader runs, and an app that is already up is left alone.
//
//   --no-launch   do not start the app; wait for one that has DevTools
//   --log-file    also write everything to work/logs/modkit.log (for a run with no window)
//   --rebuild     re-apply the patch (after an app update overwrote the exe)

import { appState, startApp } from '../lib/app.js';
import { acquireLock } from '../lib/lock.js';
import { ensurePatched } from '../lib/patch.js';
import { LOG_FILE } from '../lib/paths.js';
import { field, log, style, teeToFile } from '../lib/output.js';
import { parseOptions } from './options.js';
import { resident } from './watch.js';

export default async function start(argv) {
  const options = parseOptions(argv);
  if (options.logFile) teeToFile(LOG_FILE);

  // First of all, before the app is touched: a second loader must not launch anything.
  const lock = acquireLock();
  process.on('uncaughtException', err => {
    log(style.red(`crashed: ${err.stack ?? err}`));
    lock.release();
    process.exit(1);
  });

  log(`${style.bold('start')}  pid ${process.pid}${options.logFile ? `  log ${LOG_FILE}` : ''}`);

  const state = await appState(options.port);
  if (state === 'debuggable') {
    log('the app is running with DevTools: attaching');
  } else if (state === 'running') {
    log(style.yellow(
      'the app is running, but without a DevTools port, so nothing can be attached to it (it was started\n' +
      '  by a shortcut, or by its own logon task). Close it and start it with: node src/cli.js start\n' +
      '  (stop it with: node src/cli.js stop). Waiting for one that has DevTools.',
    ));
  } else if (options.noLaunch) {
    log('the app is not running; waiting for one (--no-launch)');
  } else {
    await ensurePatched({ force: options.rebuild, log });
    log('starting the app');
    const { pid, version } = await startApp({ port: options.port });
    field('app', `pid ${pid}, ${version.Browser}`);
  }

  return resident(options, { lock });
}
