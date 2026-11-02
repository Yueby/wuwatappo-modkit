// What is in the app folder besides the app, and putting it there (see paths.js for the picture).
//
// Running `setup` again is how a new version of this program, or an app update, is taken up, so all of
// this is safe to repeat. The folders start empty: this program carries no mods, they are installed
// into mods\ by whoever wants them (see install.js).

import fs from 'node:fs/promises';
import path from 'node:path';
import { INSTALL_DIR, LAUNCHER_FILE, LOADER_DIR, LOADER_EXE, MODS_DIR, MOD_DATA_DIR } from './paths.js';

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

// The exe the person opens (the one in the app folder) is not the one the loader runs from, so the loader is told where
// it is: setup writes it down when it runs from there. A loader that updates replaces that file.
export async function rememberLauncher({ exe = process.execPath, file = LAUNCHER_FILE, loader = LOADER_EXE } = {}) {
  // run from the loader's own folder (its copy, or a download waiting there): that is not the exe the person opens
  if (path.dirname(path.resolve(exe)).toLowerCase() === path.dirname(path.resolve(loader)).toLowerCase()) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ exe: path.resolve(exe) }));
  return true;
}

// Where that is, if it is still there; otherwise modkit.exe in the app folder, if there is one; otherwise null.
export async function readLauncher({ file = LAUNCHER_FILE, dir = INSTALL_DIR } = {}) {
  const exists = candidate => fs.stat(candidate).then(stat => stat.isFile(), () => false);
  try {
    const exe = JSON.parse(await fs.readFile(file, 'utf8')).exe;
    if (typeof exe === 'string' && await exists(exe)) return exe;
  } catch { /* none written yet, or not readable */ }
  const guess = path.join(dir, 'modkit.exe');
  return (await exists(guess)) ? guess : null;
}
