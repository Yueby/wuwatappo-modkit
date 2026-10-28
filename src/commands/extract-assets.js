// node src/cli.js extract-assets [--exe <path>] [--out <dir>]
//
// Unpack the frontend (Vue/JS/CSS/images) out of the app's exe. Defaults to the stock
// backup when there is one, so the result does not depend on whether the installed exe
// is patched at the moment.

import fs from 'node:fs';
import { extractAssets } from '../lib/assets.js';
import { APP_EXE, APP_EXE_BACKUP, ASSETS_DIR } from '../lib/paths.js';
import { parseOptions } from './options.js';
import { log, style } from '../lib/output.js';

export default async function extract(argv) {
  const options = parseOptions(argv);
  const exe = options.exe ?? (fs.existsSync(APP_EXE_BACKUP) ? APP_EXE_BACKUP : APP_EXE);
  const outDir = options.out ?? ASSETS_DIR;

  const results = extractAssets({ exe, outDir, log });
  const ok = results.filter(r => r.ok).length;
  log(`\n${ok === results.length ? style.green('ok') : style.yellow('partial')}  ${ok}/${results.length} assets -> ${outDir}`);
  for (const r of results.filter(r => !r.ok)) log(`  ${style.red('failed')} ${r.path}`);
  return ok === results.length ? 0 : 1;
}
