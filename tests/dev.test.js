// Dev mode: developing a plugin from the folder it is written in. Folders are temporary ones, and the
// `dev` command is run against a temporary app folder, never the real one.
//
//   node --test tests/dev.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The command keeps its state in the app folder; this test's is a temporary one.
const app = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-dev-app-'));
process.env.WUWA_INSTALL_DIR = app;
const { readDev, setDev, writeDev } = await import('../src/lib/devmode.js');
const { discoverAll, discoverDev, discoverMods, modsSignature } = await import('../src/lib/mods.js');
const { default: devCommand } = await import('../src/commands/dev.js');
const { write } = await import('./app-helpers.js');

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-dev-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(app, { recursive: true, force: true });
});

const fresh = () => path.join(root, `case-${++counter}`);

async function plugin(dir, id, { version = '1.0.0', code = 'return 1;', manifest = {} } = {}) {
  const folder = path.join(dir, id);
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: id, version, modkit: { windows: { main: 'main.js' }, ...manifest } }));
  await write(path.join(folder, 'main.js'), code);
  return folder;
}

const names = mods => mods.filter(m => !m.core).map(m => m.name).sort();

// --- what is kept -----------------------------------------------------------------------------------------

test('what is kept is read leniently: a file that is missing, broken, or on without any folder is "off"', async () => {
  const dir = fresh();
  const file = path.join(dir, 'dev.json');
  assert.deepEqual(await readDev({ file }), { enabled: false, dirs: [] });

  await write(file, '{ not json');
  assert.deepEqual(await readDev({ file }), { enabled: false, dirs: [] });

  await write(file, JSON.stringify({ enabled: true, dirs: [] }));
  assert.equal((await readDev({ file })).enabled, false, 'on needs a folder to be on');

  await write(file, JSON.stringify({ enabled: true, dirs: ['rel/ative', 5, '', 'rel/ative'] }));
  const state = await readDev({ file });
  assert.deepEqual(state, { enabled: true, dirs: [path.resolve('rel/ative')] }, 'resolved, deduplicated, and only strings');
});

test('on needs a folder that exists; off keeps the folders; add and remove; the last one removed switches it off', async () => {
  const dir = fresh();
  const file = path.join(dir, 'dev.json');
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  await fs.mkdir(a, { recursive: true });
  await fs.mkdir(b);

  await assert.rejects(setDev({ action: 'on' }, { file }), /needs a folder/);
  await assert.rejects(setDev({ action: 'on', dir: path.join(dir, 'nowhere') }, { file }), /is not a folder/);

  assert.deepEqual(await setDev({ action: 'on', dir: a }, { file }), { enabled: true, dirs: [a] });
  assert.deepEqual(await setDev({ action: 'off' }, { file }), { enabled: false, dirs: [a] }, 'the folder is remembered');
  assert.deepEqual(await setDev({ action: 'on' }, { file }), { enabled: true, dirs: [a] }, 'back on with one word');

  await setDev({ action: 'add', dir: b }, { file });
  assert.deepEqual((await readDev({ file })).dirs, [a, b]);
  await setDev({ action: 'remove', dir: b }, { file });
  assert.deepEqual(await setDev({ action: 'remove', dir: a }, { file }), { enabled: false, dirs: [] }, 'nothing left to be on');

  assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')), [], 'no half-written file left behind');
});

// --- which plugins are used ---------------------------------------------------------------------------------

test('a dev folder that is a plugin, and one that holds plugins, both work, and each plugin is marked as in development', async () => {
  const dir = fresh();
  const single = await plugin(dir, 'solo');
  await plugin(path.join(dir, 'many'), 'one');
  await plugin(path.join(dir, 'many'), 'two');

  const found = await discoverDev([single, path.join(dir, 'many')]);

  assert.deepEqual(found.map(m => m.name).sort(), ['one', 'solo', 'two']);
  for (const mod of found) {
    assert.equal(mod.dev, true);
    assert.equal(mod.manifest.dev, true, 'the page is told');
    assert.equal(mod.loadError, null);
  }
  assert.equal(found.find(m => m.name === 'solo').devDir, single);
});

test('a plugin in a dev folder is used instead of the installed one of the same name; the others stay; off, they are back', async () => {
  const dir = fresh();
  const installed = path.join(dir, 'mods');
  await plugin(installed, 'alpha', { version: '1.0.0', code: 'return "installed";' });
  await plugin(installed, 'beta', { version: '1.0.0' });
  const devDir = await plugin(path.join(dir, 'dev'), 'alpha', { version: '9.9.9', code: 'return "mine";' });

  const on = (await discoverAll(installed, { devDirs: [devDir] })).filter(m => !m.core);
  assert.deepEqual(on.map(m => [m.name, m.manifest.version, Boolean(m.dev)]).sort(), [['alpha', '9.9.9', true], ['beta', '1.0.0', false]]);
  assert.equal(on.find(m => m.name === 'alpha').scripts.main, 'return "mine";', 'the folder\'s code, not the installed copy\'s');

  const off = (await discoverAll(installed, { devDirs: [] })).filter(m => !m.core);
  assert.deepEqual(off.map(m => [m.name, m.manifest.version, Boolean(m.dev)]).sort(), [['alpha', '1.0.0', false], ['beta', '1.0.0', false]]);
});

