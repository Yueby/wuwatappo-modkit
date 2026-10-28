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
      settings: [{ key: 'n', type: 'number', title: 'N', default: 5, min: 0, max: 99 }],
    },
  }));
  await write(path.join(root, 'mods', 'chat', 'host.js'), `export default function (host) {
    host.handle('double', n => n * 2);
    host.handle('ping', () => { host.emit('pong', { n: host.config.get('n') }); return 'sent'; });
    host.handle('n', () => host.config.get('n'));
    host.handle('boom', () => { throw new Error('host says no'); });
  }`);
  // The page script uses the Node part as soon as it runs; the part is still starting then.
  await write(path.join(root, 'mods', 'chat', 'main.js'), `
    window.__heard = [];
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

test('a listener is removed with the mod, so a reloaded mod does not hear twice', async () => {
  assert.equal(run('modkit.hostListeners.length'), 1);
  run(`window.__wuwaMods['chat'].dispose()`);
  assert.equal(run('modkit.hostListeners.length'), 0);
});
