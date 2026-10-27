// node src/cli.js commands — list backend commands found in the extracted frontend.

import path from 'node:path';
import { listCommands } from '../../scripts/list-commands.js';
import { PROJECT_ROOT } from '../lib/mods.js';
import { parseOptions } from './options.js';
import { log, section, style } from '../lib/output.js';

// Commands that terminate the app; probing them kills the instance under test.
const DESTRUCTIVE = new Set(['exit_app', 'quit_app', 'quit']);

export default async function commands(argv) {
  const options = parseOptions(argv);
  const [dir = path.join(PROJECT_ROOT, 'work', 'assets', 'assets')] = options.positional;

  const commands = listCommands(dir);
  section(`${commands.length} backend commands`);

  for (const { command, sources } of commands) {
    const danger = DESTRUCTIVE.has(command) ? `  ${style.red('terminates the app')}` : '';
    log(`  ${command.padEnd(42)} ${style.dim(sources[0])}${danger}`);
  }
  return 0;
}