// What the MOD page asks of the loader: show the registry's plugins, install, update, remove. The page is a
// stand-in that records what it is sent and answers when a test says so; GitHub is a fetch that serves an
// index and zips; the folders are temporary ones.
//
//   node --test tests/manager.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installMod } from '../src/lib/install.js';
import { ModManager } from '../src/lib/manager.js';
import { writeDev } from '../src/lib/devmode.js';
import { getFromRegistry } from '../src/lib/registry.js';
import { until, write } from './app-helpers.js';
import { github, plugin, release } from './registry-helpers.js';

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-manager-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Folders to work in, and `talk(releases)`: a manager whose GitHub has those releases, and the page it
// talks to. Called again with other releases it is the same folders with a different registry.
async function setup(makeReleases = async () => []) {
  const dir = path.join(root, `case-${++counter}`);
  const modsDir = path.join(dir, 'mods');
  const dataDir = path.join(dir, 'moddata');
  await fs.mkdir(modsDir, { recursive: true });

  const talk = (releases, { fetch = github(releases).fetch, devFile } = {}) => {
    const sent = [];
    const app = {
      evaluate: async (window, js) => {
        const prefix = 'window.modkit?.manageReply?.(';
        assert.ok(js.startsWith(prefix) && js.endsWith(')'), `unexpected script: ${js}`);
        const [id, event] = JSON.parse(`[${js.slice(prefix.length, -1)}]`);
        sent.push({ window, id, event });
      },
    };
    const manager = new ModManager({ modsDir, dataDir, app, fetch, devFile });
    return {
      manager,
      sent,
      send: (message, window = 'panel') => manager.onPageMessage(window, JSON.stringify({ t: 'manage', ...message })),
      events: id => sent.filter(s => s.id === id).map(s => s.event),
      finished: id => until(`${id} is answered`, () => sent.filter(s => s.id === id).map(s => s.event).find(e => e.type === 'result' || e.type === 'error'), 8000),
      asked: id => until(`${id} asks`, () => sent.filter(s => s.id === id).map(s => s.event).find(e => e.type === 'confirm'), 8000),
    };
  };

  const page = talk(await makeReleases(dir));
  return { dir, modsDir, dataDir, talk, ...page };
}

// The index says what the package says (the registry's automation writes the one from the other).
const alpha = async dir => release(dir, await plugin(dir, 'alpha', '1.2.0', { permissions: ['network'] }), { permissions: ['network'] });
const installed = async modsDir => (await fs.readdir(modsDir)).sort();

// --- who is believed -----------------------------------------------------------------------------

test('only the panel window is believed: a mod in another window cannot install anything', async () => {
  const { modsDir, send, sent } = await setup(async dir => [await alpha(dir)]);

  assert.equal(send({ id: 'r1', action: 'get', mod: 'alpha' }, 'main'), true, 'it is ours, so nobody else looks at it');
  await new Promise(resolve => setTimeout(resolve, 150));

  assert.deepEqual(await installed(modsDir), []);
  assert.deepEqual(sent, [], 'and nothing is answered either');
});

test('a message that is not a request for the manager is left for whoever it is for', async () => {
  const { manager } = await setup();
  assert.equal(manager.onPageMessage('panel', JSON.stringify({ t: 'call', mod: 'x' })), false);
  assert.equal(manager.onPageMessage('panel', 'not json'), false);
});

test('a request is acknowledged at once, so the page can tell a loader that has never heard of it', async () => {
  const { send, events, finished } = await setup();
  send({ id: 'r1', action: 'browse' });
  await finished('r1');
  assert.deepEqual(events('r1').map(e => e.type), ['ack', 'result']);
});

// --- the list --------------------------------------------------------------------------------------

test('browse gives the registry\'s plugins with where each stands here', async () => {
  const { send, finished } = await setup(async dir => [await alpha(dir)]);
  send({ id: 'r1', action: 'browse' });
  const result = await finished('r1');
  assert.deepEqual(result.mods.map(m => [m.id, m.version, m.installed, m.update]), [['alpha', '1.2.0', false, false]]);
});

test('a registry that cannot be reached is an error the page can show', async () => {
  const { talk } = await setup();
  const offline = talk([], { fetch: async () => { throw new Error('offline'); } });
  offline.send({ id: 'r1', action: 'browse' });
  const failed = await offline.finished('r1');
  assert.equal(failed.type, 'error');
  assert.match(failed.message, /连不上插件仓库/);
});

