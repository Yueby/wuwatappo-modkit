// A mod's Node part: starting it, stopping it, and carrying messages between it and the pages and
// between mods.
//
// What it is for: everything a page cannot do or is not allowed to. Files, sockets without CORS,
// child processes, native addons, any package from npm. The mod says where it is in package.json
// ("modkit": { "host": "host.js" }); the code runs in a child process of its own (host-runner.js).
//
// It only exists while the loader is resident (`watch` / `start`): a one-shot `run` has nothing to
// keep it alive. The pages keep working without it; a call to it fails with a message that says why.
//
// Who decides when it runs: the pages, and the mods it needs. Every window announces each mod with
// its master switch and settings, and tells us when either changes. A part runs while its switch is
// on and every mod it lists in "modkit.requires" is up (a Node part of theirs is ready); it is
// stopped when the switch goes off or something it needs stops, and started again when that is
// right again. A mod that is deleted or edited is stopped and started again. Nothing here reads
// localStorage; the page is the one place those live.
//
// Messages, page -> here, through the CDP binding HOST_BINDING (JSON text):
//   { t: 'hello',   mod, window, enabled, config }       a window has the mod installed
//   { t: 'enabled', mod, enabled }                       the master switch moved
//   { t: 'config',  mod, key, value }                    a setting moved
//   { t: 'call',    mod, window, name, arg, callId }     mod.host.call(name, arg)
//   { t: 'call',    mod, window, target, name, arg, callId }   mod.call(target, name, arg): a service
// here -> page, by evaluating in the window (window.modkit.*):
//   hostReply(callId, ok, value)   hostReport(mod, status, error)   fromHost(mod, name, arg)

import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as sea from 'node:sea';
import { fileURLToPath } from 'node:url';
import { MOD_DATA_DIR } from './paths.js';

// Added to every window by the injector's session. Spelled the same in modkit-registry.js.
export const HOST_BINDING = '__modkitHost';

// How a Node part is started. From the repository: node, on the file that calls runHost(). Packaged:
// the program itself, which is told by its environment that this time it is the runner (the argument
// fork() needs is never looked at). A packaged program also silences Node's own warnings in the child:
// importing a mod's file uses an experimental loader that would otherwise write one to the log.
function forkRunner(options) {
  if (sea.isSea()) {
    return fork('modkit-host-runner', [], { ...options, env: { ...process.env, MODKIT_ROLE: 'host-runner', NODE_NO_WARNINGS: '1' } });
  }
  return fork(fileURLToPath(new URL('../host-runner-main.js', import.meta.url)), [], options);
}
const STOP_GRACE_MS = 2000;
const BEAT_MS = 2000;       // the pages treat the loader as gone after 3 missed beats (HOST_STALE_MS)
const TAIL_CHARS = 2000;    // how much of what a failing process printed is kept to explain it
const json = value => JSON.stringify(value ?? null);

// End a process that did not stop when asked. What it started goes with it: on Windows libuv puts
// every child that is not `detached` in a job object that closes with its parent, whether the
// parent exits or is killed (measured: a grandchild was gone within 1.5 s of either). A mod that
// starts something with { detached: true } is choosing to have it outlive it.
function kill(proc) {
  if (proc.exitCode === null && proc.signalCode === null) proc.kill();
}

// Whole lines of a stream, as they complete.
function onLines(stream, handle) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    rest += chunk;
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines) if (line.trim()) handle(line);
  });
  stream.on('end', () => { if (rest.trim()) handle(rest); });
}

export class HostManager {
  #app = null;
  #log;
  #dataDir;
  #known = new Map();     // id -> every mod record, for who requires whom
  #mods = new Map();      // id -> the mod records that have a Node part
  #hosts = new Map();     // id -> { proc, version, state: starting | ready | failed, queue, ... }
  #wanted = new Map();    // id -> boolean: the master switch, as the pages last said
  #config = new Map();    // id -> { key: value }: the settings, as the pages last said
  #calls = new Map();     // cid -> { host, answer(ok, value) }: calls waiting for a process
  #callSeq = 0;
  #exits = new Map();     // id -> Promise: a process that is stopping
  #waiting = new Map();   // id -> text: shown as waiting on the page, and for what
  #settling = false;
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

