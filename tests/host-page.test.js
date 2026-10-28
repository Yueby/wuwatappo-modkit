// The page's half of the Node part, using the real framework script (src/runtime/modkit-registry.js)
// in a vm context standing in for a window, wired to a real HostManager and real worker threads.
// Page -> Node goes through the same binding function the app's windows get; Node -> page is
// evaluated in the context. No app, no DevTools.   node --test tests/host-page.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { HostManager } from '../src/lib/host.js';
import { discoverCore, discoverMods, unitFor } from '../src/lib/mods.js';
import { compileCore, compileMod } from '../src/lib/page-scripts.js';
import { until, write } from './app-helpers.js';

let root;
let manager;
let page;           // the vm context standing in for the window

// A window as far as the framework is concerned: storage, a channel to other windows, the Tauri
// bridge (not used here), and the binding the loader adds.
function makeWindow() {
  const store = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, BroadcastChannel,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    addEventListener() {}, removeEventListener() {},
    __TAURI_INTERNALS__: { invoke: async () => {}, transformCallback: () => 1 },
  };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

const run = code => vm.runInContext(code, page);
// Objects made inside the context have another realm's prototypes; compare them as data.
const plain = value => JSON.parse(JSON.stringify(value ?? null));

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-hostpage-'));

  await write(path.join(root, 'mods', 'chat', 'package.json'), JSON.stringify({
    type: 'module',
    displayName: 'Chat',
    modkit: {
      host: 'host.js',
      windows: { main: 'main.js' },
      settings: [
        { key: 'n', type: 'number', title: 'N', default: 5, min: 0, max: 99 },
        { key: 'shown', type: 'value', title: 'Shown', default: '-' },
      ],
    },
  }));
  await write(path.join(root, 'mods', 'chat', 'host.js'), `export default function (host) {
    host.handle('speak', () => {
      host.log('from node', { n: 1 });
      host.warn('careful');
      host.live('shown', 'published by node');
      return 'ok';
    });
    host.handle('double', n => n * 2);
    host.handle('ping', () => { host.emit('pong', { n: host.config.get('n') }); return 'sent'; });
    host.handle('n', () => host.config.get('n'));
    host.handle('boom', () => { throw new Error('host says no'); });
  }`);
  // The page script uses the Node part as soon as it runs; the part is still starting then.
  await write(path.join(root, 'mods', 'chat', 'main.js'), `
    window.__heard = [];
    mod.log('hello', { a: 1 });
    mod.warn('hmm');
    mod.host.on('pong', value => window.__heard.push(value));
    window.__doubled = await mod.host.call('double', 21);
    window.__call = (name, arg) => mod.host.call(name, arg);
  `);

  await write(path.join(root, 'mods', 'plain.js'), `window.__plain = () => mod.host.call('x');`);

  page = makeWindow();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect({
    evaluate: async (window, expression) => run(expression),
    evaluateAll: async expression => { try { await run(expression); } catch { /* a window may be gone */ } },
  });
  page.__modkitHost = text => manager.onPageMessage('main', text);   // what the loader's session adds

  const core = (await discoverCore()).find(s => s.name === '@core/modkit-registry');
  assert.equal(await run(compileCore(core)).then(r => r.status), 'ok');
  run('window.modkit.hostBeat()');                 // what the loader's injection says before it installs a mod

  const mods = await discoverMods(path.join(root, 'mods'));
  manager.setMods(mods);
  for (const mod of mods) {
    const report = await run(compileMod(unitFor(mod, 'main'), 'main'));
    assert.equal(report.status === 'error', false, `${mod.name}: ${report.error}`);
  }
});

after(async () => {
  await manager?.close();
  run(`window.modkit?.channel?.close(); window.__wuwaMods?.['@core/modkit-registry']?.dispose?.()`);
  await fs.rm(root, { recursive: true, force: true });
});

test('a page script can call its Node part while it is still starting, and gets the answer', async () => {
  assert.equal(run('window.__doubled'), 42);
  assert.deepEqual(manager.states(), { chat: 'ready' });
});

test('the MOD page is told how the Node part is doing, like any window', async () => {
  assert.deepEqual(plain(run(`modkit.stateOf('chat')`)), { status: 'ok' });
});

test('the Node part can send to the page, and reads the same settings', async () => {
  assert.equal(await run(`window.__call('ping')`), 'sent');
  await until('heard', () => run('window.__heard.length') === 1);
  assert.deepEqual(plain(run('window.__heard[0]')), { n: 5 });
});

test('a setting changed on the page reaches the Node part', async () => {
  run(`modkit.setConfig('chat', 'n', 8)`);
  await until('node part sees 8', async () => (await run(`window.__call('n')`)) === 8);

  run(`modkit.setConfig('chat', 'n', 999)`);                 // clamped by the page, as ever
  await until('and the clamped value', async () => (await run(`window.__call('n')`)) === 99);
});

test('an error in a handler comes back as a rejection with its message', async () => {
  await assert.rejects(run(`window.__call('boom')`), /host says no/);
  await assert.rejects(run(`window.__call('nope')`), /no handler "nope"/);
});

test('a mod that declared no Node part cannot call one, and says so', async () => {
  await assert.rejects(run(`window.__plain()`), /has no Node part/);
});