// --- install -----------------------------------------------------------------------------------------

test('an install says what the package declares and waits: nothing is on disk until the answer is yes', async () => {
  const { modsDir, send, asked, finished } = await setup(async dir => [await alpha(dir)]);

  send({ id: 'r1', action: 'get', mod: 'alpha' });
  const question = await asked('r1');

  assert.deepEqual([question.info.id, question.info.version, question.info.nodePart, question.info.permissions], ['alpha', '1.2.0', false, ['network']]);
  assert.equal('entry' in question.info || 'url' in question.info || 'sha256' in question.info, false, 'the page is shown the facts, not the registry\'s bookkeeping');
  assert.deepEqual(await installed(modsDir), [], 'asked, not done');

  send({ id: 'r1', action: 'answer', ok: true });
  const done = await finished('r1');

  assert.deepEqual([done.type, done.done, done.id, done.version], ['result', 'installed', 'alpha', '1.2.0']);
  assert.deepEqual(await installed(modsDir), ['alpha']);
  assert.deepEqual(done.mods.map(m => [m.id, m.installed]), [['alpha', true]], 'and the list comes back as it is now');
});

test('a no installs nothing, and an answer that is not exactly yes is a no', async () => {
  const { modsDir, send, asked, finished } = await setup(async dir => [await alpha(dir)]);

  send({ id: 'r1', action: 'get', mod: 'alpha' });
  await asked('r1');
  send({ id: 'r1', action: 'answer', ok: 'yes' });
  assert.equal((await finished('r1')).done, 'declined');

  send({ id: 'r2', action: 'get', mod: 'alpha' });
  await asked('r2');
  send({ id: 'r2', action: 'answer', ok: false });
  assert.equal((await finished('r2')).done, 'declined');

  send({ id: 'r0', action: 'answer', ok: true });                       // nobody asked
  assert.deepEqual(await installed(modsDir), []);
});

test('only what the registry has can be asked for, by a name that is a name', async () => {
  const { modsDir, dir, send, finished } = await setup(async d => [await alpha(d)]);
  await write(path.join(dir, 'precious', 'file.txt'), 'x');
  await installMod(await plugin(dir, 'beta'), { modsDir });

  send({ id: 'r1', action: 'get', mod: 'nothing' });
  assert.match((await finished('r1')).message, /仓库里没有这个插件/);

  for (const [n, name] of ['../precious', '..', 'a/b', 'x/beta', '..\\beta', 'C:\\Windows', '', '.hidden', null, 5].entries()) {
    // One at a time: a second request while the first is still going is refused for being second, which
    // would pass this test for the wrong reason.
    send({ id: `bad${n}`, action: 'get', mod: name });
    assert.equal((await finished(`bad${n}`)).type, 'error', JSON.stringify(name));
    send({ id: `rm${n}`, action: 'remove', mod: name });
    const removal = await finished(`rm${n}`);
    assert.equal(removal.type, 'error', JSON.stringify(name));
    assert.doesNotMatch(removal.message, /还没做完/, `refused for what it is, not for being second: ${JSON.stringify(name)}`);
  }
  assert.equal(await fs.readFile(path.join(dir, 'precious', 'file.txt'), 'utf8'), 'x');
  assert.deepEqual(await installed(modsDir), ['beta'], 'the one that was there is still there: a path is not a name, not even one that ends in one');
});

test('two at once: the second is told to wait, and the first is not disturbed', async () => {
  const { send, asked, finished } = await setup(async dir => [await alpha(dir), await release(dir, await plugin(dir, 'beta'))]);

  send({ id: 'r1', action: 'get', mod: 'alpha' });
  await asked('r1');
  send({ id: 'r2', action: 'get', mod: 'beta' });

  const refused = await finished('r2');
  assert.equal(refused.type, 'error');
  assert.match(refused.message, /还没做完/);
  send({ id: 'r1', action: 'answer', ok: true });
  assert.equal((await finished('r1')).done, 'installed');
});

test('a request that is not one of these is an error, not ignored', async () => {
  const { send, finished } = await setup();
  send({ id: 'x1', action: 'format-disk' });
  assert.equal((await finished('x1')).type, 'error');
});

