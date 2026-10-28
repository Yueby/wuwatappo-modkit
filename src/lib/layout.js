// What is in the app folder besides the app, and putting it there (see paths.js for the picture).
//
// Running `setup` again is how a new version of this program, or an app update, is taken up, so all of
// this is safe to repeat. The folders start empty: this program carries no mods, they are installed
// into mods\ by whoever wants them (see install.js).

import fs from 'node:fs/promises';
import path from 'node:path';
import { LOADER_DIR, LOADER_EXE, MODS_DIR, MOD_DATA_DIR } from './paths.js';

// The folders it keeps. Made if they are not there, left as they are if they are.
export async function ensureFolders({ dirs = [MODS_DIR, MOD_DATA_DIR, LOADER_DIR] } = {}) {
  const made = [];
  for (const dir of dirs) {
    const existed = await fs.stat(dir).then(() => true, () => false);
    await fs.mkdir(dir, { recursive: true });
    if (!existed) made.push(dir);
  }
  return made;
}

// A running exe cannot be overwritten on Windows. The loader stays running for days, so it runs from
// a copy of the program kept with its other files, and the program itself, in the app folder, is
// never in use: a new version can be dropped over it, and run, to take its place.
export async function installLoaderCopy({ from = process.execPath, to = LOADER_EXE } = {}) {
  if (path.resolve(from) === path.resolve(to)) return { path: to, copied: false };
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return { path: to, copied: true };
}

export async function removeLoaderCopy({ file = LOADER_EXE } = {}) {
  await fs.rm(file, { force: true });
}
