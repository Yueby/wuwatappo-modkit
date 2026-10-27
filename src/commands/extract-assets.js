// node src/cli.js extract-assets — thin wrapper over scripts/extract-assets.js

import path from 'node:path';
import { extractAssets } from '../../scripts/extract-assets.js';
import { PROJECT_ROOT } from '../lib/mods.js';
import { ORIGINAL_EXE } from '../lib/patch.js';
import { parseOptions } from './options.js';
import { log, style } from '../lib/output.js';

export default async function extract(argv) {
  const options = parseOptions(argv);
  const [exe = ORIGINAL_EXE, outDir = path.join(PROJECT_ROOT, 'work', 'assets')] = options.positional;

  const results = extractAssets({ exe, outDir, log });
  const ok = results.filter(r => r.ok).length;
  log(`\n${ok === results.length ? style.green('ok') : style.yellow('partial')}  ${ok}/${results.length} assets -> ${outDir}`);
  for (const r of results.filter(r => !r.ok)) log(`  ${style.red('failed')} ${r.path}`);
  return ok === results.length ? 0 : 1;
}