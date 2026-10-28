// Shared argument parsing for commands.
//
// Options are all `--name value` (or a bare `--flag`). Anything starting with `--` that is
// not listed here is an error: a mistyped option (`--prot 9333`) used to be quietly treated
// as a positional argument, so it did nothing and said nothing.

import { MODS_DIR } from '../lib/paths.js';
import { DEFAULT_PORT } from '../lib/targets.js';

// name -> [key on the result, takes a value]
const OPTIONS = {
  '--port': ['port', true],
  '--mods-dir': ['modsDir', true],
  '--exe': ['exe', true],
  '--out': ['out', true],
  '--assets': ['assets', true],
  '--force': ['force', false],
  '--rebuild': ['rebuild', false],
  '--restore': ['restore', false],
  '--no-launch': ['noLaunch', false],
  '--log-file': ['logFile', false],
  '--no-deps': ['noDeps', false],
  '--allow-scripts': ['allowScripts', false],
  '--purge': ['purge', false],
  '--restore-exe': ['restoreExe', false],
};

export function parseOptions(argv) {
  const options = {
    port: DEFAULT_PORT,
    modsDir: MODS_DIR,
    exe: null,
    out: null,
    assets: null,
    force: false,
    rebuild: false,
    restore: false,
    noLaunch: false,
    logFile: false,
    noDeps: false,
    allowScripts: false,
    purge: false,
    restoreExe: false,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      options.positional.push(arg);
      continue;
    }

    const spec = OPTIONS[arg];
    if (!spec) throw new Error(`unknown option ${arg}\n  known: ${Object.keys(OPTIONS).join(' ')}`);

    const [key, takesValue] = spec;
    if (!takesValue) {
      options[key] = true;
      continue;
    }

    const value = argv[++i];
    if (value == null || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    options[key] = value;
  }

  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port <= 0) throw new Error('--port needs a number');

  return options;
}
