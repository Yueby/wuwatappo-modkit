// node src/cli.js stop
//
// Stop every running instance of the app, including one running as administrator (see stopApp in
// lib/ps.js for how).

import { countInstances, stopApp } from '../lib/ps.js';
import { parseOptions } from './options.js';
import { field, log, style } from '../lib/output.js';

export default async function stop(argv) {
  parseOptions(argv); // validates flags even though stop takes none of them

  const running = await countInstances();
  if (running === 0) {
    log(style.dim('no instances running'));
    return 0;
  }
  field('running', `${running} instance(s)`);

  await stopApp({ say: message => log(`  ${style.yellow(message)}`) });
  log(style.green('stopped'));
  return 0;
}
