// Generates the JavaScript that is evaluated inside the webview.
//
// Two kinds of script go in, and they are wrapped differently:
//
//   framework (src/runtime/*.js)  compileCore — a minimal wrapper. It has to be minimal: it
//                                 is what installs window.modkit, so it cannot rely on it.
//   user mods                     compileMod — a call to window.modkit.install, which owns
//                                 the lifecycle, the `mod` API, settings and the master
//                                 switch (src/runtime/modkit-registry.js).
//
// This file is source text, not a module the page loads: keep it dependency-free, and keep
// backticks out of comments (the generated code is built from template strings).

export const MOD_STATE_KEY = '__wuwaMods';

// Framework script. `mod` is deliberately small: onDispose, log, warn.
export function compileCore({ name, code, version }) {
  const nameLiteral = JSON.stringify(name);
  const versionLiteral = JSON.stringify(version ?? '0');
  return `(async () => {
  if (!window.__TAURI_INTERNALS__) return { status: 'not-ready' };

  const registry = (window.${MOD_STATE_KEY} ??= {});
  const previous = registry[${nameLiteral}];
  if (previous && previous.version === ${versionLiteral}) {
    return { status: previous.status === 'error' ? 'error' : 'already-installed' };
  }
  if (previous && previous.dispose) {
    try { previous.dispose(); } catch (err) { console.warn('dispose failed', err); }
  }

  const disposers = [];
  const dispose = () => disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch {} });
  registry[${nameLiteral}] = { status: 'installing', version: ${versionLiteral}, dispose };

  const mod = {
    name: ${nameLiteral},
    onDispose(fn) { disposers.push(fn); return fn; },
    log: (...args) => console.log('[' + ${nameLiteral} + ']', ...args),
    warn: (...args) => console.warn('[' + ${nameLiteral} + ']', ...args),
  };

  try {
    await (async () => { ${code}\n })();
    registry[${nameLiteral}] = { status: 'ok', version: ${versionLiteral}, dispose };
    window.modkit?.changed?.();
    return { status: 'ok' };
  } catch (err) {
    try { dispose(); } catch {}
    registry[${nameLiteral}] = { status: 'error', error: String(err), version: ${versionLiteral}, dispose };
    console.error('[' + ${nameLiteral} + '] failed', err);
    return { status: 'error', error: String(err) };
  }
})()`;
}

// A user mod, as one window sees it (see unitFor in mods.js): the manifest, plus the code for
// this window or null when the mod has none here. `loadError` marks a mod that could not be
// loaded at all; the page lists it as broken.
export function compileMod({ name, manifest, code, version, loadError }, label) {
  const spec = { id: name, manifest, version, label, loadError: loadError ?? null };
  const run = code == null ? 'null' : `async mod => {\n${code}\n}`;
  return `(async () => {
  const kit = window.modkit;
  if (!window.__TAURI_INTERNALS__ || typeof kit?.install !== 'function') return { status: 'not-ready' };
  return kit.install({ ...${JSON.stringify(spec)}, run: ${run} });
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
