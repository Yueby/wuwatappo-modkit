// The injector: one live CDP session per app window, kept across reloads.
//
// WebView2 ignores Page.addScriptToEvaluateOnNewDocument, so a reload would drop
// every mod. Instead we watch navigation events and re-inject afterwards. That is
// the whole reason this is a resident process rather than a one-shot script.

import { CDPSession } from './cdp.js';
import { targetList, windowLabel } from './targets.js';
import { compileCore, compileMod, retireMissing } from './page-scripts.js';
import { modsSignature, unitFor } from './mods.js';

// What is worth a line in the log. 'idle' (the mod has no script for this window) and
// 'already-installed' would be noise: every mod is installed in every window.
const REPORTED = new Set(['ok', 'error', 'off']);

export class Injector {
  #port;
  #log;
  #mods = [];
  #signature = '';
  #sessions = new Map(); // target id -> { target, session, needsInject }

  constructor({ port, log = () => {} }) {
    this.#port = port;
    this.#log = log;
  }

  // Returns true when the set of mods actually changed.
  setMods(mods) {
    const signature = modsSignature(mods);
    if (signature === this.#signature) return false;
    this.#mods = mods;
    this.#signature = signature;
    // A changed mod must be re-evaluated even in windows we already injected into; the
    // page compares versions and disposes the old copy itself.
    for (const entry of this.#sessions.values()) entry.needsInject = true;
    return true;
  }

  // Attach to new windows, drop sessions for windows that are gone.
  async #syncSessions() {
    const targets = await targetList({ port: this.#port });

    const live = new Set(targets.map(t => t.id));
    for (const [id, entry] of this.#sessions) {
      if (!live.has(id) || entry.session.closed) {
        entry.session.close();
        this.#sessions.delete(id);
      }
    }

    for (const target of targets) {
      if (this.#sessions.has(target.id)) continue;
      try {
        const session = await CDPSession.connect(target);
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

  // Inject into every window that needs it (its document changed, or the mods did).
  // Returns one report per mod that was installed, failed, or removed.
  async injectAll({ force = false } = {}) {
    const reports = [];
    await this.#syncSessions();

    for (const [id, entry] of this.#sessions) {
      if (!force && !entry.needsInject) continue;

      const { target, session } = entry;
      const label = windowLabel(target);
      const thisWindow = [];

      try {
        // Drop anything whose file is gone first, so a deleted mod's UI does not outlive it.
        for (const name of await session.evaluate(retireMissing(this.#mods.map(m => m.name))) ?? []) {
          thisWindow.push({ window: label, mod: name, status: 'removed' });
        }

        for (const mod of this.#mods) {
          const report = await this.#install(session, mod, label);
          if (REPORTED.has(report?.status)) thisWindow.push({ window: label, mod: mod.name, ...report });
        }
        entry.needsInject = false;
        if (thisWindow.length) this.#log(`${label}: injected ${thisWindow.length} mod(s)`);
      } catch (err) {
        if (session.closed) {
          // The window went away mid-pass; the next pass re-syncs.
          this.#sessions.delete(id);
        } else {
          // Anything else is a real failure and must be seen, not swallowed: leave the
          // window flagged so the next pass retries it, and say what happened.
          this.#log(`${label}: injection failed (${err.message})`);
          thisWindow.push({ window: label, mod: '(injector)', status: 'error', error: err.message });
        }
      }
      reports.push(...thisWindow);
    }
    return reports;
  }

  // One mod into one window. A mod that fails to even compile (a syntax error) must not stop
  // the ones after it, and must still show up on the MOD page, so it is installed again as a
  // placeholder that carries the message.
  async #install(session, mod, label) {
    const unit = mod.core ? null : unitFor(mod, label);
    try {
      return await session.evaluate(mod.core ? compileCore(mod) : compileMod(unit, label));
    } catch (err) {
      if (session.closed || mod.core) throw err;
      const message = err.message.split('\n')[0];
      try {
        await session.evaluate(compileMod({ ...unit, code: null, loadError: message }, label));
      } catch { /* the report below is what matters */ }
      return { status: 'error', error: message };
    }
  }

  close() {
    for (const { session } of this.#sessions.values()) session.close();
    this.#sessions.clear();
  }
}
