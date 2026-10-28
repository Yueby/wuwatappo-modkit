// Framework: everything the mods and the MOD page share. Present in every window.
//
// Not a mod: the loader injects it before any mod runs (see discoverCore in src/lib/mods.js),
// so window.modkit can always be relied on. It sorts ahead of the scripts that draw things
// (panel-tab.js) by file name; keep it that way.
//
// What it holds, and why it lives here and not in each mod:
//
//   install()   the lifecycle of a mod in one window: run it, tear it down, run it again when
//               it is switched back on, keep its `mod` API. Mods are injected into every
//               window (so the panel always knows their manifest) but only run where they
//               have a script.
//   settings    values declared in mod.json. The panel draws them; the mod reads them.
//               Persisted ones live in localStorage, which every window of the app shares
//               (same origin, same profile), and a change in one window reaches the others
//               as a `storage` event. Values marked persist:false are reset whenever the mod
//               starts, so they cannot come back on by themselves after a restart.
//   master      one switch per mod, remembered. Off means the code is not running at all.
//   live        read-only figures and the run state, sent between windows with a
//               BroadcastChannel. Never stored, so a restart cannot leave stale ones behind.
//   entries     rows a mod adds from its own code (mod.entry), for the cases a manifest
//               cannot describe. Only visible if the mod runs in the panel window.
//
// The registry outlives a reload of this script (`??=`), so what mods already did is not
// lost while the framework is being edited. Methods are always called as kit.x(), never
// through a captured reference, so a reloaded script's versions are the ones that run.

const kit = (window.modkit ??= {});
kit.entries ??= [];
kit.mods ??= new Map();       // id -> manifest, for every user mod installed in this window
kit.units ??= new Map();      // id -> this window's installation of it
kit.reports ??= new Map();    // id -> Map(window label -> { status, error }), from every window
kit.live ??= new Map();       // id -> Map(key -> value), from every window
kit.watchers ??= [];          // { id, key, fn }: mods listening for a setting to change
kit.onChange ??= null;        // redraw hook: set by whatever draws the MOD page
kit.onLive ??= null;          // (id, key, value): a live figure moved; cheaper than a redraw

// --- shared plumbing ------------------------------------------------------------

// Called when anything the page shows has changed. A throwing listener must not break the
// mod that triggered the change.
kit.changed = () => {
  try {
    kit.onChange?.();
  } catch (err) {
    console.warn('[modkit]', err);
  }
};

kit.addEntry = entry => {
  kit.entries.push(entry);
  kit.changed();
};

kit.removeEntry = entry => {
  const i = kit.entries.indexOf(entry);
  if (i >= 0) kit.entries.splice(i, 1);
  kit.changed();
};

const channel = new BroadcastChannel('modkit');
kit.post = message => {
  try {
    kit.channel.postMessage(message);
  } catch (err) {
    console.warn('[modkit] post failed', err);
  }
};
kit.channel = channel;
channel.onmessage = event => receive(event.data);
mod.onDispose(() => channel.close());

// Ask every window to say what it is running. The panel does this when it opens, since it
// may have been loaded after the mods announced themselves.
kit.hello = () => kit.post({ type: 'hello' });

function receive(message) {
  switch (message?.type) {
    case 'status':
      setReport(message.id, message.window, { status: message.status, error: message.error });
      kit.changed();
      break;
    case 'gone':
      kit.reports.get(message.id)?.delete(message.window);
      kit.changed();
      break;
    case 'live':
      storeLive(message.id, message.key, message.value);
      kit.onLive?.(message.id, message.key, message.value);
      break;
    case 'hello':
      for (const unit of kit.units.values()) unit.announce();
      break;
  }
}

function setReport(id, window, report) {
  if (!kit.reports.has(id)) kit.reports.set(id, new Map());
  kit.reports.get(id).set(window, report);
}

function storeLive(id, key, value) {
  if (!kit.live.has(id)) kit.live.set(id, new Map());
  if (value == null) kit.live.get(id).delete(key);
  else kit.live.get(id).set(key, value);
}

// What the MOD page should say about a mod overall, from the reports of every window that
// runs some of it: any failure wins, then "still starting", then fine.
kit.stateOf = id => {
  const reports = [...(kit.reports.get(id)?.values() ?? [])];
  const failed = reports.find(r => r.status === 'error');
  if (failed) return { status: 'error', error: failed.error };
  if (reports.some(r => r.status === 'loading')) return { status: 'loading' };
  if (reports.some(r => r.status === 'ok')) return { status: 'ok' };
  return { status: reports.length ? 'off' : 'idle' };
};

// --- settings -------------------------------------------------------------------

// localStorage keys:  modkit:cfg:<id>   persisted values, one JSON object per mod
//                     modkit:tmp:<id>   values of persist:false settings (reset on start)
//                     modkit:on:<id>    '1' / '0', the master switch
const storageKey = (kind, id) => `modkit:${kind}:${id}`;

