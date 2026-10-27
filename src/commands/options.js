// Shared argument parsing for commands.

import { DEFAULT_MODS_DIR } from '../lib/mods.js';
import { DEFAULT_PORT } from '../lib/targets.js';

export function parseOptions(argv) {
  const options = {
    port: DEFAULT_PORT,
    modsDir: DEFAULT_MODS_DIR,
    force: false,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
        options.port = Number(argv[++i]);
        if (!Number.isInteger(options.port) || options.port <= 0) throw new Error('--port needs a number');
        break;
      case '--mods-dir':
        options.modsDir = argv[++i];
        if (!options.modsDir) throw new Error('--mods-dir needs a path');
        break;
      case '--force':
        options.force = true;
        break;
      default:
        options.positional.push(arg);
    }
  }

  return options;
}