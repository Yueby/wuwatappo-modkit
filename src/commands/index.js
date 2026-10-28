// Command registry.

import lab from './lab.js';
import run from './run.js';
import watch from './watch.js';
import evaluate from './eval.js';
import state from './state.js';
import stop from './stop.js';
import extractAssets from './extract-assets.js';
import commands from './commands.js';

export const COMMANDS = {
  lab,
  run,
  watch,
  eval: evaluate,
  state,
  stop,
  'extract-assets': extractAssets,
  commands,
};