function readBucket(kind, id) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(kind, id)));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const bucketOf = def => (def.persist === false ? 'tmp' : 'cfg');

function settingDef(id, key) {
  const def = kit.mods.get(id)?.settings.find(s => s.key === key && s.type !== 'value');
  if (!def) throw new Error(`"${key}" is not a setting of ${id} (declare it in mod.json)`);
  return def;
}

// Whatever is stored, the caller gets something valid for the declared type: a hand-edited
// or older value cannot hand a mod a string where it expects a number.
function coerce(def, value) {
  if (def.type === 'toggle') return typeof value === 'boolean' ? value : def.default;
  if (typeof value !== 'number' || !Number.isFinite(value)) return def.default;
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, value));
}

kit.getConfig = (id, key) => {
  const def = settingDef(id, key);
  return coerce(def, readBucket(bucketOf(def), id)[key]);
};

kit.setConfig = (id, key, value) => {
  const def = settingDef(id, key);
  const next = coerce(def, value);
  const previous = kit.getConfig(id, key);
  const kind = bucketOf(def);
  localStorage.setItem(storageKey(kind, id), JSON.stringify({ ...readBucket(kind, id), [key]: next }));
  // The window that writes does not get a storage event, so tell our own listeners here.
  if (!Object.is(next, previous)) notify(id, key, next, previous);
  return next;
};

function notify(id, key, value, previous) {
  for (const watcher of [...kit.watchers]) {
    if (watcher.id !== id || watcher.key !== key) continue;
    try {
      watcher.fn(value, previous);
    } catch (err) {
      console.warn(`[${id}] onChange(${key}) threw`, err);
    }
  }
  kit.changed();
}

function watchConfig(id, key, fn) {
  settingDef(id, key);
  const watcher = { id, key, fn };
  kit.watchers.push(watcher);
  return () => {
    const i = kit.watchers.indexOf(watcher);
    if (i >= 0) kit.watchers.splice(i, 1);
  };
}

// A new start is a clean slate for everything marked persist:false.
function resetTransient(id) {
  for (const def of kit.mods.get(id)?.settings ?? []) {
    if (def.type !== 'value' && def.persist === false) kit.setConfig(id, def.key, def.default);
  }
}

// --- the master switch ----------------------------------------------------------

kit.isEnabled = id => {
  const stored = localStorage.getItem(storageKey('on', id));
  if (stored === '1') return true;
  if (stored === '0') return false;
  return kit.mods.get(id)?.defaultEnabled !== false;
};

kit.setEnabled = (id, enabled) => {
  localStorage.setItem(storageKey('on', id), enabled ? '1' : '0');
  kit.units.get(id)?.apply();
  kit.changed();
};

// Changes made by another window.
function onStorage(event) {
  if (!event.key?.startsWith('modkit:')) return;
  const [, kind, id] = event.key.split(':');

  if (kind === 'on') {
    kit.units.get(id)?.apply();
    kit.changed();
    return;
  }
  if (kind !== 'cfg' && kind !== 'tmp') return;

  const parse = text => { try { return JSON.parse(text) ?? {}; } catch { return {}; } };
  const before = parse(event.oldValue);
  const after = parse(event.newValue);
  for (const def of kit.mods.get(id)?.settings ?? []) {
    if (def.type === 'value' || bucketOf(def) !== kind) continue;
    const next = coerce(def, after[def.key]);
    const previous = coerce(def, before[def.key]);
    if (!Object.is(next, previous)) notify(id, def.key, next, previous);
  }
}
addEventListener('storage', onStorage);
mod.onDispose(() => removeEventListener('storage', onStorage));

// --- live figures ---------------------------------------------------------------

kit.setLive = (id, key, value) => {
  const unit = kit.units.get(id);
  if (value == null) unit?.live.delete(key);
  else unit?.live.set(key, value);
  storeLive(id, key, value);
  kit.post({ type: 'live', id, key, value: value ?? null });
  kit.onLive?.(id, key, value ?? null);
};

// --- installing a mod -----------------------------------------------------------

