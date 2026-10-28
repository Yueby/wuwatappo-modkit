// A mod's Node part, against a stand-in for the app: real worker threads, real files, no
// windows. What the pages would send is fed in as messages, and what would be evaluated in a
// window is recorded.   node --test tests/host.test.js

import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostManager } from '../src/lib/host.js';
import { discoverMods } from '../src/lib/mods.js';
import { sleep, until, write } from './app-helpers.js';

let root;            // holds mods/ and data/
let manager;
let app;

class FakeApp {
  evaluated = [];                                   // { window, expression }
  async evaluate(window, expression) {
    this.evaluated.push({ window, expression });
    if (expression.includes('setConfig')) return 7;  // what the page would hand back
  }
  async evaluateAll(expression) {
    this.evaluated.push({ window: '*', expression });
  }
  find(text) { return this.evaluated.filter(e => e.expression.includes(text)); }
}

const page = {
  hello: (mod, config = {}, enabled = true) => JSON.stringify({ t: 'hello', mod, window: 'main', enabled, config }),
  enabled: (mod, enabled) => JSON.stringify({ t: 'enabled', mod, enabled }),
  config: (mod, key, value) => JSON.stringify({ t: 'config', mod, key, value }),
  call: (mod, name, arg, callId, window = 'main') => JSON.stringify({ t: 'call', mod, window, name, arg, callId }),
};

// A mod folder with a Node part. `host` is the source of host.js; `extra` other files in it.
async function makeMod(id, host, extra = {}) {
  const dir = path.join(root, 'mods', id);
  await write(path.join(dir, 'package.json'), JSON.stringify({
    type: 'module',                       // host.js is an ES module; without this Node warns on every start
    modkit: {
      host: 'host.js',
      settings: [{ key: 'n', type: 'number', title: 'N', default: 5, min: 0, max: 99 }],
    },
  }));
  await write(path.join(dir, 'host.js'), host);
  for (const [name, text] of Object.entries(extra)) await write(path.join(dir, name), text);
  return dir;
}

const load = () => discoverMods(path.join(root, 'mods'));

// The page's side of a call: send it, then wait for the reply that would be evaluated.
async function call(mod, name, arg, callId = `${mod}#${Math.random()}`) {
  manager.onPageMessage('main', page.call(mod, name, arg, callId));
  const reply = await until(`reply to ${callId}`, () => app.find(`hostReply?.("${callId}"`)[0]);
  const match = reply.expression.match(/hostReply\?\.\(".*?", (true|false), (.*)\)$/s);
  return { ok: match[1] === 'true', value: JSON.parse(match[2]), window: reply.window };
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-host-'));
});

