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
//   settings    values declared in package.json ("modkit"). The panel draws them; the mod reads them.
//               Persisted ones live in localStorage, which every window of the app shares
//               (same origin, same profile), and a change in one window reaches the others
//               as a `storage` event. Values marked persist:false are reset whenever the mod
//               starts, so they cannot come back on by themselves after a restart.
//   master      one switch per mod, remembered. Off means the code is not running at all.
//   live        read-only figures and the run state, sent between windows with a
//               BroadcastChannel. Never stored, so a restart cannot leave stale ones behind.
//   entries     rows a mod adds from its own code (mod.entry), for the cases a manifest
//               cannot describe. Only visible if the mod runs in the panel window.
//   logs        what mods write with mod.log / mod.warn (and a Node part with host.log), kept
//               for the MOD page's log view. Each window keeps what it produced and sends it on
//               a channel; the panel collects it. Not stored: a restart starts them empty.
//   host        the line to a mod's Node part (src/lib/host.js), which runs in the loader's
//               process: calls to it, what it sends back, and telling it when the switch or a
//               setting changes. It exists only while the loader is resident.
//
// The registry outlives a reload of this script (`??=`), so what mods already did is not
// lost while the framework is being edited. Methods are always called as kit.x(), never
// through a captured reference, so a reloaded script's versions are the ones that run.

const kit = (window.modkit ??= {});
kit.entries ??= [];
kit.entrySerial ??= 0;       // gives every added row an identity (the page compares them)
kit.mods ??= new Map();       // id -> manifest, for every user mod installed in this window
kit.units ??= new Map();      // id -> this window's installation of it
kit.reports ??= new Map();    // id -> Map(window label -> { status, error }), from every window
kit.live ??= new Map();       // id -> Map(key -> value), from every window
kit.watchers ??= [];          // { id, key, fn }: mods listening for a setting to change
kit.hostCalls ??= new Map();  // callId -> { resolve, reject, timer }: calls to a Node part, unanswered
kit.hostListeners ??= [];     // { id, name, fn }: mod.host.on
kit.callSeq ??= 0;
kit.logs ??= [];              // { id, t, mod, level, source, text, origin }, oldest first, from every window
kit.logIds ??= new Set();
kit.logSeq ??= 0;
kit.instance ??= Math.random().toString(36).slice(2, 8);   // tells this window's log entries from others'
kit.onLog ??= null;           // (entry | undefined): a line arrived, or the list changed
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
  entry.serial = ++kit.entrySerial;
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
      kit.post({ type: 'logs', entries: kit.logs.filter(e => e.origin === kit.instance) });
      break;
    case 'log':
      if (storeLog(message.entry)) kit.onLog?.(message.entry);
      break;
    case 'logs':
      // The reply to a hello: another window's history. Only a change is worth a redraw.
      if ((message.entries ?? []).map(storeLog).some(Boolean)) kit.onLog?.();
      break;
    case 'clear-logs':
      clearLogs();
      kit.onLog?.();
      break;
  }
}

// --- logs -----------------------------------------------------------------------

const LOG_LIMIT = 500;

function storeLog(entry) {
  if (!entry || kit.logIds.has(entry.id)) return false;
  kit.logIds.add(entry.id);
  let i = kit.logs.length;                       // entries from other windows can arrive late
  while (i > 0 && kit.logs[i - 1].t > entry.t) i--;
  kit.logs.splice(i, 0, entry);
  while (kit.logs.length > LOG_LIMIT) kit.logIds.delete(kit.logs.shift().id);
  return true;
}

function clearLogs() {
  kit.logs.length = 0;
  kit.logIds.clear();
}

const formatArg = value => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};

// level: 'log' | 'warn' | 'error'. source: the window it came from, or 'node'.
kit.addLog = (mod, level, source, text) => {
  const entry = {
    id: `${kit.instance}:${++kit.logSeq}`,
    t: Date.now(),
    mod,
    level,
    source,
    text: String(text).slice(0, 2000),
    origin: kit.instance,
  };
  storeLog(entry);
  kit.post({ type: 'log', entry });
  kit.onLog?.(entry);
  return entry;
};

kit.clearLogs = () => {
  clearLogs();
  kit.post({ type: 'clear-logs' });
  kit.onLog?.();
};

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
  const waiting = reports.find(r => r.status === 'waiting');      // its Node part is held back by a mod it requires
  if (waiting) return { status: 'waiting', error: waiting.error };
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
  if (!def) throw new Error(`"${key}" is not a setting of ${id} (declare it under "modkit" in package.json)`);
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
  if (kit.mods.get(id)?.host) kit.toHost({ t: 'config', mod: id, key, value });
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
  // The Node part first: the page script that apply() starts may call it at once, and a call
  // to a part that has not been told it is wanted would fail.
  kit.units.get(id)?.tellHost?.('enabled');
  kit.units.get(id)?.apply();
  kit.changed();
};

