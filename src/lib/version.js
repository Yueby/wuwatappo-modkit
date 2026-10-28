// Which version of this program this is.
//
// From package.json, which is the one place a version is written. The build puts it into the exe
// (scripts/build.js defines __MODKIT_VERSION__), because a packaged program has no package.json to
// read; from the repository it is read from the file.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function fromPackage() {
  const file = fileURLToPath(new URL('../../package.json', import.meta.url));
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

export const VERSION = typeof __MODKIT_VERSION__ === 'string' ? __MODKIT_VERSION__ : fromPackage();
