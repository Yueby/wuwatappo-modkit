// The files a packaged program carries inside itself, and the same files read from the repository when
// it is not packaged. Only one kind is carried: the framework scripts that are sent into every window
// (src/runtime/), because they are read from disk at run time. The program carries no mods: mods
// come from the community and are installed into the app folder (see install.js).
//
// scripts/build.js lists every embedded file in an asset called index.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import * as sea from 'node:sea';
import { RUNTIME_DIR } from './paths.js';

export const isPackaged = () => sea.isSea();

let index = null;
const keys = () => (index ??= JSON.parse(sea.getAsset('index.json', 'utf8')));

// The framework scripts, as { name, code }, in name order.
export async function runtimeScripts() {
  if (isPackaged()) {
    return keys()
      .filter(key => /^runtime\/[^/]+\.js$/.test(key))
      .sort()
      .map(key => ({ name: path.basename(key), code: sea.getAsset(key, 'utf8') }));
  }
  const names = (await fs.readdir(RUNTIME_DIR)).filter(name => /\.m?js$/i.test(name) && !/^[_.]/.test(name)).sort();
  return Promise.all(names.map(async name => ({ name, code: await fs.readFile(path.join(RUNTIME_DIR, name), 'utf8') })));
}
