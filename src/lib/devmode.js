// Developing a plugin: use the folder it is written in, as it is.
//
// Two modes, and a switch between them that takes effect within a second, with nothing restarted:
//
//   release   the plugins in <app folder>\mods, which is where `mods get` (the plugin registry) puts them
//   dev       the folders named here are used in place of those, one for one by name: a plugin that is
//             in one of them is loaded from there, whether or not the registry's copy is installed. Every
//             edit is picked up the way an edit in mods\ is (the page scripts reload, a Node part
//             restarts), and nothing is copied: there is no install to repeat.
//
// What is kept is in <app folder>\moddata\.modkit\dev.json:  { "enabled": true, "dirs": ["D:\\work\\mods"] }
// `dirs` stay when the mode is switched off, so that switching back is one word. A folder is either a
// plugin (it has a package.json, or an index.js) or a folder of plugins, like mods\ itself.

import fs from 'node:fs/promises';
import path from 'node:path';
import { DEV_FILE } from './paths.js';

const EMPTY = () => ({ enabled: false, dirs: [] });

// What is saved, tolerant of a file that is missing or that someone has edited badly: that is "off".
export async function readDev({ file = DEV_FILE } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return EMPTY();
  }
  const dirs = Array.isArray(parsed?.dirs) ? parsed.dirs.filter(dir => typeof dir === 'string' && dir.trim()).map(dir => path.resolve(dir)) : [];
  return { enabled: parsed?.enabled === true && dirs.length > 0, dirs: [...new Set(dirs)] };
}

export async function writeDev(state, { file = DEV_FILE } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ enabled: state.enabled === true, dirs: state.dirs }, null, 2));
  await fs.rename(temp, file);          // the loader reads this every second: it never sees half of it
}

async function isFolder(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// The changes the `dev` command makes. Each resolves with the state as saved.
export async function setDev(change, options = {}) {
  const state = await readDev(options);
  const dir = change.dir ? path.resolve(change.dir) : null;

  if (dir && change.action !== 'remove' && !(await isFolder(dir))) throw new Error(`${dir} is not a folder`);

  switch (change.action) {
    case 'on':
      if (dir && !state.dirs.includes(dir)) state.dirs.push(dir);
      if (!state.dirs.length) throw new Error('dev mode needs a folder: dev on <folder>');
      state.enabled = true;
      break;
    case 'off':
      state.enabled = false;
      break;
    case 'add':
      if (!dir) throw new Error('add which folder?');
      if (!state.dirs.includes(dir)) state.dirs.push(dir);
      break;
    case 'remove':
      if (!dir) throw new Error('remove which folder?');
      state.dirs = state.dirs.filter(saved => saved.toLowerCase() !== dir.toLowerCase());
      if (!state.dirs.length) state.enabled = false;
      break;
    default:
      throw new Error(`unknown change ${change.action}`);
  }
  await writeDev(state, options);
  return state;
}
