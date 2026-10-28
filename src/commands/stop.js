// node src/cli.js stop
//
// Stop every running instance of the app, including one running as administrator.
// An unelevated token cannot terminate an elevated process — and Stop-Process reports
// success while doing nothing — so when a plain kill is not enough, the kill is repeated
// inside a UAC-elevated session.

import { runPS, runElevated, countInstances, PROCESS_NAME } from '../lib/ps.js';
import { parseOptions } from './options.js';
import { field, log, style } from '../lib/output.js';

const KILL = `Stop-Process -Name ${PROCESS_NAME} -Force -ErrorAction SilentlyContinue`;
const SETTLE_MS = 1500;
const settle = () => new Promise(r => setTimeout(r, SETTLE_MS));

export default async function stop(argv) {
  parseOptions(argv); // validates flags even though stop takes none of them

  const before = await countInstances();
  if (before === 0) {
    log(style.dim('no instances running'));
    return 0;
  }
  field('running', `${before} instance(s)`);

  await runPS(KILL).catch(() => {});
  await settle();
  if ((await countInstances()) === 0) {
    log(style.green('stopped'));
    return 0;
  }

  // Still alive: at least one instance is elevated. Ask for elevation, once.
  log(`  ${style.yellow('still running')} — an instance is elevated; requesting UAC`);
  await runElevated([KILL, `Start-Sleep -Milliseconds ${SETTLE_MS}`]);

  const after = await countInstances();
  if (after > 0) {
    throw new Error(`${after} instance(s) survived the elevated kill — is something restarting it?\n` +
      '  The app has a logon task (\\WuwaTappo\\ElevatedAutostart); a copy started by it can reappear.');
  }

  log(style.green('stopped'));
  return 0;
}