// --- update and remove ---------------------------------------------------------------------------------

test('an update of the same version is not made, and a newer one asks first, saying from what', async () => {
  const { dir, modsDir, talk } = await setup();
  const v1 = await release(dir, await plugin(dir, 'alpha', '1.0.0'));
  const v2 = await release(dir, await plugin(dir, 'alpha', '1.1.0'));
  await getFromRegistry('alpha', { modsDir, fetch: github([v1]).fetch });          // installed from the registry, at 1.0.0

  const current = talk([v1]);
  current.send({ id: 'u1', action: 'update', mod: 'alpha' });
  const same = await current.finished('u1');
  assert.deepEqual([same.done, same.version], ['current', '1.0.0']);
  assert.equal(current.events('u1').some(e => e.type === 'confirm'), false, 'nothing to ask about');

  const newer = talk([v2]);
  newer.send({ id: 'u2', action: 'update', mod: 'alpha' });
  const question = await newer.asked('u2');
  assert.deepEqual([question.info.before, question.info.version], ['1.0.0', '1.1.0']);
  assert.equal(JSON.parse(await fs.readFile(path.join(modsDir, 'alpha', 'package.json'), 'utf8')).version, '1.0.0', 'still the old one');

  newer.send({ id: 'u2', action: 'answer', ok: true });
  assert.equal((await newer.finished('u2')).done, 'updated');
  assert.equal(JSON.parse(await fs.readFile(path.join(modsDir, 'alpha', 'package.json'), 'utf8')).version, '1.1.0');
});

test('remove deletes the plugin, keeps its data unless asked, and cannot reach outside mods', async () => {
  const { dir, modsDir, dataDir, send, finished } = await setup();
  await installMod(await plugin(dir, 'alpha'), { modsDir });
  await installMod(await plugin(dir, 'beta'), { modsDir });
  await write(path.join(dataDir, 'alpha', 'notes.txt'), 'kept');
  await write(path.join(dataDir, 'beta', 'notes.txt'), 'dropped');

  send({ id: 'd1', action: 'remove', mod: 'alpha' });
  const kept = await finished('d1');
  assert.deepEqual([kept.done, kept.purged], ['removed', false]);
  assert.deepEqual(await installed(modsDir), ['beta']);
  assert.equal(await fs.readFile(path.join(dataDir, 'alpha', 'notes.txt'), 'utf8'), 'kept');

  send({ id: 'd2', action: 'remove', mod: 'beta', purge: true });
  assert.equal((await finished('d2')).purged, true);
  await assert.rejects(fs.stat(path.join(dataDir, 'beta')));
});

// --- a plugin in development ------------------------------------------------------------------------------

test('a plugin that is being developed is marked in the list, and cannot be installed, updated or removed from here', async () => {
  const { dir, modsDir, talk } = await setup();
  const registry = [await alpha(dir)];
  const devFolder = await plugin(path.join(dir, 'mine'), 'alpha', '9.9.9');
  const devFile = path.join(dir, 'dev.json');
  await installMod(await plugin(dir, 'alpha', '1.0.0'), { modsDir });                   // an installed copy as well

  // Not in dev mode: nothing special.
  await writeDev({ enabled: false, dirs: [devFolder] }, { file: devFile });
  const off = talk(registry, { devFile });
  off.send({ id: 'b0', action: 'browse' });
  assert.equal((await off.finished('b0')).mods.find(m => m.id === 'alpha').dev, false);

  await writeDev({ enabled: true, dirs: [devFolder] }, { file: devFile });
  const on = talk(registry, { devFile });
  on.send({ id: 'b1', action: 'browse' });
  assert.equal((await on.finished('b1')).mods.find(m => m.id === 'alpha').dev, true);

  for (const [n, action] of ['get', 'update', 'remove'].entries()) {
    on.send({ id: `d${n}`, action, mod: 'alpha' });
    const refused = await on.finished(`d${n}`);
    assert.equal(refused.type, 'error', action);
    assert.match(refused.message, /开发模式/, action);
  }
  assert.deepEqual(await installed(modsDir), ['alpha'], 'the installed copy is as it was');
  assert.equal(JSON.parse(await fs.readFile(path.join(modsDir, 'alpha', 'package.json'), 'utf8')).version, '1.0.0');
});
