// node src/cli.js state — what is live in each window right now.

import { openAppSessions } from '../lib/cdp.js';
import { windowLabel } from '../lib/targets.js';
import { PROBE_MODS } from '../lib/inject.js';
import { parseOptions } from './options.js';
import { log, style } from '../lib/output.js';

export default async function state(argv) {
  const options = parseOptions(argv);
  const sessions = await openAppSessions({ port: options.port, log: m => log(style.yellow(m)) });
  if (!sessions.length) throw new Error('no app windows found — is the test copy running?');

  try {
    for (const { target, session } of sessions) {
      const label = windowLabel(target);
      let mods;
      try {
        mods = await session.evaluate(PROBE_MODS);
      } catch (err) {
        log(`  ${label.padEnd(10)} ${style.red('unresponsive: ' + err.message)}`);
        continue;
      }

      const names = Object.keys(mods);
      if (!names.length) {
        log(`  ${label.padEnd(10)} ${style.dim('no mods')}`);
        continue;
      }

      log(`  ${label.padEnd(10)} ${names.map(name => {
        const status = mods[name];
        if (status === 'ok') return style.green(name);
        if (status === 'error') return style.red(name);
        return style.yellow(`${name} (${status})`);
      }).join('  ')}`);
    }
  } finally {
    for (const { session } of sessions) session.close();
  }
  return 0;
}