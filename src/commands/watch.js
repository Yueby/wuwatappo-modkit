// node src/cli.js watch — resident injector.
//
// Two triggers, both cheap:
//   * a window navigated (reload, route change) -> re-inject that window
//   * a mod file changed on disk            -> re-inject everywhere
// Polling the filesystem is what lets you edit a mod and see it applied without
// restarting this process; the cost is one directory stat every interval.

import { Injector } from '../lib/injector.js';
import { discoverMods, modsSignature } from '../lib/mods.js';
import { DebugPortUnavailable } from '../lib/targets.js';
import { parseOptions } from './options.js';
import { log, statusWord, style } from '../lib/output.js';

const MODS_POLL_MS = 1000;
const INJECT_POLL_MS = 1500;

export default async function watch(argv) {
  const options = parseOptions(argv);

  const injector = new Injector({
    port: options.port,
    log: msg => log(style.dim(`  ${msg}`)),
  });

  let signature = '';
  let stopped = false;
  let lastError = '';

  const stop = signal => {
    if (stopped) return;
    stopped = true;
    log(`\n${style.dim(`${signal} — stopping, waiting for the app to be closed`)}`);
    injector.close();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));

  log(`${style.bold('watching')} ${options.modsDir}  ${style.dim(`(port ${options.port}, Ctrl+C to stop)`)}`);

  let modsTick = 0;

  for (;;) {
    if (stopped) break;

    // Reload mods from disk when the poll timer comes around.
    if (modsTick-- <= 0) {
      modsTick = Math.max(1, Math.round(MODS_POLL_MS / INJECT_POLL_MS));
      try {
        const mods = await discoverMods(options.modsDir);
        const next = modsSignature(mods);
        if (next !== signature) {
          signature = next;
          injector.setMods(mods);
          log(`${style.cyan('mods')} ${mods.map(m => m.name).join(', ') || style.dim('(none)')}`);
        }
      } catch (err) {
        log(`${style.red('mods')} ${err.message}`);
      }
    }

    try {
      const reports = await injector.injectAll({ force: options.force });
      for (const r of reports) {
        const detail = r.status === 'error' ? `  ${style.red(r.error)}` : '';
        log(`  ${r.window.padEnd(10)} ${r.mod.padEnd(20)} ${statusWord(r.status)}${detail}`);
      }
      // --force is for a single pass; after that, normal change detection.
      options.force = false;
      lastError = '';
    } catch (err) {
      if (err instanceof DebugPortUnavailable) {
        const message = err.message.split('\n')[0];
        if (message !== lastError) {
          log(style.yellow(`waiting: ${message}`));
          lastError = message;
        }
      } else {
        log(style.red(`inject: ${err.message}`));
        lastError = err.message;
      }
    }

    await new Promise(r => setTimeout(r, INJECT_POLL_MS));
  }
  return 0;
}