// `run` is the mod's code as an async function of `mod`, or null when the mod has nothing to
// run in this window (the manifest is still registered: the panel draws settings from it).
// `loadError` marks a mod that could not be read or compiled; it is listed as broken.
kit.install = async ({ id, manifest, version, label, run, loadError }) => {
  const registry = (window.__wuwaMods ??= {});
  const previous = registry[id];
  if (previous && previous.version === version) {
    // Same source: keep whatever the installed copy did, do not run it twice.
    return { status: previous.status === 'error' ? 'error' : 'already-installed' };
  }
  // Source changed while the window was live: tear the old copy down first.
  try { previous?.dispose?.(); } catch (err) { console.warn('dispose failed', err); }

  const record = { status: 'idle', error: null, version, dispose: null };
  const unit = { live: new Map(), apply, announce };
  let session = null;   // the running copy: { disposers, dead }, or null while not running

  function report(status, error = null) {
    record.status = status;
    record.error = error;
    if (run || loadError) {
      setReport(id, label, { status, error });
      kit.post({ type: 'status', id, window: label, status, error });
    }
    kit.changed();
  }

  // Say again what this window knows, for a window that has just opened.
  function announce() {
    if (!run && !loadError) return;
    kit.post({ type: 'status', id, window: label, status: record.status, error: record.error });
    for (const [key, value] of unit.live) kit.post({ type: 'live', id, key, value });
  }

  function teardown() {
    const ending = session;
    session = null;
    if (!ending) return;
    ending.dead = true;
    for (const fn of ending.disposers.splice(0).reverse()) {
      try { fn(); } catch (err) { console.warn(`[${id}] dispose failed`, err); }
    }
    for (const key of [...unit.live.keys()]) kit.setLive(id, key, null);
  }

  async function start() {
    const mine = session = { disposers: [], dead: false };
    resetTransient(id);
    report('loading');
    try {
      await run(buildApi(mine));
      if (session === mine) report('ok');
    } catch (err) {
      console.error(`[${id}] failed`, err);
      // A mod that dies halfway has usually already added a row, a style, a timer. Leaving
      // that behind gives a half-working UI that is harder to diagnose than none.
      if (session === mine) teardown();
      report('error', String(err));
    }
  }

  // Bring the running state in line with the master switch.
  async function apply() {
    if (!run) return;
    if (kit.isEnabled(id)) {
      if (!session) await start();
    } else {
      teardown();
      if (record.status !== 'off') report('off');
    }
  }

  function buildApi(running) {
    const T = window.__TAURI_INTERNALS__;
    // After teardown, anything still being registered (a mod that was awaiting something)
    // is undone at once instead of leaking.
    const onDispose = fn => {
      if (running.dead) fn();
      else running.disposers.push(fn);
      return fn;
    };

    return {
      name: id,
      invoke: (cmd, args) => T.invoke(cmd, args),
      log: (...args) => console.log(`[${id}]`, ...args),
      warn: (...args) => console.warn(`[${id}]`, ...args),
      onDispose,

      css(text) {
        const style = document.createElement('style');
        style.textContent = text;
        style.dataset.wuwaMod = id;
        (document.head ?? document.documentElement).appendChild(style);
        const remove = () => style.remove();
        onDispose(remove);
        return remove;
      },

      // Settings declared in mod.json. Reading and writing is by key; a key that is not
      // declared throws, so a typo is an error and not a value that is always the default.
      config: {
        get: key => kit.getConfig(id, key),
        set: (key, value) => kit.setConfig(id, key, value),
        // fn(next, previous) runs when the value changes, whichever window changed it.
        onChange(key, fn) {
          const remove = watchConfig(id, key, fn);
          onDispose(remove);
          return remove;
        },
      },

      // Publish a figure for a `value` row of the manifest; null clears it.
      live: (key, value) => {
        const def = kit.mods.get(id)?.settings.find(s => s.key === key && s.type === 'value');
        if (!def) throw new Error(`"${key}" is not a value row of ${id} (declare it in mod.json)`);
        kit.setLive(id, key, value);
      },

      // A row added from code, for what a manifest cannot say. Only drawn when the mod runs
      // in the panel window.
      //   { title, description?, <one control> }, control being one of
      //   toggle / button / number / value / render (see docs/MODDING.md)
      entry(def) {
        const entry = { ...def, owner: id };
        kit.addEntry(entry);
        const remove = () => kit.removeEntry(entry);
        onDispose(remove);
        return remove;
      },

      // The handler is not removed from the backend when the mod stops (there is no handle
      // to do it with here), so it goes quiet instead.
      onEvent: (event, handler) => T.invoke('plugin:event|listen', {
        event,
        target: { kind: 'Any' },
        handler: T.transformCallback(payload => { if (!running.dead) handler(payload); }),
      }),

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
  }

  record.dispose = () => {
    teardown();
    kit.units.delete(id);
    kit.mods.delete(id);
    kit.reports.get(id)?.delete(label);
    kit.post({ type: 'gone', id, window: label });
    kit.changed();
  };

  registry[id] = record;
  kit.mods.set(id, manifest);
  kit.units.set(id, unit);

  if (loadError) report('error', loadError);
  else await apply();

  kit.changed();
  const { status, error } = record;
  return {
    status: status === 'error' ? 'error' : status === 'ok' || status === 'loading' ? 'ok' : status,
    ...(error ? { error } : {}),
  };
};

// Windows that were already open have been running mods since before this script; ask them
// to announce themselves so the page does not start empty.
kit.hello();