  // What the loader currently knows of mods. Parts of mods that are gone, or whose files changed,
  // are stopped; the ones that should be running are (re)started.
  setMods(mods) {
    const next = new Map(mods.filter(m => m.hostFile && !m.loadError).map(m => [m.name, m]));
    for (const [id, host] of this.#hosts) {
      const mod = next.get(id);
      if (!mod || mod.hostVersion !== host.version) this.#stop(id);
    }
    this.#known = new Map(mods.map(m => [m.name, m]));
    this.#mods = next;
    this.#settle();
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
        this.#reconcile(id);        // now: the page's script may call its part in the next breath
        this.#settle();             // and what depends on it, once the burst of hellos is over
        break;
      case 'enabled':
        this.#wanted.set(id, !!message.enabled);
        this.#reconcile(id);
        this.#settle();
        break;
      case 'config': {
        // Every window reports a change, so most of these are repeats of the one before.
        const known = this.#config.get(id) ?? {};
        const previous = known[message.key];
        if (Object.is(previous, message.value)) break;
        this.#config.set(id, { ...known, [message.key]: message.value });
        this.#post(this.#hosts.get(id), { t: 'config-change', key: message.key, value: message.value, previous });
        break;
      }
      case 'call':
        this.#pageCall(id, window, message);
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

  // --- who runs ---------------------------------------------------------------------

  // Bring every part in line with the switches and with each other. Done on the next turn, so that
  // a burst of messages (every window says hello) is one pass, and so that a stop that makes
  // another part stop does not recurse.
  #settle() {
    if (this.#settling) return;
    this.#settling = true;
    queueMicrotask(() => {
      this.#settling = false;
      for (const id of this.#mods.keys()) this.#reconcile(id);
    });
  }

  // Why this part cannot run now, or null: something it requires is missing, off, or not up.
  #blockedBy(mod) {
    for (const dependency of Object.keys(mod.requires ?? {})) {
      const record = this.#known.get(dependency);
      if (!record || record.loadError) return `${dependency} 没有装好`;
      if (this.#wanted.get(dependency) === false) return `${dependency} 已关闭`;
      if (record.hostFile) {
        if (this.#hosts.get(dependency)?.state !== 'ready') return `${dependency} 还没运行`;
      } else if (this.#wanted.get(dependency) === undefined) {
        return `${dependency} 还没有加载`;
      }
    }
    return null;
  }

  #reconcile(id) {
    const mod = this.#mods.get(id);
    if (!mod) return;
    const wanted = this.#wanted.get(id);
    const running = this.#hosts.has(id);
    const blocked = wanted === true ? this.#blockedBy(mod) : null;

    if (wanted === true && !blocked) {
      if (!running) this.#start(mod);
    } else if (running && (wanted === false || blocked)) {
      this.#stop(id);
    }

    // Say on the page what it is waiting for (and take it back when it is not).
    const text = blocked ? `等待：${blocked}` : null;
    if (text !== (this.#waiting.get(id) ?? null)) {
      if (text) this.#waiting.set(id, text);
      else this.#waiting.delete(id);
      if (text) this.#report(id, 'waiting', text);
      else if (!this.#hosts.has(id)) this.#report(id, null);
    }
  }

  #start(mod) {
    const id = mod.name;
    const host = { proc: null, version: mod.hostVersion, state: 'starting', queue: [], error: null, stderr: '' };
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
      const dir = path.dirname(mod.hostFile);
      const proc = forkRunner({
        cwd: dir,
        execArgv: [],                          // not whatever the loader was started with (--test, --inspect, ...)
        serialization: 'json',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      });
      host.proc = proc;
      host.exited = new Promise(resolve => proc.once('close', resolve));   // also true for one that died already

      // What it prints is its log, and what it prints when it dies is why.
      onLines(proc.stdout, line => this.#output(id, 'log', line));
      onLines(proc.stderr, line => {
        host.stderr = (host.stderr + line + '\n').slice(-TAIL_CHARS);
        this.#output(id, 'warn', line);
      });
      proc.on('message', message => this.#fromProcess(id, host, message));
      proc.on('error', err => this.#fail(id, host, String(err?.stack ?? err)));
      proc.on('close', (code, signal) => {
        if (this.#hosts.get(id) !== host || host.state === 'failed') return;
        const how = signal ? `signal ${signal}` : `code ${code}`;
        // What it printed on the way down is the reason; the first line is what the page shows, so
        // the line that names the error goes there and the rest follows.
        const reason = host.stderr.match(/^.*\b\w*(?:Error|Exception)\b.*$/m)?.[0].trim()
          ?? host.stderr.trim().split('\n').at(-1) ?? '';
        this.#fail(id, host, `the Node part exited by itself (${how})${reason ? `: ${reason}` : ''}${host.stderr ? `\n${host.stderr.trim()}` : ''}`);
      });

      proc.send({ t: 'init', id, dir, dataDir, file: mod.hostFile, config: this.#config.get(id) ?? {} }, () => {});
    })().catch(err => this.#fail(id, host, String(err?.stack ?? err)));
  }

  // Ask it to finish (its dispose hooks run), and kill it if it does not. Resolves when it is gone.
  #stop(id) {
    const host = this.#hosts.get(id);
    if (!host) return this.#exits.get(id) ?? Promise.resolve();
    this.#hosts.delete(id);
    this.#report(id, null);
    this.#waiting.delete(id);
    this.#app?.evaluate(null, `window.modkit?.clearLive?.(${json(id)})`).catch(() => {});
    this.#failCalls(host, 'the Node part was stopped');
    this.#settle();                            // whatever needed it must stop too

    const proc = host.proc;
    if (!proc) return Promise.resolve();       // still waiting to start; it will see it is not current

    const exited = host.exited;
    this.#exits.set(id, exited);
    exited.then(() => { if (this.#exits.get(id) === exited) this.#exits.delete(id); });
    this.#post(host, { t: 'stop' });
    const timer = setTimeout(() => kill(proc), STOP_GRACE_MS);
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
    const first = error.split('\n')[0];
    this.#log(`[${id}] Node part failed: ${first}`);
    this.#toLog(id, 'error', `Node 部分出错：${error}`);
    this.#report(id, 'error', `Node 部分出错：${first}`);
    this.#failCalls(host, `the Node part failed: ${first}`);
    if (host.proc) kill(host.proc);
    this.#settle();
  }

  // --- messages ---------------------------------------------------------------------

  // To a part's process, if it has one that is listening.
  #post(host, message) {
    try { host?.proc?.send(message, () => {}); } catch { /* it is gone */ }
  }

  #output(id, level, text) {
    this.#log(`[${id}] ${text}`);
    this.#toLog(id, level, text);
  }

  #fromProcess(id, host, message) {
    // What it says while it is being stopped (its dispose hook runs after it has been taken off
    // the list) is still worth hearing: that is where "stopped" and cleanup errors are written.
    // Anything that would change state is not: it is no longer the one the pages are talking to.
    if (message.t === 'log') {
      this.#output(id, message.level, message.text);
      return;
    }
    if (message.t === 'stopped') return;       // it is on its way out; the process exit is what is waited for
    if (this.#hosts.get(id) !== host) return;
    const proc = host.proc;

    switch (message.t) {
      case 'ready':
        host.state = 'ready';
        this.#report(id, 'ok');
        this.#log(`[${id}] Node part running`);
        for (const call of host.queue.splice(0)) this.#post(host, call);
        this.#settle();                        // what was waiting for it can start
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
        this.#answer(proc, message.rid, () => this.#app.evaluate(message.window, message.expression));
        break;
      case 'config-set':
        this.#answer(proc, message.rid,
          () => this.#app.evaluate(null, `window.modkit.setConfig(${json(id)}, ${json(message.key)}, ${json(message.value)})`));
        break;
      case 'service-call':
        this.#serviceCall(id, message.mod, message.name, message.arg, (ok, value) => {
          try { proc.send(ok ? { t: 'result', rid: message.rid, ok, value } : { t: 'result', rid: message.rid, ok, error: value }, () => {}); } catch { /* gone */ }
        });
        break;
      case 'call-result': {
        const call = this.#calls.get(message.cid);
        if (!call) break;
        this.#calls.delete(message.cid);
        call.answer(message.ok, message.ok ? message.value : message.error);
        break;
      }
    }
  }

  // Run something for the process and send back what came of it.
  async #answer(proc, rid, run) {
    let reply;
    try {
      reply = { t: 'result', rid, ok: true, value: await run() };
    } catch (err) {
      reply = { t: 'result', rid, ok: false, error: String(err?.message ?? err) };
    }
    try { proc.send(reply, () => {}); } catch { /* the process is gone */ }
  }

  // --- calls ------------------------------------------------------------------------

  // Hand a call to a part, now or when it is ready. `answer(ok, value)` gets what comes back.
  #deliver(host, call, answer) {
    const cid = ++this.#callSeq;
    this.#calls.set(cid, { host, answer });
    const message = { t: 'call', cid, ...call };
    if (host.state === 'ready') this.#post(host, message);
    else host.queue.push(message);             // still starting: delivered when it is ready
  }

  // A page asks: its own part (mod.host.call), or a service of a mod it requires (mod.call).
  #pageCall(id, window, message) {
    const answer = (ok, value) => this.#reply(window, message.callId, ok, value);
    if (message.target) return this.#serviceCall(id, message.target, message.name, message.arg, answer);

    const host = this.#hosts.get(id);
    if (!host) return answer(false, 'the Node part is not running (the mod is switched off, or the loader is not in watch mode)');
    if (host.state === 'failed') return answer(false, `the Node part failed: ${host.error.split('\n')[0]}`);
    this.#deliver(host, { name: message.name, arg: message.arg, window }, answer);
  }

  // `caller` asks `target` for a service. Only what the caller listed in "modkit.requires".
  #serviceCall(caller, target, name, arg, answer) {
    if (!Object.hasOwn(this.#known.get(caller)?.requires ?? {}, target)) {
      return answer(false, `${caller} does not list ${target} in "modkit.requires", so it may not call it`);
    }
    const host = this.#hosts.get(target);
    if (!host) return answer(false, `${target} is not running (switched off, or it has no Node part, or the loader is not in watch mode)`);
    if (host.state === 'failed') return answer(false, `${target} failed: ${host.error.split('\n')[0]}`);
    this.#deliver(host, { name, arg, service: true, from: caller }, answer);
  }

  #failCalls(host, reason) {
    for (const [cid, call] of this.#calls) {
      if (call.host !== host) continue;
      this.#calls.delete(cid);
      call.answer(false, reason);
    }
  }

  #reply(window, callId, ok, value) {
    this.#app?.evaluate(window, `window.modkit?.hostReply?.(${json(callId)}, ${ok ? 'true' : 'false'}, ${json(value)})`).catch(() => {});
  }

  // Into the MOD page's log view. One window records it; the others hear of it over the channel.
  #toLog(id, level, text) {
    this.#app?.evaluate(null, `window.modkit?.logFromHost?.(${json(id)}, ${json(level)}, ${json(text)})`).catch(() => {});
  }

  // What the MOD page shows for this part: loading / ok / error / waiting, or nothing once it is stopped.
  #report(id, status, error = null) {
    this.#app?.evaluateAll(`window.modkit?.hostReport?.(${json(id)}, ${json(status)}, ${json(error)})`);
  }
}
