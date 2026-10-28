// What the MOD page asks of the loader: show the registry's plugins, install one, update one, remove one.
//
// The page cannot touch the disk or the network, so it sends { t: 'manage', id, action, ... } through the
// binding a mod's page uses to reach its Node part, and the loader does it with registry.js and install.js,
// the same code the command line runs. Answers go back into the panel window as
// window.modkit.manageReply(id, event); an event is { type: 'ack' | 'result' | 'error' | 'confirm', ... }.
//
// Two rules keep this from being a way in:
//   * only the panel window is believed. Mods run in the other windows, and a mod there must not be able to
//     install another by sending the same message.
//   * nothing is put in place until the person has seen what it is and said yes: an install or an update
//     sends a `confirm` event with what the package declares, and waits for { action: 'answer' }. No answer
//     within three minutes is a no. A mod in the panel window could still send the answer itself, which is
//     why the plugins on offer are the registry's, reviewed by hand, and not anything a message names.

import path from 'node:path';
import { InstallDeclined, listMods, removeMod } from './install.js';
import { MOD_DATA_DIR } from './paths.js';
import { REGISTRY_REPO, browse, fetchIndex, getFromRegistry, updateFromRegistry } from './registry.js';

const WINDOW = 'panel';
const ANSWER_WAIT_MS = 3 * 60_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;      // a folder name: no separators, no "..", nothing hidden
const MAX_MESSAGE = 600;

const json = JSON.stringify;
const short = text => (String(text).length > MAX_MESSAGE ? `${String(text).slice(0, MAX_MESSAGE)}…` : String(text));

export class ModManager {
  #modsDir;
  #dataDir;
  #app;
  #log;
  #fetch;
  #repo;
  #tools;
  #busy = false;
  #asks = new Map();      // request id -> answer(boolean): a confirmation being waited for

  // `app` carries answers to the panel: { evaluate(window, js) }. The injector is one.
  constructor({ modsDir, app, dataDir = MOD_DATA_DIR, log = () => {}, fetch = globalThis.fetch, repo = REGISTRY_REPO, tools } = {}) {
    this.#modsDir = modsDir;
    this.#dataDir = dataDir;
    this.#app = app;
    this.#log = log;
    this.#fetch = fetch;
    this.#repo = repo;
    this.#tools = tools;
  }

  // True when the message was one of ours (whoever sent it), so nobody else need look at it.
  onPageMessage(window, text) {
    let message;
    try { message = JSON.parse(text); } catch { return false; }
    if (message?.t !== 'manage') return false;
    if (window !== WINDOW) {
      this.#log(`ignored a request to manage mods from the ${window} window`);
      return true;
    }
    const id = message.id;
    if (typeof id !== 'string' || id.length > 100) return true;

    if (message.action === 'answer') {
      this.#asks.get(id)?.(message.ok === true);
      return true;
    }
    this.#reply(id, { type: 'ack' });     // heard: an older loader says nothing, and the page can tell
    this.#handle(id, message).catch(err => this.#reply(id, { type: 'error', message: short(err.message ?? err) }));
    return true;
  }

  async #handle(id, message) {
    const { action } = message;
    if (action === 'browse') {
      const { entries, problems } = await browse({ modsDir: this.#modsDir, repo: this.#repo, fetch: this.#fetch });
      return this.#reply(id, { type: 'result', mods: entries, problems });
    }

    if (!['get', 'update', 'remove'].includes(action)) throw new Error(`unknown request "${action}"`);
    if (this.#busy) throw new Error('另一个安装、更新或卸载还没做完');
    this.#busy = true;
    try {
      const result = await this.#run(id, message);
      this.#log(`${action} ${message.mod}: ${result.summary}`);
      // The list as it is now, so that the page can draw it again. Not worth failing for: it was done.
      const fresh = await browse({ modsDir: this.#modsDir, repo: this.#repo, fetch: this.#fetch }).catch(() => null);
      this.#reply(id, { type: 'result', ...result, mods: fresh?.entries ?? null, problems: fresh?.problems ?? [] });
    } finally {
      this.#busy = false;
    }
  }

  async #run(id, message) {
    const target = this.#idOf(message.mod);
    const common = { modsDir: this.#modsDir, repo: this.#repo, fetch: this.#fetch, tools: this.#tools };

    if (message.action === 'get') {
      try {
        const done = await getFromRegistry(target, { ...common, confirm: info => this.#ask(id, info) });
        return { done: 'installed', id: done.id, version: done.version, summary: `installed ${done.id} ${done.version ?? ''}`.trim() };
      } catch (err) {
        if (err instanceof InstallDeclined) return { done: 'declined', summary: 'declined' };
        throw err;
      }
    }

    if (message.action === 'update') {
      try {
        const index = await fetchIndex({ repo: this.#repo, fetch: this.#fetch });
        const before = (await listMods(this.#modsDir)).find(mod => mod.id === target)?.version ?? null;
        const done = await updateFromRegistry(target, { ...common, index, confirm: info => this.#ask(id, { ...info, before }) });
        if (done.unchanged) return { done: 'current', id: target, version: done.version, summary: `${target} is current` };
        return { done: 'updated', id: target, version: done.version, summary: `updated ${target} to ${done.version ?? '?'}` };
      } catch (err) {
        if (err instanceof InstallDeclined) return { done: 'declined', summary: 'declined' };
        throw err;
      }
    }

    const removed = await removeMod(target, { modsDir: this.#modsDir, dataDir: this.#dataDir, purge: message.purge === true });
    return { done: 'removed', id: target, purged: removed.purged, summary: `removed ${target}${removed.purged ? ' and its data' : ''}` };
  }

  #idOf(value) {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error('不是插件的名字');
    return path.basename(value);
  }

  // Show the page what is about to happen and wait for its answer. No answer is a no.
  #ask(id, info) {
    return new Promise(resolve => {
      const finish = answer => {
        clearTimeout(timer);
        this.#asks.delete(id);
        resolve(answer);
      };
      const timer = setTimeout(() => finish(false), ANSWER_WAIT_MS);
      timer.unref();
      this.#asks.set(id, finish);
      this.#reply(id, { type: 'confirm', info: pick(info) });
    });
  }

  #reply(id, event) {
    const js = `window.modkit?.manageReply?.(${json(id)}, ${json(event)})`;
    return Promise.resolve(this.#app.evaluate(WINDOW, js)).catch(err => this.#log(`could not answer the panel: ${err.message}`));
  }
}

// What the page is shown of a package: the facts it asks about, and nothing else of the entry.
function pick({ id, name, version, description, nodePart, permissions, requires, dependencies, warning, before }) {
  return { id, name, version, description, nodePart, permissions, requires, dependencies, warning: warning ?? null, before: before ?? null };
}