test('switching the mod off stops its Node part, and a call then fails with the reason', async () => {
  run(`modkit.setEnabled('chat', false)`);
  await until('stopped', () => Object.keys(manager.states()).length === 0);
  await assert.rejects(run(`modkit.hostCall('chat', 'double', 1, 'main')`), /not running/);

  assert.equal(run(`modkit.live.get('chat')?.get('shown') ?? null`), null, 'what it published is withdrawn with it');

  run(`modkit.setEnabled('chat', true)`);
  await until('running again', () => manager.states().chat === 'ready');
  assert.equal(await run(`modkit.hostCall('chat', 'double', 4, 'main')`), 8);
});

test('without the loader there is no binding, and a call fails at once with how to fix it', async () => {
  const binding = page.__modkitHost;
  delete page.__modkitHost;
  try {
    await assert.rejects(run(`modkit.hostCall('chat', 'double', 1, 'main')`), /only runs it while "watch" is running/);
  } finally {
    page.__modkitHost = binding;
  }
});

test('the binding outlives the loader, so a call made after it went fails at once instead of waiting', async () => {
  // Nothing beats any more (the loader is gone) but the function is still there.
  run('modkit.hostSeen = Date.now() - 60_000');
  assert.equal(typeof page.__modkitHost, 'function');
  const began = Date.now();
  await assert.rejects(run(`modkit.hostCall('chat', 'double', 1, 'main')`), /not running/);
  assert.ok(Date.now() - began < 500, 'at once, not after the 30 s timeout');
  run('modkit.hostBeat()');
});

const logs = () => plain(run('modkit.logs'));

test('what a mod logs is kept for the MOD page, with its mod, level and window', () => {
  // Once per start of the script: the mod was switched off and on in an earlier test, so twice.
  const mine = logs().filter(e => e.mod === 'chat' && e.source === 'main');
  const pair = [['log', 'hello {"a":1}'], ['warn', 'hmm']];
  assert.deepEqual(mine.map(e => [e.level, e.text]), [...pair, ...pair]);
  assert.ok(mine.every(e => typeof e.t === 'number' && e.id));
});

test('what the Node part logs lands there too, marked as coming from node; its figures are published', async () => {
  assert.equal(await run(`window.__call('speak')`), 'ok');
  await until('node lines recorded', () => logs().filter(e => e.source === 'node').length === 2);
  assert.deepEqual(
    logs().filter(e => e.source === 'node').map(e => [e.mod, e.level, e.text]),
    [['chat', 'log', 'from node { n: 1 }'], ['chat', 'warn', 'careful']],
  );
  await until('figure published', () => run(`modkit.live.get('chat')?.get('shown')`) === 'published by node');
});

test('another window\'s history merges in time order, repeats are ignored, and clearing reaches everyone', async () => {
  const other = new BroadcastChannel('modkit');
  const heard = [];
  other.onmessage = event => heard.push(event.data);
  try {
    const now = Date.now();
    const entry = (id, t, text) => ({ id, t, mod: 'chat', level: 'log', source: 'panel', text, origin: 'elsewhere' });

    // Arrives late, so it belongs before what is already there.
    other.postMessage({ type: 'logs', entries: [entry('e:2', now - 5000, 'second'), entry('e:1', now - 6000, 'first')] });
    await until('merged', () => logs().some(e => e.id === 'e:1'));
    other.postMessage({ type: 'log', entry: entry('e:2', now - 5000, 'second') });         // a repeat
    other.postMessage({ type: 'logs', entries: [entry('e:1', now - 6000, 'first')] });     // and another
    await new Promise(resolve => setTimeout(resolve, 50));

    const all = logs();
    assert.equal(all.filter(e => e.id === 'e:2').length, 1, 'no duplicates');
    assert.deepEqual(all.map(e => e.t), [...all.map(e => e.t)].sort((a, b) => a - b), 'in time order');
    assert.ok(all.findIndex(e => e.id === 'e:1') < all.findIndex(e => e.text === 'hello {"a":1}'), 'earlier lines come first');

    // A window that opens asks everyone to say what they have; ours replies with its own lines only.
    heard.length = 0;
    other.postMessage({ type: 'hello' });
    const reply = await until('history sent', () => heard.find(m => m.type === 'logs'));
    assert.ok(reply.entries.length >= 4 && reply.entries.every(e => e.origin !== 'elsewhere'));

    other.postMessage({ type: 'clear-logs' });
    await until('cleared', () => logs().length === 0);
  } finally {
    other.close();
  }
});

test('the log keeps the most recent 500 lines', () => {
  run(`for (let i = 0; i < 520; i++) modkit.addLog('chat', 'log', 'main', 'line ' + i)`);
  const kept = logs();
  assert.equal(kept.length, 500);
  assert.equal(kept.at(-1).text, 'line 519');
  assert.equal(kept[0].text, 'line 20');
  run('modkit.clearLogs()');
  assert.equal(logs().length, 0);
});

test('a listener is removed with the mod, so a reloaded mod does not hear twice', async () => {
  assert.equal(run('modkit.hostListeners.length'), 1);
  run(`window.__wuwaMods['chat'].dispose()`);
  assert.equal(run('modkit.hostListeners.length'), 0);
});
