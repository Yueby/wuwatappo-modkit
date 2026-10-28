// Source of the in-page mod runtime.
//
// Each mod is compiled into a small async IIFE that runs inside the webview.
// The runtime is shipped as source text because it executes in the page's world,
// not in Node. Keep this file dependency-free: it is never bundled, it is
// stringified straight into Runtime.evaluate.

export const MOD_STATE_KEY = '__wuwaMods';

// Bumped whenever a mod's source changes, so the page can tell a retry apart from
// a genuine re-install. `version` is the mod's signature hash.
export function compileMod({ name, code, version }) {
  const nameLiteral = JSON.stringify(name);
  const versionLiteral = JSON.stringify(version ?? '0');
  return `(async () => {
  const T = window.__TAURI_INTERNALS__;
  if (!T) return { status: 'not-ready' };

  const registry = (window.${MOD_STATE_KEY} ??= {});
  const previous = registry[${nameLiteral}];
  if (previous && previous.version === ${versionLiteral}) {
    // Same source: keep whatever the installed copy did, do not run it twice.
    return { status: previous.status === 'error' ? 'error' : 'already-installed' };
  }
  if (previous && previous.dispose) {
    // Source changed while the window was live: tear the old copy down first.
    try { previous.dispose(); } catch (err) { console.warn('dispose failed', err); }
  }

  const disposers = [];
  registry[${nameLiteral}] = { status: 'installing', version: ${versionLiteral}, dispose: () => disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch {} }) };

  const mod = {
    name: ${nameLiteral},
    invoke: (cmd, args) => T.invoke(cmd, args),
    log: (...args) => console.log('[%s]'.replace('%s', ${nameLiteral}), ...args),
    warn: (...args) => console.warn('[%s]'.replace('%s', ${nameLiteral}), ...args),
    css(text) {
      const style = document.createElement('style');
      style.textContent = text;
      style.dataset.wuwaMod = ${nameLiteral};
      (document.head ?? document.documentElement).appendChild(style);
      const remove = () => style.remove();
      disposers.push(remove);
      return remove;
    },
    // Registering an element/timer cleanup is what makes hot-reload safe: on a
    // source change the old copy is disposed before the new one runs.
    onDispose(fn) {
      disposers.push(fn);
      return fn;
    },
    // Put a card on the MOD page of the settings panel. The argument is
    //   { title, description?, render?() -> HTMLElement }
    // render() is called every time the page is drawn, so build the element from the
    // mod's own state rather than keeping it around. The card is removed again when
    // this mod is disposed (hot reload, or the mod failing).
    entry(def) {
      const kit = window.modkit;
      if (!kit) {
        console.warn('[%s] mod.entry: the framework is not loaded in this window'.replace('%s', ${nameLiteral}));
        return () => {};
      }
      const entry = { ...def, owner: ${nameLiteral} };
      kit.addEntry(entry);
      const remove = () => kit.removeEntry(entry);
      disposers.push(remove);
      return remove;
    },
    onEvent(event, handler) {
      return T.invoke('plugin:event|listen', {
        event,
        target: { kind: 'Any' },
        handler: T.transformCallback(handler),
      });
    },
    waitFor(selector, { timeout = 10000, root = document } = {}) {
      return new Promise((resolve, reject) => {
        const found = root.querySelector(selector);
        if (found) return resolve(found);
        const observer = new MutationObserver(() => {
          const el = root.querySelector(selector);
          if (!el) return;
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('timed out waiting for ' + selector));
        }, timeout);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    },
  };

  try {
    const result = await (async () => { ${code}\n })();
    registry[${nameLiteral}] = {
      status: 'ok',
      result: result ?? null,
      version: ${versionLiteral},
      dispose: registry[${nameLiteral}]?.dispose,
    };
    window.modkit?.changed?.();
    return { status: 'ok' };
  } catch (err) {
    // A mod that dies halfway has usually already added a card, a style, a timer.
    // Leaving that behind gives a half-working UI that is harder to diagnose than
    // none, so undo it; the error itself stays visible in the registry.
    try { registry[${nameLiteral}]?.dispose?.(); } catch {}
    registry[${nameLiteral}] = {
      status: 'error',
      error: String(err),
      version: ${versionLiteral},
      dispose: registry[${nameLiteral}]?.dispose,
    };
    console.error('[%s] failed'.replace('%s', ${nameLiteral}), err);
    window.modkit?.changed?.();
    return { status: 'error', error: String(err) };
  }
})()`;
}

// Runs once per window to expose whether mods are present, without touching them.
export const PROBE_MODS = `(() => {
  const registry = window.${MOD_STATE_KEY} ?? {};
  return Object.fromEntries(
    Object.entries(registry).map(([name, state]) => [name, state?.status ?? 'unknown'])
  );
})()`;

// Dispose every mod registered in the page that is not in `keep` (names still on
// disk). Without this, deleting or renaming a mod file leaves its UI and timers
// running in windows that are already open until the app is restarted.
// Returns the names that were retired.
export function retireMissing(keep) {
  return `(() => {
  const keep = new Set(${JSON.stringify(keep)});
  const registry = window.${MOD_STATE_KEY} ?? {};
  const retired = [];
  for (const [name, state] of Object.entries(registry)) {
    if (keep.has(name)) continue;
    try { state?.dispose?.(); } catch (err) { console.warn('dispose failed for', name, err); }
    delete registry[name];
    retired.push(name);
  }
  if (retired.length) window.modkit?.changed?.();
  return retired;
})()`;
}