test('what a plugin needs is looked for in both: an installed one can need a plugin that is only in a dev folder', async () => {
  const dir = fresh();
  const installed = path.join(dir, 'mods');
  await plugin(installed, 'user', { manifest: { requires: { library: '^1.0.0' } } });
  const devDir = await plugin(path.join(dir, 'dev'), 'library', { version: '1.2.0' });

  const without = (await discoverAll(installed)).find(m => m.name === 'user');
  assert.match(without.loadError, /library/, 'without it, the installed one is broken');

  const withDev = (await discoverAll(installed, { devDirs: [devDir] })).find(m => m.name === 'user');
  assert.equal(withDev.loadError, null);
});

test('a broken plugin in a dev folder is listed with the reason, like any other', async () => {
  const dir = fresh();
  const folder = path.join(dir, 'broken');
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'broken', modkit: { windows: { main: 'gone.js' } } }));

  const [mod] = await discoverDev([folder]);

  assert.equal(mod.dev, true);
  assert.match(mod.loadError, /gone\.js/);
});

// --- hot reload ---------------------------------------------------------------------------------------------

test('an edit in a dev folder changes what is injected, an untouched one does not: that is the hot reload', async () => {
  const dir = fresh();
  const folder = await plugin(dir, 'live', { code: 'return 1;' });
  const before = modsSignature(await discoverDev([folder]));
  assert.equal(modsSignature(await discoverDev([folder])), before, 'the same files, the same signature: nothing is reloaded');

  await write(path.join(folder, 'main.js'), 'return 2;');
  const after = modsSignature(await discoverDev([folder]));
  assert.notEqual(after, before, 'saved: the page script is injected again');
});

test('an edit to a Node part restarts it, and an edit to a page script does not', async () => {
  const dir = fresh();
  const folder = path.join(dir, 'withhost');
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'withhost', type: 'module', modkit: { windows: { main: 'main.js' }, host: 'host.js' } }));
  await write(path.join(folder, 'main.js'), 'return 1;');
  await write(path.join(folder, 'host.js'), 'export default () => {};');

  const [first] = await discoverDev([folder]);
  await write(path.join(folder, 'main.js'), 'return 2;');
  const [pageEdited] = await discoverDev([folder]);
  assert.equal(pageEdited.hostVersion, first.hostVersion, 'the Node part keeps running');
  assert.notEqual(pageEdited.version, first.version);

  await new Promise(resolve => setTimeout(resolve, 20));
  await write(path.join(folder, 'host.js'), 'export default () => { /* changed */ };');
  const [hostEdited] = await discoverDev([folder]);
  assert.notEqual(hostEdited.hostVersion, first.hostVersion, 'the Node part is restarted');
});

// --- the command ----------------------------------------------------------------------------------------------

async function run(...args) {
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = text => { written.push(String(text)); return true; };
  try {
    await devCommand(args);
  } finally {
    process.stdout.write = original;
  }
  return written.join('');
}

test('the dev command switches the mode, says where things stand, and JSON is for programs', async () => {
  const dir = fresh();
  const mine = await plugin(dir, 'mine');
  await write(path.join(app, 'mods', 'mine', 'package.json'), JSON.stringify({ name: 'mine', version: '0.0.1', modkit: { windows: { main: 'main.js' } } }));
  await write(path.join(app, 'mods', 'mine', 'main.js'), 'return 0;');

  assert.equal(JSON.parse(await run('status', '--json', '--mods-dir', path.join(app, 'mods'))).enabled, false);

  await run('on', mine);
  const on = JSON.parse(await run('status', '--json', '--mods-dir', path.join(app, 'mods')));
  assert.deepEqual([on.enabled, on.dirs, on.mods.map(m => m.id), on.shadowed], [true, [mine], ['mine'], ['mine']], 'and it says it hides an installed one');
  assert.equal(JSON.parse(await fs.readFile(path.join(app, 'moddata', '.modkit', 'dev.json'), 'utf8')).enabled, true, 'in the app folder, where the loader looks');

  await run('off');
  assert.equal(JSON.parse(await run('status', '--json')).enabled, false);

  assert.match(await run('status'), /off: the plugins installed/);
  await assert.rejects(devCommand(['sideways']), /unknown action/);
});
