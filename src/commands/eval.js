// node src/cli.js eval <js> — evaluate an expression in every window.

import { openAppSessions } from '../lib/cdp.js';
import { windowLabel } from '../lib/targets.js';
import { parseOptions } from './options.js';
import { log, style } from '../lib/output.js';

export default async function evaluate(argv) {
  const options = parseOptions(argv);
  const expression = options.positional.join(' ');
  if (!expression.trim()) throw new Error('usage: eval <javascript expression>');

  const sessions = await openAppSessions({ port: options.port, log: m => log(style.yellow(m)) });
  if (!sessions.length) throw new Error('no app windows found — is the test copy running?');

  try {
    for (const { target, session } of sessions) {
      const label = windowLabel(target).padEnd(10);
      try {
        const value = await session.evaluate(expression);
        log(`  ${label} ${format(value)}`);
      } catch (err) {
        log(`  ${label} ${style.red(err.message)}`);
      }
    }
  } finally {
    for (const { session } of sessions) session.close();
  }
  return 0;
}

function format(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}