afterEach(async () => {
  await manager?.close();
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function start(id, source, extra, config = {}) {
  await makeMod(id, source, extra);
  app = new FakeApp();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect(app);
  manager.setMods(await load());
  manager.onPageMessage('main', page.hello(id, config));
  await until(`${id} ready`, () => manager.states()[id] === 'ready');
}

test('a Node part starts once its mod is switched on, and says so to the pages', async () => {
  await makeMod('basic', `export default function () {}`);
  app = new FakeApp();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect(app);
  manager.setMods(await load());

  await sleep(100);
  assert.deepEqual(manager.states(), {}, 'nothing starts before a page has said the mod is on');

  manager.onPageMessage('main', page.hello('basic', {}, false));
  await sleep(100);
  assert.deepEqual(manager.states(), {}, 'and not while it is switched off');

  manager.onPageMessage('panel', page.enabled('basic', true));
  await until('ready', () => manager.states().basic === 'ready');
  assert.ok(app.find('resetTransient?.("basic")').length, 'persist:false settings are reset for the new start');
  assert.ok(app.find('hostReport?.("basic", "loading"').length, 'loading was reported');
  assert.ok(app.find('hostReport?.("basic", "ok"').length, 'then ok');
});

test('a call from the page reaches its handler and the answer goes back to the window that asked', async () => {
  await start('echo', `export default function (host) {
    host.handle('echo', (arg, { window }) => ({ got: arg, from: window }));
    host.handle('boom', () => { throw new Error('nope'); });
  }`);

  const ok = await call('echo', 'echo', { a: [1, 2] }, 'c1');
  assert.deepEqual(ok, { ok: true, value: { got: { a: [1, 2] }, from: 'main' }, window: 'main' });

  const failed = await call('echo', 'boom', null, 'c2');
  assert.deepEqual([failed.ok, failed.value], [false, 'nope']);

  const unknown = await call('echo', 'missing', null, 'c3');
  assert.equal(unknown.ok, false);
  assert.match(unknown.value, /no handler "missing"/);

  manager.onPageMessage('panel', page.call('echo', 'echo', 1, 'c4', 'panel'));
  const fromPanel = await until('panel reply', () => app.find('hostReply?.("c4"')[0]);
  assert.equal(fromPanel.window, 'panel', 'answered where it was asked');
});

test('a call made while it is still starting is answered once it is ready', async () => {
  await makeMod('slow', `import { setTimeout as wait } from 'node:timers/promises';
    export default async function (host) { await wait(300); host.handle('hi', () => 'hello'); }`);
  app = new FakeApp();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect(app);
  manager.setMods(await load());
  manager.onPageMessage('main', page.hello('slow'));
  await until('starting', () => manager.states().slow === 'starting');

  const answer = await call('slow', 'hi', null, 'early');
  assert.deepEqual([answer.ok, answer.value], [true, 'hello']);
});

test('the Node part can send to one window or to all', async () => {
  await start('talk', `export default function (host) {
    host.handle('go', () => {
      host.emit('everyone', { n: 1 });
      host.emit('only-panel', 'x', { window: 'panel' });
    });
  }`);
  await call('talk', 'go', null, 'go1');

  const all = await until('broadcast', () => app.find('fromHost?.("talk", "everyone", {"n":1})')[0]);
  assert.equal(all.window, '*');
  const one = await until('targeted', () => app.find('fromHost?.("talk", "only-panel", "x")')[0]);
  assert.equal(one.window, 'panel');
});

test('settings: the snapshot it starts with, changes from the page (repeats ignored), and set() going through the page', async () => {
  await start('cfg', `export default function (host) {
    const seen = [];
    host.config.onChange('n', (next, previous) => seen.push([next, previous]));
    host.handle('get', () => host.config.get('n'));
    host.handle('seen', () => seen);
    host.handle('set', () => host.config.set('n', 50));
    host.handle('typo', () => { try { host.config.get('nope'); } catch (e) { return e.message; } });
  }`, {}, { n: 9 });

  assert.equal((await call('cfg', 'get', null, 'g1')).value, 9, 'what the pages reported at hello');

  // Every window reports a change; the Node part must hear it once.
  for (const window of ['main', 'panel', 'toast']) manager.onPageMessage(window, page.config('cfg', 'n', 12));
  await until('change delivered', async () => (await call('cfg', 'get', null, `g${Math.random()}`)).value === 12);
  assert.deepEqual((await call('cfg', 'seen', null, 's1')).value, [[12, 9]]);

  const set = await call('cfg', 'set', null, 'set1');
  assert.equal(set.value, 7, 'set() resolves with what the page stored (the stand-in answers 7)');
  assert.ok(app.find('setConfig("cfg", "n", 50)').length, 'and it was sent to the page to store');

  assert.match((await call('cfg', 'typo', null, 'ty')).value, /"nope" is not a setting of cfg/);
});

test('files: it has a folder of its own, and its dispose hook runs when it is switched off', async () => {
  await start('files', `import fs from 'node:fs';
    import path from 'node:path';
    export default function (host) {
      fs.writeFileSync(path.join(host.dataDir, 'started'), 'yes');
      host.onDispose(() => fs.writeFileSync(path.join(host.dataDir, 'disposed'), 'yes'));
      return () => fs.writeFileSync(path.join(host.dataDir, 'returned-cleanup'), 'yes');
    }`);
  const dataDir = path.join(root, 'data', 'files');
  assert.equal(await fs.readFile(path.join(dataDir, 'started'), 'utf8'), 'yes');

  manager.onPageMessage('main', page.enabled('files', false));
  await until('stopped', () => Object.keys(manager.states()).length === 0);
  await until('dispose hooks ran', async () => (await fs.readdir(dataDir)).includes('returned-cleanup'));
  assert.deepEqual((await fs.readdir(dataDir)).sort(), ['disposed', 'returned-cleanup', 'started']);
  assert.ok(app.find('hostReport?.("files", null').length, 'its report is cleared from the pages');

  // Back on: a fresh start.
  manager.onPageMessage('main', page.enabled('files', true));
  await until('started again', () => manager.states().files === 'ready');
});

test('a timer the mod forgot to clear dies with it', async () => {
  await start('leaky', `import fs from 'node:fs';
    import path from 'node:path';
    export default function (host) {
      setInterval(() => fs.appendFileSync(path.join(host.dataDir, 'ticks'), '.'), 20);
    }`);
  const ticks = path.join(root, 'data', 'leaky', 'ticks');
  await until('ticking', async () => (await fs.readFile(ticks, 'utf8').catch(() => '')).length > 2);

  manager.onPageMessage('main', page.enabled('leaky', false));
  await until('stopped', () => Object.keys(manager.states()).length === 0);
  await sleep(100);
  const length = (await fs.readFile(ticks, 'utf8')).length;
  await sleep(250);
  assert.equal((await fs.readFile(ticks, 'utf8')).length, length, 'no more ticks once stopped');
});

test('one that ignores the request to stop is killed', async () => {
  await start('stubborn', `export default function (host) {
    host.handle('hang', () => { for (;;) {} });          // busy forever: it will never read the stop message
  }`);
  manager.onPageMessage('main', page.call('stubborn', 'hang', null, 'h1'));
  await sleep(100);

  const began = Date.now();
  await manager.stopAll();
  assert.ok(Date.now() - began >= 1500, 'it was given time to finish first');
  assert.ok(Date.now() - began < 5000, 'and then terminated');
  assert.deepEqual(manager.states(), {});
});

test('failing to start is reported, calls fail with the reason, and a fix restarts it', async () => {
  const dir = await makeMod('broken', `throw new Error('cannot start');`);
  app = new FakeApp();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect(app);
  manager.setMods(await load());
  manager.onPageMessage('main', page.hello('broken'));

  await until('failed', () => manager.states().broken === 'failed');
  const report = app.find('hostReport?.("broken", "error"')[0];
  assert.match(report.expression, /cannot start/);
  const answer = await call('broken', 'anything', null, 'b1');
  assert.deepEqual([answer.ok, /cannot start/.test(answer.value)], [false, true]);

  await sleep(1100);                                   // file times are only so fine
  await write(path.join(dir, 'host.js'), `export default function (host) { host.handle('v', () => 2); }`);
  manager.setMods(await load());
  await until('restarted', () => manager.states().broken === 'ready');
  assert.equal((await call('broken', 'v', null, 'b2')).value, 2);
});

test('a crash after it started is reported too, and does not loop', async () => {
  await start('crashy', `export default function () { setTimeout(() => { throw new Error('later'); }, 50); }`);
  await until('failed', () => manager.states().crashy === 'failed');
  assert.match(app.find('hostReport?.("crashy", "error"')[0].expression, /later/);
  await sleep(300);
  assert.equal(manager.states().crashy, 'failed', 'it stays failed until something changes');
});

test('a file the mod imports changing restarts it with the new code; editing a page script does not', async () => {
  const dir = await makeMod('graph', `import { value } from './lib.js';
    export default function (host) { host.handle('v', () => value); }`, { 'lib.js': `export const value = 1;` });
  await write(path.join(dir, 'main.js'), 'return 1;');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    type: 'module',
    modkit: { host: 'host.js', windows: { main: 'main.js' }, settings: [{ key: 'n', type: 'number', title: 'N', default: 5 }] },
  }));
  app = new FakeApp();
  manager = new HostManager({ dataDir: path.join(root, 'data') });
  manager.connect(app);
  manager.setMods(await load());
  manager.onPageMessage('main', page.hello('graph'));
  await until('ready', () => manager.states().graph === 'ready');
  assert.equal((await call('graph', 'v', null, 'g1')).value, 1);

  await sleep(1100);
  await write(path.join(dir, 'main.js'), 'return 2;');
  const before = app.find('hostReport?.("graph", "loading"').length;
  manager.setMods(await load());
  await sleep(300);
  assert.equal(app.find('hostReport?.("graph", "loading"').length, before, 'a page script edit did not restart it');

  await write(path.join(dir, 'lib.js'), `export const value = 2;`);
  manager.setMods(await load());
  await until('restarted with the new import', async () => (await call('graph', 'v', null, `g${Math.random()}`)).value === 2);
});

