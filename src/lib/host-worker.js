// Runs inside a worker thread: one mod's Node part. Started by HostManager (host.js), never
// imported by anything else.
//
// It is a thread of its own rather than an import into the loader for two reasons that matter
// to a mod: stopping it is `terminate()`, which also ends every timer, socket and child
// process the mod forgot about; and a restart is a fresh module graph, so the files the mod
// imports are re-read too (a plain `import()` would keep serving them from its cache).
//
// The mod's file is an ES module whose default export (or `start`) is called with `host`:
//
//   export default async function (host) {
//     host.handle('save', async (text) => { ... });      // called by mod.host.call('save', text)
//     host.emit('saved', { at: Date.now() });            // heard by mod.host.on('saved', fn)
//     return () => { ... };                              // optional: runs when it stops
//   }
//
// Everything that needs the app (evaluating in a window, settings) is a message to the loader,
// which owns the CDP sessions.

import { parentPort, workerData } from 'node:worker_threads';
import { format } from 'node:util';
import { pathToFileURL } from 'node:url';

const { id, dir, dataDir, file } = workerData;

let requestId = 0;
const waiting = new Map();        // requestId -> { resolve, reject }
const handlers = new Map();       // name -> fn(arg, { window })
const watchers = [];              // { key, fn }
const disposers = [];
let config = { ...workerData.config };

const send = message => parentPort.postMessage(message);

// Ask the loader for something and wait for its answer.
function request(type, payload) {
  return new Promise((resolve, reject) => {
    const rid = ++requestId;
    waiting.set(rid, { resolve, reject });
    send({ t: type, rid, ...payload });
  });
}

function knownKey(key) {
  if (!Object.hasOwn(config, key)) throw new Error(`"${key}" is not a setting of ${id} (declare it under "modkit" in package.json)`);
}

const host = {
  id,
  dir,                      // the mod's own folder
  dataDir,                  // a folder to keep files in; it exists
  // Written to the loader's output and to the MOD page's log view.
  log: (...args) => send({ t: 'log', level: 'log', text: format(...args) }),
  warn: (...args) => send({ t: 'log', level: 'warn', text: format(...args) }),
  error: (...args) => send({ t: 'log', level: 'error', text: format(...args) }),

  // Publish the text of a `value` row of the manifest (the same rows mod.live feeds); null clears it.
  live: (key, value) => send({ t: 'live', key, value: value ?? null }),

  // Answer a call from the page: mod.host.call(name, arg). The return value goes back to it.
  handle(name, fn) {
    handlers.set(name, fn);
    return () => handlers.delete(name);
  },

  // Tell the page: mod.host.on(name, fn). To one window ({ window: 'main' }) or to all.
  emit: (name, arg, { window = null } = {}) => send({ t: 'emit', name, arg, window }),

  // Run JavaScript in a window and get the result back (JSON-able values only).
  evaluate: (window, expression) => request('evaluate', { window, expression }),

  // The mod's settings, the same ones the MOD page shows. get() is immediate: the loader keeps
  // this thread up to date. set() goes through the page, so it is stored and reaches every window.
  config: {
    get(key) {
      knownKey(key);
      return config[key];
    },
    set(key, value) {
      knownKey(key);
      return request('config-set', { key, value });
    },
    // fn(next, previous), whichever side changed it.
    onChange(key, fn) {
      knownKey(key);
      const watcher = { key, fn };
      watchers.push(watcher);
      return () => { const i = watchers.indexOf(watcher); if (i >= 0) watchers.splice(i, 1); };
    },
  },

  onDispose(fn) {
    disposers.push(fn);
    return fn;
  },
};

async function callHandler({ cid, name, arg, window }) {
  try {
    const fn = handlers.get(name);
    if (!fn) throw new Error(`no handler "${name}" (host.handle('${name}', ...))`);
    const value = await fn(arg, { window });
    send({ t: 'call-result', cid, ok: true, value: value ?? null });
  } catch (err) {
    send({ t: 'call-result', cid, ok: false, error: String(err?.message ?? err) });
  }
}

async function stop() {
  for (const fn of disposers.splice(0).reverse()) {
    try { await fn(); } catch (err) { host.warn('dispose failed:', err?.stack ?? err); }
  }
  send({ t: 'stopped' });
  process.exit(0);
}

parentPort.on('message', message => {
  switch (message.t) {
    case 'call':
      callHandler(message);
      break;
    case 'result': {
      const pending = waiting.get(message.rid);
      waiting.delete(message.rid);
      if (message.ok) pending?.resolve(message.value);
      else pending?.reject(new Error(message.error));
      break;
    }
    case 'config-change': {
      config = { ...config, [message.key]: message.value };
      for (const watcher of [...watchers]) {
        if (watcher.key !== message.key) continue;
        try { watcher.fn(message.value, message.previous); } catch (err) { host.warn(`onChange(${message.key}) threw:`, err?.stack ?? err); }
      }
      break;
    }
    case 'stop':
      stop();
      break;
  }
});

try {
  const module = await import(pathToFileURL(file).href);
  const start = module.default ?? module.start;
  if (typeof start !== 'function') throw new Error('the Node part must export a function: a default export, or "start"');
  const cleanup = await start(host);
  if (typeof cleanup === 'function') disposers.push(cleanup);
  send({ t: 'ready' });
} catch (err) {
  send({ t: 'failed', error: String(err?.stack ?? err) });
}
