// Command registry.

import autostart from './autostart.js';
import dev from './dev.js';
import lab from './lab.js';
import mods from './mods.js';
import run from './run.js';
import selftest from './selftest.js';
import setup, { uninstall } from './setup.js';
import start from './start.js';
import update from './update.js';
import watch from './watch.js';
import window from './window.js';
import evaluate from './eval.js';
import state from './state.js';
import stop from './stop.js';
import extractAssets from './extract-assets.js';
import backendCommands from './backend-commands.js';

export const COMMANDS = {
  selftest,
  window,
  update,
  setup,
  uninstall,
  start,
  autostart,
  mods,
  dev,
  lab,
  run,
  watch,
  eval: evaluate,
  state,
  stop,
  'extract-assets': extractAssets,
  'backend-commands': backendCommands,
};