test('removing the mod stops it, and so does the app going away', async () => {
  await start('gone', `export default function () {}`);
  manager.setMods([]);
  await until('stopped', () => Object.keys(manager.states()).length === 0);

  // Back in the list: the pages still say it is switched on (the switch is remembered), so it runs.
  manager.setMods(await load());
  await until('running again', () => manager.states().gone === 'ready');

  // The app going away is different: nothing is wanted until a page says so again.
  await manager.stopAll();
  assert.deepEqual(manager.states(), {});
  manager.setMods(await load());
  await sleep(150);
  assert.deepEqual(manager.states(), {}, 'in the list, but no page has spoken since the app went');

  manager.onPageMessage('main', page.hello('gone'));
  await until('ready after the app came back', () => manager.states().gone === 'ready');
});

test('messages about mods it does not know, and garbage, are ignored', async () => {
  await start('known', `export default function () {}`);
  manager.onPageMessage('main', 'not json');
  manager.onPageMessage('main', JSON.stringify({ t: 'hello' }));
  manager.onPageMessage('main', page.hello('stranger'));
  manager.onPageMessage('main', page.config('stranger', 'k', 1));
  const reply = await call('stranger', 'x', null, 's1');
  assert.equal(reply.ok, false);
  assert.match(reply.value, /not running/);
  assert.deepEqual(manager.states(), { known: 'ready' });
});
