// What is in the app folder besides the app, and putting it there (see paths.js for the picture).
//
// Both functions are safe to run again and again, which is what re-running `setup` after an app
// update does: they only ever add what is missing, and never overwrite or delete what is there.

import fs from 'node:fs/promises';
import path from 'node:path';
import { BUNDLED_MODS_DIR, LEGACY_MOD_DATA_DIR, MODS_DIR, MOD_DATA_DIR, LOADER_DIR } from './paths.js';

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function entries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function ensureFolders({ dirs = [MODS_DIR, MOD_DATA_DIR, LOADER_DIR] } = {}) {
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });
}

// The mods that come with the program, put into the mods folder if they are not there. One that is
// there is left exactly as it is: it may have been changed, or be a newer one.
export async function installBundledMods({ from = BUNDLED_MODS_DIR, to = MODS_DIR } = {}) {
  const result = { installed: [], kept: [] };
  if (path.resolve(from) === path.resolve(to)) return result;       // developing in the folder itself

  await fs.mkdir(to, { recursive: true });
  for (const entry of await entries(from)) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(to, entry.name);
    if (await exists(target)) {
      result.kept.push(entry.name);
      continue;
    }
    await fs.cp(path.join(from, entry.name), target, { recursive: true, filter: file => !/[\\/]node_modules([\\/]|$)/.test(file) });
    result.installed.push(entry.name);
  }
  return result;
}

// A mod's data used to be kept inside the repository. Moved (not copied: two copies would drift) to
// the mod's folder in moddata, unless that already has something, which is then left alone and the old
// one is reported so nothing is lost.
export async function moveLegacyData({ from = LEGACY_MOD_DATA_DIR, to = MOD_DATA_DIR } = {}) {
  const result = { moved: [], skipped: [] };
  if (path.resolve(from) === path.resolve(to)) return result;

  for (const entry of await entries(from)) {
    if (!entry.isDirectory()) continue;
    const target = path.join(to, entry.name);
    if (await exists(target)) {
      result.skipped.push(entry.name);
      continue;
    }
    await fs.mkdir(to, { recursive: true });
    try {
      await fs.rename(path.join(from, entry.name), target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;                           // another drive: copy, then remove
      await fs.cp(path.join(from, entry.name), target, { recursive: true });
      await fs.rm(path.join(from, entry.name), { recursive: true, force: true });
    }
    result.moved.push(entry.name);
  }
  return result;
}
