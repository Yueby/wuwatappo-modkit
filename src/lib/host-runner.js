// Runs in a child process of its own: one mod's Node part. Started by HostManager (host.js)
// with fork(), never imported by anything else. It talks to the loader over the IPC channel
// fork() opens, in JSON.
//
// A process rather than a thread or an import, for what a mod written against the npm ecosystem
// needs: a native addon that crashes, or a package that assumes it owns the process (chdir, exit,
// signal handlers), takes down only this mod's part and not the loader and every other mod with
// it; the working directory is the mod's own folder; stopping it is ending the process, so no
// timer or socket it forgot to clean up outlives it (nor, on Windows, a child it started without
// `detached`); and a restart is a fresh module graph, so the files it imports are re-read too.
//
// The mod's file is an ES module whose default export (or `start`) is called with `host`:
//
//   export default async function (host) {
//     host.handle('save', async (text) => { ... });      // called by mod.host.call('save', text)
//     host.provide('size', () => 42);                    // called by other mods: host.call(id, 'size')
//     host.emit('saved', { at: Date.now() });            // heard by mod.host.on('saved', fn)
//     return () => { ... };                              // optional: runs when it stops
//   }
//
// Everything that needs the app or another mod (evaluating in a window, settings, services) is a
// message to the loader, which owns the CDP sessions and knows who is running.

import { format } from 'node:util';
import { pathToFileURL } from 'node:url';

// The loader going away (it exited, or crashed) closes the channel: this process has nothing left
// to serve and must not stay behind. (On Windows it is ended with the loader anyway, as every child
// is; this is for other systems, and costs one line.)
process.on('disconnect', () => process.exit(0));

process.once('message', init => {
  run(init).catch(err => {
    send({ t: 'failed', error: String(err?.stack ?? err) });
  });
});

const send = (message, done) => {
  try {
    process.send(message, done);
  } catch {
    process.exit(0);                       // the channel is closed
  }
};

async function run({ id, dir, dataDir, file, config: initial }) {
  let requestId = 0;
  const waiting = new Map();               // requestId -> { resolve, reject }
  const handlers = new Map();              // name -> fn(arg, { window }): what the mod's own page asks
  const services = new Map();              // name -> fn(arg, { from }): what other mods may ask
  const watchers = [];                     // { key, fn }
  const disposers = [];
  let config = { ...initial };

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
    dir,                      // the mod's own folder (also the working directory)
    dataDir,                  // a folder to keep files in; it exists
    // Written to the loader's output and to the MOD page's log view. So is anything the mod
    // prints with console.log / console.error: the loader reads this process's output.
    log: (...args) => send({ t: 'log', level: 'log', text: format(...args) }),
    warn: (...args) => send({ t: 'log', level: 'warn', text: format(...args) }),
    error: (...args) => send({ t: 'log', level: 'error', text: format(...args) }),

    // Publish the text of a `value` row of the manifest (the same rows mod.live feeds); null clears it.
    live: (key, value) => send({ t: 'live', key, value: value ?? null }),

    // Answer a call from the mod's own page: mod.host.call(name, arg). The return value goes back to it.
    handle(name, fn) {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    },

    // Offer something to other mods, which must name this one in "modkit.requires" to call it:
    // host.call(id, name, arg) from their Node part, mod.call(id, name, arg) from their page.
    provide(name, fn) {
      services.set(name, fn);
      return () => services.delete(name);
    },

    // Call a service of another mod this one requires. Rejects if it is not running.
    call: (mod, name, arg) => request('service-call', { mod, name, arg }),

    // Tell the page: mod.host.on(name, fn). To one window ({ window: 'main' }) or to all.
    emit: (name, arg, { window = null } = {}) => send({ t: 'emit', name, arg, window }),

    // Run JavaScript in a window and get the result back (JSON-able values only).
    evaluate: (window, expression) => request('evaluate', { window, expression }),

    // The mod's settings, the same ones the MOD page shows. get() is immediate: the loader keeps
    // this process up to date. set() goes through the page, so it is stored and reaches every window.
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

  async function answer({ cid, name, arg, window, service, from }) {
    try {
      const fn = (service ? services : handlers).get(name);
      if (!fn) throw new Error(service ? `${id} offers no service "${name}"` : `no handler "${name}" (host.handle('${name}', ...))`);
      const value = await fn(arg, service ? { from } : { window });
      send({ t: 'call-result', cid, ok: true, value: value ?? null });
    } catch (err) {
      send({ t: 'call-result', cid, ok: false, error: String(err?.message ?? err) });
    }
  }

  async function stop() {
    for (const fn of disposers.splice(0).reverse()) {
      try { await fn(); } catch (err) { host.warn('dispose failed:', err?.stack ?? err); }
    }
    send({ t: 'stopped' }, () => process.exit(0));
  }

  process.on('message', message => {
    switch (message.t) {
      case 'call':
        answer(message);
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

  process.chdir(dir);
  const module = await import(pathToFileURL(file).href);
  const start = module.default ?? module.start;
  if (typeof start !== 'function') throw new Error('the Node part must export a function: a default export, or "start"');
  const cleanup = await start(host);
  if (typeof cleanup === 'function') disposers.push(cleanup);
  send({ t: 'ready' });
}
