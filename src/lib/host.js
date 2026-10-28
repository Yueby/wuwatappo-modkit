// A mod's Node part: starting it, stopping it, and carrying messages between it and the pages.
//
// What it is for: things a page cannot do or is not allowed to. Files, sockets without CORS,
// child processes, any package from npm. The mod says where it is in package.json
// ("modkit": { "host": "host.js" }); the code runs in a worker thread (host-worker.js).
//
// It only exists while the loader is resident (`watch`): a one-shot `run` has nothing to keep
// it alive. The pages keep working without it; a call to it fails with a message that says why.
//
// Who decides when it runs: the pages. Every window announces each mod that has a Node part,
// with its master switch and settings, and tells us when either changes. The part runs while the
// switch is on, is stopped when it goes off, and a mod that is deleted or edited is stopped and
// started again. Nothing here reads localStorage; the page is the one place those live.
//
// Messages, page -> here, through the CDP binding HOST_BINDING (JSON text):
//   { t: 'hello',   mod, window, enabled, config }       a window has the mod installed
//   { t: 'enabled', mod, enabled }                       the master switch moved
//   { t: 'config',  mod, key, value }                    a setting moved
//   { t: 'call',    mod, window, name, arg, callId }     mod.host.call(name, arg)
// here -> page, by evaluating in the window (window.modkit.*):
//   hostReply(callId, ok, value)   hostReport(mod, status, error)   fromHost(mod, name, arg)

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { MOD_DATA_DIR } from './paths.js';

// Added to every window by the injector's session. Spelled the same in modkit-registry.js.
export const HOST_BINDING = '__modkitHost';

const WORKER_FILE = new URL('./host-worker.js', import.meta.url);
const STOP_GRACE_MS = 2000;
const BEAT_MS = 2000;       // the pages treat the loader as gone after 3 missed beats (HOST_STALE_MS)
const json = value => JSON.stringify(value ?? null);

export class HostManager {
  #app = null;
  #log;
  #dataDir;
  #mods = new Map();      // id -> the mod record (from discoverMods) that has a Node part
  #hosts = new Map();     // id -> { worker, version, state: starting | ready | failed, queue }
  #wanted = new Map();    // id -> boolean: the master switch, as the pages last said
  #config = new Map();    // id -> { key: value }: the settings, as the pages last said
  #calls = new Map();     // cid -> { host, window, callId }: calls waiting for the worker
  #callSeq = 0;
  #exits = new Map();     // id -> Promise: a worker that is stopping
  #beat = null;

  constructor({ log = () => {}, dataDir = MOD_DATA_DIR } = {}) {
    this.#log = log;
    this.#dataDir = dataDir;
  }

