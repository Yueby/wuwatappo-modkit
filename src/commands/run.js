// node src/cli.js run — one pass over every window, then exit.

import { Injector } from '../lib/injector.js';
import { discoverMods } from '../lib/mods.js';
import { parseOptions } from './options.js';
import { log, statusWord, style } from '../lib/output.js';

export default async function run(argv) {
  const options = parseOptions(argv);
  const mods = await discoverMods(options.modsDir);
  if (!mods.length) {
    log(`no mods in ${options.modsDir}`);
    return 0;
  }

  const injector = new Injector({ port: options.port, log: () => {} });
  injector.setMods(mods);

  let reports;
  try {
    reports = await injector.injectAll({ force: options.force });
  } finally {
    injector.close();
  }

  if (!reports.length) {
    log(`${style.dim('nothing to do — every window already has these mods')}`);
    return 0;
  }

  for (const r of reports) {
    const detail = r.status === 'error' ? `  ${style.red(r.error)}` : '';
    log(`  ${r.window.padEnd(10)} ${r.mod.padEnd(20)} ${statusWord(r.status)}${detail}`);
  }
  return reports.some(r => r.status === 'error') ? 1 : 0;
}