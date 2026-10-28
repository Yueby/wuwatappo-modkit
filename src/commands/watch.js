// node src/cli.js watch — resident injector.
//
// Two triggers, both cheap:
//   * a window navigated (reload, route change) -> re-inject that window
//   * a mod file changed on disk            -> re-inject everywhere
// Polling the filesystem is what lets you edit a mod and see it applied without
// restarting this process; the cost is one directory stat every interval.
//
// This is also the process a mod's Node part runs in (see host.js): it exists only while this
// command does, and stops with it.

import { HostManager } from '../lib/host.js';
import { acquireLock } from '../lib/lock.js';
import { Injector } from '../lib/injector.js';
import { ModManager } from '../lib/manager.js';
import { readDevOr } from '../lib/devmode.js';
import { discoverAll, modsSignature } from '../lib/mods.js';
import { DebugPortUnavailable } from '../lib/targets.js';
import { parseOptions } from './options.js';
import { log, statusWord, style } from '../lib/output.js';

const MODS_POLL_MS = 1000;
const INJECT_POLL_MS = 1500;

export default function watch(argv) {
  return resident(parseOptions(argv));
}

// `lock` is for a caller that took it already (start does, before it launches the app).
export async function resident(options, { lock = acquireLock() } = {}) {

  const say = msg => log(style.dim(`  ${msg}`));
  const injector = new Injector({ port: options.port, log: say });
  const hosts = new HostManager({ log: say });
  hosts.connect(injector);
  const manager = new ModManager({ modsDir: options.modsDir, app: injector, log: say });
  injector.onHostMessage = (window, text) => {
    if (!manager.onPageMessage(window, text)) hosts.onPageMessage(window, text);
  };

  let signature = '';
  let devWas = null;
  let lastDev = null;
  let devUnreadable = false;
  let stopped = false;
  let lastError = '';

  const stop = async signal => {
    if (stopped) return;
    stopped = true;
    log(`\n${style.dim(`${signal} — stopping`)}`);
    await hosts.close();         // their dispose hooks run before the process goes
    injector.close();
    lock.release();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGBREAK', () => stop('SIGBREAK'));       // Ctrl+Break, and a console being closed

  log(`${style.bold('watching')} ${options.modsDir}  ${style.dim(`(port ${options.port}, Ctrl+C to stop)`)}`);

  let modsTick = 0;

  for (;;) {
    if (stopped) break;

    // Reload mods from disk when the poll timer comes around.
    if (modsTick-- <= 0) {
      modsTick = Math.max(1, Math.round(MODS_POLL_MS / INJECT_POLL_MS));
      try {
        const read = await readDevOr(lastDev);            // read every time: switching modes needs no restart
        const dev = read.state;
        lastDev = dev;
        if (read.kept && !devUnreadable) log(style.yellow('dev mode: could not read dev.json just now, keeping what it had'));
        devUnreadable = read.kept;
        const mods = await discoverAll(options.modsDir, { devDirs: dev.enabled ? dev.dirs : [] });
        const next = modsSignature(mods);
        if (next !== signature) {
          signature = next;
          injector.setMods(mods);
          hosts.setMods(mods);
          const user = mods.filter(m => !m.core).map(m => (m.dev ? `${m.name} (dev)` : m.name));
          log(`${style.cyan('mods')} ${user.join(', ') || style.dim('(none)')}  ${style.dim(`+ ${mods.length - user.length} framework`)}`);
          if (dev.enabled !== devWas) {
            devWas = dev.enabled;
            log(`${style.cyan('dev mode')} ${dev.enabled ? `on: ${dev.dirs.join(', ')}` : 'off: the plugins installed in mods\\ are used'}`);
          }
        }
      } catch (err) {
        log(`${style.red('mods')} ${err.message}`);
      }
    }

    try {
      const reports = await injector.injectAll({ force: options.force });
      for (const r of reports) {
        const detail = r.status === 'error' ? `  ${style.red(r.error)}` : '';
        log(`  ${r.window.padEnd(10)} ${r.mod.padEnd(26)} ${statusWord(r.status)}${detail}`);
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
          hosts.stopAll();       // the app is gone: nothing for a Node part to serve
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