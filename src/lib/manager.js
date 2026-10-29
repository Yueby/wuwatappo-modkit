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
//     within three minutes is a no.
// Neither is a defence against a script that runs in the panel window itself: it can send any of these
// requests, remove a plugin (which has no question), or answer its own question. That script already has all
// the app's powers, so this is about mistakes, not about it; the plugins on offer are the registry's,
// reviewed by hand, and not anything a message names. (docs/REGISTRY.md says the same.)

import path from 'node:path';
import { developing } from './devmode.js';
import { InstallDeclined, listMods, removeMod } from './install.js';
import { MOD_DATA_DIR } from './paths.js';
import { REGISTRY_REPO, browse, fetchIndex, getFromRegistry, updateFromRegistry } from './registry.js';

const WINDOW = 'panel';
const ANSWER_WAIT_MS = 3 * 60_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;      // a folder name: no separators, no "..", nothing hidden
const MAX_MESSAGE = 600;

const json = JSON.stringify;
// What went wrong, for a person. The libraries speak English to the command line; the page is read by
// someone who is not at one. What is not known here is passed on, in short, after "原因".
const REASONS = [
  [/could not reach the plugin registry/, '连不上插件仓库，请检查网络后再试。'],
  [/has no index yet/, '插件仓库里还没有发布任何插件。'],
  [/the plugin registry answered \d+/, '插件仓库暂时打不开，请稍后再试。'],
  [/the plugin index is not|not in a format this program knows/, '插件仓库的列表这个版本读不懂，请先更新启动器。'],
  [/no plugin called/, '仓库里没有这个插件。'],
  [/no longer has a plugin/, '仓库里已经没有这个插件了。'],
  [/did not come from the registry/, '这个插件不是从仓库安装的，没法在这里更新。'],
  [/is in use from a dev folder/, '这个插件正在开发模式里用本地文件夹，不能在这里安装、更新或卸载。先在启动器里关掉开发模式。'],
  [/the registry now has/, '仓库里这个插件的版本刚刚变了，与列表里显示的不同，没有安装。请刷新列表后重试。'],
  [/is already installed/, '这个插件已经装过了。'],
  [/does not match its checksum/, '下载的文件和仓库登记的校验值对不上，已丢弃，没有安装。'],
  [/stopped at \d+|bytes, not the/, '下载得不完整，已丢弃，请再试一次。'],
  [/is called ".*", not|is version .*, not|declares something other than the index/, '安装包和仓库登记的信息对不上，没有安装。'],
  [/answered \d+/, '下载失败，服务器返回了错误，请稍后再试。'],
  [/could not find npm/, '这个插件要用 npm 下载附带的组件，但这台电脑上找不到 npm。'],
  [/not a mod: no package\.json|not a valid mod manifest/, '这个安装包的内容不对，没有安装。'],
  [/there is no mod called/, '没有找到这个插件。'],
];

function explain(err) {
  const text = String(err?.message ?? err);
  for (const [pattern, reason] of REASONS) if (pattern.test(text)) return reason;
  return `原因：${short(text)}`;
}

const short = text => (String(text).length > MAX_MESSAGE ? `${String(text).slice(0, MAX_MESSAGE)}…` : String(text));

export class ModManager {
  #modsDir;
  #dataDir;
  #app;
  #log;
  #fetch;
  #repo;
  #tools;
  #devFile;
  #busy = false;
  #asks = new Map();      // request id -> answer(boolean): a confirmation being waited for

  // `app` carries answers to the panel: { evaluate(window, js) }. The injector is one.
  constructor({ modsDir, app, dataDir = MOD_DATA_DIR, log = () => {}, fetch = globalThis.fetch, repo = REGISTRY_REPO, tools, devFile } = {}) {
    this.#modsDir = modsDir;
    this.#dataDir = dataDir;
    this.#app = app;
    this.#log = log;
    this.#fetch = fetch;
    this.#repo = repo;
    this.#tools = tools;
    this.#devFile = devFile;
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
    this.#handle(id, message).catch(err => this.#reply(id, { type: 'error', message: explain(err) }));
    return true;
  }

  async #handle(id, message) {
    const { action } = message;
    if (action === 'browse') {
      const { entries, problems } = await this.#plugins();
      return this.#reply(id, { type: 'result', mods: entries, problems });
    }

    if (!['get', 'update', 'remove'].includes(action)) throw new Error(`unknown request "${action}"`);
    if (this.#busy) throw new Error('另一项操作还没做完，请稍等一下。');
    this.#busy = true;
    try {
      const index = await fetchIndex({ repo: this.#repo, fetch: this.#fetch });
      const result = await this.#run(id, message, index);
      this.#log(`${action} ${message.mod}: ${result.summary}`);
      // The list as it is now, so that the page can draw it again. Not worth failing for: it was done.
      const fresh = await this.#plugins(index).catch(() => null);
      this.#reply(id, { type: 'result', ...result, mods: fresh?.entries ?? null, problems: fresh?.problems ?? [] });
    } finally {
      this.#busy = false;
    }
  }

  // The registry's plugins and where each stands here. In dev mode the ones that are being developed are
  // marked: they come from a folder on this machine, and installing, updating or removing them here would
  // be about a copy that is not the one in use.
  // `index`: the registry's index as it was read for this request, so that the list drawn after an
  // install is made from it and costs no second trip to the network.
  async #plugins(index = null) {
    const { entries, problems } = await browse({ modsDir: this.#modsDir, repo: this.#repo, fetch: this.#fetch, index });
    const beingDeveloped = await this.#developing();
    return { entries: entries.map(entry => ({ ...entry, dev: beingDeveloped.has(entry.id) })), problems };
  }

  #developing() {
    return developing(this.#devFile ? { file: this.#devFile } : {});
  }

  async #run(id, message, index) {
    const target = this.#idOf(message.mod);
    if ((await this.#developing()).has(target)) throw new Error(`${target} is in use from a dev folder`);
    const common = { modsDir: this.#modsDir, repo: this.#repo, fetch: this.#fetch, tools: this.#tools, index };

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
        const before = (await listMods(this.#modsDir)).find(mod => mod.id === target)?.version ?? null;
        const done = await updateFromRegistry(target, { ...common, confirm: info => this.#ask(id, { ...info, before }) });
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
    if (typeof value !== 'string' || !ID.test(value)) throw new Error('插件的名字不对。');
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