  // `app` is what carries messages to the windows: { evaluate(window|null, js), evaluateAll(js) }.
  // The injector is one; tests use a stand-in.
  connect(app) {
    this.#app = app;
    // The binding outlives the loader, so the pages are told it is still here.
    clearInterval(this.#beat);
    this.#beat = setInterval(() => this.#app?.evaluateAll('window.modkit?.hostBeat?.()'), BEAT_MS);
    this.#beat.unref();
  }

  // Stop beating (the pages notice within seconds) and stop every Node part.
  async close() {
    clearInterval(this.#beat);
    await this.stopAll();
  }

  // What the loader currently knows of mods. Hosts of mods that are gone, or whose files
  // changed, are stopped; the ones that should be running are (re)started.
  setMods(mods) {
    const next = new Map(mods.filter(m => m.hostFile).map(m => [m.name, m]));
    for (const [id, host] of this.#hosts) {
      const mod = next.get(id);
      if (!mod || mod.hostVersion !== host.version) this.#stop(id);
    }
    this.#mods = next;
    for (const id of next.keys()) this.#reconcile(id);
  }

  // A message from a page. `window` is its label.
  onPageMessage(window, text) {
    let message;
    try { message = JSON.parse(text); } catch { return; }
    const id = message?.mod;
    if (typeof id !== 'string') return;

    switch (message.t) {
      case 'hello':
        this.#wanted.set(id, !!message.enabled);
        this.#config.set(id, { ...message.config });
        this.#reconcile(id);
        break;
      case 'enabled':
        this.#wanted.set(id, !!message.enabled);
        this.#reconcile(id);
        break;
      case 'config': {
        // Every window reports a change, so most of these are repeats of the one before.
        const known = this.#config.get(id) ?? {};
        const previous = known[message.key];
        if (Object.is(previous, message.value)) break;
        this.#config.set(id, { ...known, [message.key]: message.value });
        this.#hosts.get(id)?.worker?.postMessage({ t: 'config-change', key: message.key, value: message.value, previous });
        break;
      }
      case 'call':
        this.#call(id, window, message);
        break;
    }
  }

  // Which Node parts are in which state: { id: 'starting' | 'ready' | 'failed' }.
  states() {
    return Object.fromEntries([...this.#hosts].map(([id, host]) => [id, host.state]));
  }

  // The app went away (or we are stopping). Nothing is wanted until a page says so again.
  async stopAll() {
    this.#wanted.clear();
    const stopping = [...this.#hosts.keys()].map(id => this.#stop(id));
    await Promise.all([...stopping, ...this.#exits.values()]);
  }

  #reconcile(id) {
    const mod = this.#mods.get(id);
    if (!mod) return;
    const wanted = this.#wanted.get(id);
    const running = this.#hosts.has(id);
    if (wanted === true && !running) this.#start(mod);
    else if (wanted === false && running) this.#stop(id);
  }

  #start(mod) {
    const id = mod.name;
    const host = { worker: null, version: mod.hostVersion, state: 'starting', queue: [] };
    this.#hosts.set(id, host);                // before any await: a second message must not start another

    (async () => {
      await this.#exits.get(id);              // an older copy of it is still stopping
      if (this.#hosts.get(id) !== host) return;

      const dataDir = path.join(this.#dataDir, id);
      fs.mkdirSync(dataDir, { recursive: true });
      // A start is a clean slate for persist:false settings, whether or not there is a page script.
      await this.#app?.evaluate(null, `window.modkit?.resetTransient?.(${json(id)})`).catch(() => {});
      if (this.#hosts.get(id) !== host) return;

      this.#report(id, 'loading');
      const worker = new Worker(WORKER_FILE, {
        workerData: { id, dir: path.dirname(mod.hostFile), dataDir, file: mod.hostFile, config: this.#config.get(id) ?? {} },
      });
      host.worker = worker;
      host.exited = new Promise(resolve => worker.once('exit', resolve));   // also true for one that died already
      worker.on('message', message => this.#fromWorker(id, host, message));
      worker.on('error', err => this.#fail(id, host, String(err?.stack ?? err)));
      worker.on('exit', () => {
        if (this.#hosts.get(id) === host && host.state !== 'failed') this.#fail(id, host, 'the Node part exited by itself');
      });
    })().catch(err => this.#fail(id, host, String(err?.stack ?? err)));
  }

  // Ask it to finish (its dispose hooks run), and kill it if it does not. Resolves when it is gone.
  #stop(id) {
    const host = this.#hosts.get(id);
    if (!host) return this.#exits.get(id) ?? Promise.resolve();
    this.#hosts.delete(id);
    this.#report(id, null);
    this.#app?.evaluate(null, `window.modkit?.clearLive?.(${json(id)})`).catch(() => {});
    this.#failCalls(host, 'the Node part was stopped');

    const worker = host.worker;
    if (!worker) return Promise.resolve();    // still waiting to start; it will see it is not current

    const exited = host.exited;
    this.#exits.set(id, exited);
    exited.then(() => { if (this.#exits.get(id) === exited) this.#exits.delete(id); });
    worker.postMessage({ t: 'stop' });
    const timer = setTimeout(() => worker.terminate(), STOP_GRACE_MS);
    timer.unref();
    exited.then(() => clearTimeout(timer));
    return exited;
  }

  // It crashed or could not start. It stays listed as failed (so it is not restarted in a loop)
  // until its files change or the master switch is turned off and on.
  #fail(id, host, error) {
    if (this.#hosts.get(id) !== host || host.state === 'failed') return;
    host.state = 'failed';
    host.error = error;
    this.#log(`[${id}] Node part failed: ${error.split('\n')[0]}`);
    this.#toLog(id, 'error', `Node 部分出错：${error}`);
    this.#report(id, 'error', `Node 部分出错：${error.split('\n')[0]}`);
    this.#failCalls(host, `the Node part failed: ${error.split('\n')[0]}`);
    host.worker?.terminate();
  }

  #fromWorker(id, host, message) {
    // What it says while it is being stopped (its dispose hook runs after it has been taken off
    // the list) is still worth hearing: that is where "stopped" and cleanup errors are written.
    // Anything that would change state is not: it is no longer the one the pages are talking to.
    if (message.t === 'log') {
      this.#log(`[${id}] ${message.text}`);
      this.#toLog(id, message.level, message.text);
      return;
    }
    if (this.#hosts.get(id) !== host) return;
    const worker = host.worker;

    switch (message.t) {
      case 'ready':
        host.state = 'ready';
        this.#report(id, 'ok');
        this.#log(`[${id}] Node part running`);
        for (const call of host.queue.splice(0)) worker.postMessage(call);
        break;
      case 'failed':
        this.#fail(id, host, message.error);
        break;
      case 'live':
        this.#app?.evaluate(null, `window.modkit.hostLive(${json(id)}, ${json(message.key)}, ${json(message.value)})`)
          .catch(err => this.#toLog(id, 'warn', `host.live(${message.key}): ${String(err?.message ?? err).split('\n')[0]}`));
        break;
      case 'emit': {
        const expression = `window.modkit?.fromHost?.(${json(id)}, ${json(message.name)}, ${json(message.arg)})`;
        if (message.window) this.#app?.evaluate(message.window, expression).catch(() => {});
        else this.#app?.evaluateAll(expression);
        break;
      }
      case 'evaluate':
        this.#answer(worker, message.rid, () => this.#app.evaluate(message.window, message.expression));
        break;
      case 'config-set':
        this.#answer(worker, message.rid,
          () => this.#app.evaluate(null, `window.modkit.setConfig(${json(id)}, ${json(message.key)}, ${json(message.value)})`));
        break;
      case 'call-result': {
        const call = this.#calls.get(message.cid);
        if (!call) break;
        this.#calls.delete(message.cid);
        this.#reply(call.window, call.callId, message.ok, message.ok ? message.value : message.error);
        break;
      }
    }
  }

  // Run something for the worker and send back what came of it.
  async #answer(worker, rid, run) {
    let reply;
    try {
      reply = { t: 'result', rid, ok: true, value: await run() };
    } catch (err) {
      reply = { t: 'result', rid, ok: false, error: String(err?.message ?? err) };
    }
    try { worker.postMessage(reply); } catch { /* the worker is gone */ }
  }

  #call(id, window, message) {
    const host = this.#hosts.get(id);
    if (!host) return this.#reply(window, message.callId, false, 'the Node part is not running (the mod is switched off, or the loader is not in watch mode)');
    if (host.state === 'failed') return this.#reply(window, message.callId, false, `the Node part failed: ${host.error.split('\n')[0]}`);

    const cid = ++this.#callSeq;
    this.#calls.set(cid, { host, window, callId: message.callId });
    const call = { t: 'call', cid, name: message.name, arg: message.arg, window };
    if (host.state === 'ready') host.worker.postMessage(call);
    else host.queue.push(call);               // still starting: delivered when it is ready
  }

  #failCalls(host, reason) {
    for (const [cid, call] of this.#calls) {
      if (call.host !== host) continue;
      this.#calls.delete(cid);
      this.#reply(call.window, call.callId, false, reason);
    }
  }

  #reply(window, callId, ok, value) {
    this.#app?.evaluate(window, `window.modkit?.hostReply?.(${json(callId)}, ${ok ? 'true' : 'false'}, ${json(value)})`).catch(() => {});
  }

  // Into the MOD page's log view. One window records it; the others hear of it over the channel.
  #toLog(id, level, text) {
    this.#app?.evaluate(null, `window.modkit?.logFromHost?.(${json(id)}, ${json(level)}, ${json(text)})`).catch(() => {});
  }

  // What the MOD page shows for this part: loading / ok / error, or nothing once it is stopped.
  #report(id, status, error = null) {
    this.#app?.evaluateAll(`window.modkit?.hostReport?.(${json(id)}, ${json(status)}, ${json(error)})`);
  }
}
