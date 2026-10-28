// node src/cli.js dev [status | on [folder] | off | add <folder> | remove <folder>]
//
// Developing a plugin without installing it. In dev mode the folders named here are used in place of the
// installed plugins of the same name, and every edit is loaded as it is saved (see lib/devmode.js).
//
//   status          which mode, which folders, which plugins are in them (the default)
//   on [folder]     switch dev mode on, adding the folder if one is given
//   off             back to the installed plugins (the folders are remembered)
//   add <folder>    remember one more folder
//   remove <folder> forget one
//   --json          status as JSON, for other programs
//
// A running loader notices the change within a second: nothing is restarted, and what is on screen
// in the app is replaced as the plugins change.

import { readDev, setDev } from '../lib/devmode.js';
import { discoverDev, discoverMods } from '../lib/mods.js';
import { field, log, section, style } from '../lib/output.js';
import { parseOptions } from './options.js';

export default async function dev(argv) {
  const options = parseOptions(argv);
  const [action = 'status', folder] = options.positional;

  if (['on', 'off', 'add', 'remove'].includes(action)) {
    await setDev({ action, dir: folder });
  } else if (action !== 'status') {
    throw new Error(`unknown action "${action}": use status, on, off, add or remove`);
  }
  return status(options);
}

async function status(options) {
  const state = await readDev();
  const found = await discoverDev(state.dirs);
  const installed = await discoverMods(options.modsDir, { check: false });
  const shadowed = found.filter(mod => installed.some(other => other.name === mod.name)).map(mod => mod.name);

  if (options.json) {
    log(JSON.stringify({
      enabled: state.enabled,
      dirs: state.dirs,
      mods: found.map(mod => ({ id: mod.name, version: mod.manifest.version, dir: mod.devDir, problem: mod.loadError })),
      shadowed,
    }));
    return 0;
  }

  section('Dev mode');
  field('mode', state.enabled ? style.green('on: the folders below are used') : 'off: the plugins installed in mods\\ are used');
  if (!state.dirs.length) field('folders', style.dim('none yet: node src/cli.js dev on <folder>'));
  for (const dir of state.dirs) field(state.dirs[0] === dir ? 'folders' : '', dir);
  for (const mod of found) {
    const note = mod.loadError ? style.red(mod.loadError.split('\n')[0]) : shadowed.includes(mod.name) ? style.dim('instead of the installed one') : '';
    field(state.dirs[0] === mod.devDir && mod === found[0] ? 'plugins' : '', `${mod.name} ${mod.manifest.version ?? ''} ${note}`.trim());
  }
  return 0;
}
