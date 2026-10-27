// The injector: one live CDP session per app window, kept across reloads.
//
// WebView2 ignores Page.addScriptToEvaluateOnNewDocument, so a reload would drop
// every mod. Instead we watch navigation events and re-inject afterwards. That is
// the whole reason this is a resident process rather than a one-shot script.

import { CDPSession } from './cdp.js';
import { targetList, windowLabel, DebugPortUnavailable } from './targets.js';
import { compileMod } from './inject.js';
import { modsSignature } from './mods.js';

export class Injector {
  #port;
  #log;
  #mods = [];
  #signature = '';
  #sessions = new Map(); // targetId -> { target, session, needsInject, off }
  #reports = [];

  constructor({ port, log = () => {} }) {
    this.#port = port;
    this.#log = log;
  }

  get mods() { return this.#mods; }

  setMods(mods) {
    const signature = modsSignature(mods);
    if (signature === this.#signature) return false;
    this.#mods = mods;
    this.#signature = signature;
    // A changed mod must be re-evaluated even in windows we already injected
    // into; the page compares versions and disposes the old copy itself.
    for (const entry of this.#sessions.values()) entry.needsInject = true;
    return true;
  }

  // Attach to new windows, drop sessions for windows that are gone.
  async #syncSessions() {
    let targets;
    try {
      targets = await targetList({ port: this.#port });
    } catch (err) {
      if (err instanceof DebugPortUnavailable) throw err;
      throw err;
    }

    const live = new Set(targets.map(t => t.id));
    for (const [targetId, entry] of this.#sessions) {
      if (!live.has(targetId)) {
        entry.session.close();
        this.#sessions.delete(targetId);
      }
    }

    for (const target of targets) {
      if (this.#sessions.has(target.id)) continue;
      try {
        const session = await CDPSession.connect(target);
        // Page.enable must precede navigation hints, but loading a brand-new
        // window takes a moment; evaluate retries instead of failing outright.
        await session.enable(['Page', 'Runtime']);
        const entry = { target, session, needsInject: true };
        session.on(msg => {
          if (msg.method === 'Page.loadEventFired' || msg.method === 'Page.frameNavigated') {
            entry.needsInject = true;
          }
        });
        this.#sessions.set(target.id, entry);
        this.#log(`${windowLabel(target)}: attached`);
      } catch (err) {
        this.#log(`${windowLabel(target)}: attach failed (${err.message})`);
      }
    }
  }

  // Inject into every window. Only windows whose document changed, or that are
  // missing a mod, get work. Returns the fresh reports from this pass.
  async injectAll({ force = false } = {}) {
    const fresh = [];
    await this.#syncSessions();

    for (const [id, entry] of this.#sessions) {
      const { target, session } = entry;
      const label = windowLabel(target);
      const reason = force ? 'forced' : entry.needsInject ? 'changed' : null;
      if (!reason) continue;

      const thisWindow = [];
      try {
        for (const mod of this.#mods) {
          const report = await session.evaluate(compileMod(mod));
          if (report?.status === 'ok' || report?.status === 'error') {
            thisWindow.push({ window: label, mod: mod.name, ...report });
          }
        }
        entry.needsInject = false;
        if (thisWindow.length) this.#log(`${label}: injected ${thisWindow.length} mod(s)`);
      } catch (err) {
        // Window went away mid-pass; let the next pass re-sync.
        this.#sessions.delete(id);
        session.close();
      }
      fresh.push(...thisWindow);
    }
    return fresh;
  }

  async modState() {
    const state = {};
    for (const [id, entry] of this.#sessions) {
      const label = windowLabel(entry.target);
      try {
        const { PROBE_MODS } = await import('./inject.js');
        state[label] = await entry.session.evaluate(PROBE_MODS);
      } catch {
        state[label] = { error: 'window unresponsive' };
      }
    }
    return state;
  }

  async evaluateInAll(expression) {
    const results = [];
    for (const [id, entry] of this.#sessions) {
      const label = windowLabel(entry.target);
      try {
        results.push({ window: label, value: await entry.session.evaluate(expression) });
      } catch (err) {
        results.push({ window: label, error: err.message });
      }
    }
    return results;
  }

  close() {
    for (const { session } of this.#sessions.values()) session.close();
    this.#sessions.clear();
  }
}