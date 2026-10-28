// node src/cli.js stop
//
// Stop every running instance of the app, including one started with elevation.
// An unelevated token cannot terminate an elevated instance, so when a normal
// kill is not enough this re-runs the kill inside a UAC-elevated session.

import { runPS, countInstances, PROCESS_NAME } from '../lib/ps.js';
import { launchElevated } from '../lib/launch.js';
import { parseOptions } from './options.js';
import { field, log, style } from '../lib/output.js';

export default async function stop(argv) {
  parseOptions(argv); // validates flags even though stop takes none of them

  const before = await countInstances();
  if (before === 0) {
    log(`${style.dim('no instances running')}`);
    return 0;
  }
  field('running', `${before} instance(s)`);

  await runPS(`Stop-Process -Name ${PROCESS_NAME} -Force -ErrorAction SilentlyContinue`).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  if ((await countInstances()) === 0) {
    log(`${style.green('stopped')}`);
    return 0;
  }

  // Still alive: at least one instance was elevated. Ask for elevation once.
  log(`  ${style.yellow('still running')} — an instance is elevated; requesting UAC`);
  await launchElevated(null, {
    cwd: process.cwd(),
    prelude: [
      `Stop-Process -Name ${PROCESS_NAME} -Force -ErrorAction SilentlyContinue`,
      'Start-Sleep -Milliseconds 1500',
      '__report "stage=cleared"',
    ],
  }).catch(err => {
    throw new Error(`${err.message}\n  elevation is required to stop an elevated instance`);
  });

  await new Promise(r => setTimeout(r, 1500));
  const after = await countInstances();
  if (after > 0) {
    throw new Error(`${after} instance(s) survived the elevated kill — is something restarting it?\n` +
      `  The app registers a logon-triggered scheduled task ("wuwatappo.global") when\n` +
      `  "start with Windows" is enabled; such a copy can reappear on its own.`);
  }

  log(`${style.green('stopped')}`);
  return 0;
}

async function count() {
  const out = await runPS(`(Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Measure-Object).Count`);
  return Number(out.trim()) || 0;
}
