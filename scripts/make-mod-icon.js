#!/usr/bin/env node
// Write the generated MOD tab icons to a directory so they can be looked at.
//   node scripts/make-mod-icon.js <dir>

import fs from 'node:fs';
import path from 'node:path';
import { STATES, buildIcon } from '../src/lib/icon.js';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node scripts/make-mod-icon.js <output-dir>');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [state, spec] of Object.entries(STATES)) {
  const png = buildIcon(spec);
  const file = path.join(outDir, `mod-icon-${state}.png`);
  fs.writeFileSync(file, png);
  console.log(`${file}  ${spec.size}x${spec.size}  glyph ${spec.glyph}px  ${png.length} bytes`);
}
