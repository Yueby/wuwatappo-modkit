// node src/cli.js run — one pass over every window, then exit.

import { Injector } from '../lib/injector.js';
import { discoverAll } from '../lib/mods.js';
import { parseOptions } from './options.js';
import { log, statusWord, style } from '../lib/output.js';

export default async function run(argv) {
  const options = parseOptions(argv);
  // Framework first, then the user's mods. The framework is always present, so an
  // empty mods/ folder is no reason to stop: the manager page still has to appear.
  const mods = await discoverAll(options.modsDir);
  if (!mods.some(m => !m.core)) log(style.dim(`no mods in ${options.modsDir} — injecting the framework only`));

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
    log(`  ${r.window.padEnd(10)} ${r.mod.padEnd(26)} ${statusWord(r.status)}${detail}`);
  }
  return reports.some(r => r.status === 'error') ? 1 : 0;
}