// Changes made by another window.
function onStorage(event) {
  if (!event.key?.startsWith('modkit:')) return;
  const [, kind, id] = event.key.split(':');

  if (kind === 'on') {
    kit.units.get(id)?.tellHost?.('enabled');     // before apply(), for the reason in setEnabled()
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

// --- the Node part --------------------------------------------------------------

// Added to this window by the loader's CDP session; spelled the same in src/lib/host.js.
// The function outlives the session that added it (measured), so its being there does not mean
// the loader is: the loader says so every few seconds (hostBeat), and a call is only made while
// that was recent. Otherwise it would wait out its timeout for nobody.
const HOST_BINDING = '__modkitHost';
const HOST_CALL_TIMEOUT_MS = 30_000;
const HOST_STALE_MS = 6_000;

kit.resetTransient = resetTransient;

kit.hostBeat = () => { kit.hostSeen = Date.now(); };
kit.hostAlive = () => typeof window[HOST_BINDING] === 'function' && Date.now() - (kit.hostSeen ?? 0) < HOST_STALE_MS;

kit.toHost = message => {
  if (typeof window[HOST_BINDING] !== 'function') return false;
  try {
    window[HOST_BINDING](JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

// mod.host.call(): resolves with what the handler returned, rejects with its message.
// With `target`, a service of another mod (mod.call) rather than this mod's own part.
kit.hostCall = (id, name, arg, label, target) => new Promise((resolve, reject) => {
  const callId = `${id}#${++kit.callSeq}`;
  const timer = setTimeout(() => {
    kit.hostCalls.delete(callId);
    reject(new Error(`the Node part did not answer "${name}" in ${HOST_CALL_TIMEOUT_MS / 1000} s`));
  }, HOST_CALL_TIMEOUT_MS);
  kit.hostCalls.set(callId, { resolve, reject, timer });

  if (!kit.hostAlive() || !kit.toHost({ t: 'call', mod: id, window: label, target, name, arg, callId })) {
    clearTimeout(timer);
    kit.hostCalls.delete(callId);
    reject(new Error('the Node part is not running (the loader only runs it while "watch" is running)'));
  }
});

// The loader's answer, evaluated in this window.
kit.hostReply = (callId, ok, value) => {
  const call = kit.hostCalls.get(callId);
  if (!call) return;
  kit.hostCalls.delete(callId);
  clearTimeout(call.timer);
  if (ok) call.resolve(value);
  else call.reject(new Error(String(value)));
};

// --- plugins: the registry's list, install, update, remove -------------------------------------
//
// The MOD page asks the loader (src/lib/manager.js, which only believes the panel window). One request is
// one promise, `done`; an install or an update stops half way to say what the package declares
// (`onConfirm(info)`), and nothing is put in place until `kit.manageAnswer(id, true)`.
const MANAGE_TIMEOUT_MS = 5 * 60_000;
const MANAGE_ACK_MS = 4_000;       // a loader that has this feature answers at once; an older one never does
const manageCalls = new Map();

kit.manage = (action, args = {}, { onConfirm } = {}) => {
  const id = `m${Date.now().toString(36)}-${++kit.callSeq}`;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manageCalls.delete(id);
      clearTimeout(ackTimer);
      reject(new Error('等了很久，加载器还是没有回应。'));
    }, MANAGE_TIMEOUT_MS);
    const ackTimer = setTimeout(() => {
      manageCalls.delete(id);
      clearTimeout(timer);
      reject(new Error('加载器没有回应。它可能是旧版本，请在启动器里点一次“安装”，把它换成新的。'));
    }, MANAGE_ACK_MS);
    manageCalls.set(id, { resolve, reject, onConfirm, timer, ackTimer });
    if (!kit.hostAlive() || !kit.toHost({ t: 'manage', id, action, ...args })) {
      clearTimeout(timer);
      clearTimeout(ackTimer);
      manageCalls.delete(id);
      reject(new Error('加载器没有在运行，安装、更新、卸载都要靠它。请先在启动器里点“安装”，之后它会随软件一起启动。'));
    }
  });
  return { id, done };
};

kit.manageAnswer = (id, ok) => kit.toHost({ t: 'manage', id, action: 'answer', ok: ok === true });

// The loader's word on a request, evaluated in this window.
kit.manageReply = (id, event) => {
  const call = manageCalls.get(id);
  if (!call) return;
  clearTimeout(call.ackTimer);
  if (event.type === 'ack') return;
  if (event.type === 'confirm') {
    try { call.onConfirm?.(event.info); } catch (err) { console.warn('[modkit] onConfirm threw', err); }
    return;
  }
  manageCalls.delete(id);
  clearTimeout(call.timer);
  if (event.type === 'error') call.reject(new Error(event.message));
  else call.resolve(event);
};

// The Node part says something: mod.host.on(name, fn).
kit.fromHost = (id, name, arg) => {
  for (const listener of [...kit.hostListeners]) {
    if (listener.id !== id || listener.name !== name) continue;
    try {
      listener.fn(arg);
    } catch (err) {
      console.warn(`[${id}] host.on(${name}) threw`, err);
    }
  }
};

// What the Node part writes with host.log / host.warn: one window records it, the rest hear of it.
kit.logFromHost = (id, level, text) => kit.addLog(id, level, 'node', text);

// host.live(key, value): the same figures mod.live publishes, from the Node part.
kit.hostLive = (id, key, value) => {
  const def = kit.mods.get(id)?.settings.find(s => s.key === key && s.type === 'value');
  if (!def) throw new Error(`"${key}" is not a value row of ${id} (declare it under "modkit" in package.json)`);
  kit.setLive(id, key, value);
};

// Its figures are not meaningful once it has stopped.
kit.clearLive = id => {
  for (const key of [...(kit.live.get(id)?.keys() ?? [])]) kit.setLive(id, key, null);
};

// How the Node part is doing, shown on the MOD page like any window's state. null clears it.
kit.hostReport = (id, status, error) => {
  if (status == null) kit.reports.get(id)?.delete('host');
  else setReport(id, 'host', { status, error });
  kit.changed();
};

// The loader has just started watching: every mod with a Node part says where it stands.
kit.hostHello = () => {
  for (const unit of kit.units.values()) unit.tellHost?.('hello');
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
  const unit = { live: new Map(), apply, announce, tellHost };
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
    for (const [key, value] of unit.live) kit.post({ type: 'live', id, key, value });
    if (!run && !loadError) return;
    kit.post({ type: 'status', id, window: label, status: record.status, error: record.error });
  }

  // Tell the loader where this mod stands: the master switch and the settings (hello, which every
  // window sends and the loader sorts out), or only the switch. Every mod does, not only those with
  // a Node part: a mod that another requires is waited for until its switch is known.
  function tellHost(kind) {
    if (kind === 'enabled') {
      kit.toHost({ t: 'enabled', mod: id, enabled: kit.isEnabled(id) });
      return;
    }
    const config = Object.fromEntries(manifest.settings
      .filter(s => s.type !== 'value')
      .map(s => [s.key, kit.getConfig(id, s.key)]));
    kit.toHost({ t: 'hello', mod: id, window: label, enabled: kit.isEnabled(id), config });
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
      kit.addLog(id, 'error', label, `出错：${formatArg(err)}`);
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
      log: (...args) => { console.log(`[${id}]`, ...args); kit.addLog(id, 'log', label, args.map(formatArg).join(' ')); },
      warn: (...args) => { console.warn(`[${id}]`, ...args); kit.addLog(id, 'warn', label, args.map(formatArg).join(' ')); },
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

      // Settings declared in package.json. Reading and writing is by key; a key that is not
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
        if (!def) throw new Error(`"${key}" is not a value row of ${id} (declare it under "modkit" in package.json)`);
        kit.setLive(id, key, value);
      },

      // The mod's Node part ("modkit.host" in package.json), which runs in the loader's process.
      //   call(name, arg)  asks it something; resolves with its answer, rejects with its error
      //   on(name, fn)     hears what it sends with host.emit(name, arg)
      // A service another mod offers with host.provide (this mod must list it in "modkit.requires").
      call: (target, name, arg) => kit.hostCall(id, name, arg, label, target),

      host: {
        call(name, arg) {
          if (!manifest.host) return Promise.reject(new Error(`${id} has no Node part (set "modkit.host" in package.json)`));
          return kit.hostCall(id, name, arg, label);
        },
        on(name, fn) {
          const listener = { id, name, fn };
          kit.hostListeners.push(listener);
          const remove = () => {
            const i = kit.hostListeners.indexOf(listener);
            if (i >= 0) kit.hostListeners.splice(i, 1);
          };
          onDispose(remove);
          return remove;
        },
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
  tellHost('hello');

  if (loadError) {
    kit.addLog(id, 'error', label, `没能加载：${loadError}`);
    report('error', loadError);
  }
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
