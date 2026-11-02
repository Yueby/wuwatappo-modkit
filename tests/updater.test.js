// This program updating itself from the MOD page: asking whether there is a newer version, taking it, and what the page
// is told on the way. GitHub, the download, the new program and its setup are stood in for; the folders are temporary
// ones. What is not tried here is the real thing (a packaged exe replacing itself and starting setup): see
// docs/RELEASING.md for what was measured.
//
//   node --test tests/updater.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readLauncher, rememberLauncher } from '../src/lib/layout.js';
import { ModManager } from '../src/lib/manager.js';
import { SelfUpdater } from '../src/lib/updater.js';
import { setupAppPlan } from '../src/commands/setup.js';
import { parseOptions } from '../src/commands/options.js';
import { until } from './app-helpers.js';

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-updater-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const folder = async () => {
  const dir = path.join(root, `case-${++counter}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

// An updater whose outside world is recorded: what it asked GitHub, downloaded, ran, replaced and started.
async function stage({ version = '0.9.2', latest = { tag: 'v0.9.3', version: '0.9.3' }, packaged = true, launcher = true, said = null, downloadFails = null, replaceFails = null } = {}) {
  const dir = await folder();
  const calls = [];
  const exe = path.join(dir, 'app', 'modkit.exe');
  if (launcher) {
    await fs.mkdir(path.dirname(exe), { recursive: true });
    await fs.writeFile(exe, 'old program');
  }
  const updater = new SelfUpdater({
    version,
    packaged,
    dir: path.join(dir, 'loader'),
    latest: async () => { calls.push('latest'); return latest; },
    download: async (tag, file, { onProgress }) => {
      calls.push(`download ${tag}`);
      if (downloadFails) throw downloadFails;
      onProgress?.(50, 100);
      onProgress?.(100, 100);
      await fs.writeFile(file, 'new program');
    },
    versionOf: async file => { calls.push('versionOf'); assert.equal(await fs.readFile(file, 'utf8'), 'new program'); return said ?? latest.version; },
    replace: async (fresh, target) => {
      calls.push('replace');
      if (replaceFails) throw replaceFails;
      await fs.rename(fresh, target);
    },
    setup: program => { calls.push(`setup ${program}`); },
    launcher: async () => (launcher ? exe : null),
  });
  return { updater, calls, dir, exe };
}

// --- is there a newer one ----------------------------------------------------------------------------

test('a newer release is said, with what is running and whether this program can take it', async () => {
  const { updater } = await stage();
  assert.deepEqual(await updater.check(), { current: '0.9.2', latest: '0.9.3', tag: 'v0.9.3', newer: true, canUpdate: true });
});

test('the same version, an older one, and no release at all are not newer', async () => {
  for (const latest of [{ tag: 'v0.9.2', version: '0.9.2' }, { tag: 'v0.9.1', version: '0.9.1' }, null]) {
    const { updater } = await stage({ latest });
    const answer = await updater.check();
    assert.equal(answer.newer, false);
    assert.equal(answer.latest, latest?.version ?? null);
  }
});

test('run from the repository it can say there is a newer version, but cannot take it', async () => {
  const { updater, calls } = await stage({ packaged: false });
  assert.deepEqual(await updater.check(), { current: '0.9.2', latest: '0.9.3', tag: 'v0.9.3', newer: true, canUpdate: false });
  await assert.rejects(updater.update(), /only the packaged exe/);
  assert.deepEqual(calls, ['latest'], 'nothing was downloaded');
});

test('GitHub is asked once for the several times the page asks, unless it is forced', async () => {
  const { updater, calls } = await stage();
  await updater.check();
  await updater.check();
  assert.deepEqual(calls, ['latest']);
  await updater.check({ force: true });
  assert.deepEqual(calls, ['latest', 'latest']);
});

test('an answer is believed for ten minutes and then asked again', async () => {
  let clock = 1_000_000;
  const calls = [];
  const updater = new SelfUpdater({ version: '1.0.0', packaged: true, latest: async () => { calls.push(1); return null; }, now: () => clock });
  await updater.check();
  clock += 9 * 60_000;
  await updater.check();
  assert.equal(calls.length, 1);
  clock += 2 * 60_000;
  await updater.check();
  assert.equal(calls.length, 2);
});

test('a check that failed is an error, and is not remembered', async () => {
  let fail = true;
  const updater = new SelfUpdater({ version: '1.0.0', packaged: true, latest: async () => { if (fail) throw new Error('could not ask GitHub'); return null; } });
  await assert.rejects(updater.check(), /could not ask GitHub/);
  fail = false;
  assert.equal((await updater.check()).newer, false);
});

// --- taking it -----------------------------------------------------------------------------------------

test('an update downloads, checks the version it says, puts it in place of the program that is opened, and only then starts setup', async () => {
  const { updater, calls, exe, dir } = await stage();
  const stages = [];
  const progress = [];
  const done = await updater.update({ onStage: name => stages.push(name), onProgress: (received, total) => progress.push([received, total]) });

  assert.deepEqual(stages, ['download', 'verify', 'install']);
  assert.deepEqual(progress, [[50, 100], [100, 100]]);
  assert.equal(done.version, '0.9.3');
  assert.equal(await fs.readFile(exe, 'utf8'), 'new program', 'the program in the app folder is the new one');
  assert.deepEqual(calls, ['latest', 'download v0.9.3', 'versionOf', 'replace'], 'setup has not been started: the caller says its piece first');

  done.start();
  assert.deepEqual(calls.at(-1), `setup ${exe}`, 'it is the program in the app folder that runs setup');
  assert.equal(await fs.access(path.join(dir, 'loader', 'modkit-update.exe')).then(() => true, () => false), true, 'the download stays until setup has used it');
});

test('without a known program in the app folder, the download itself is what runs setup', async () => {
  const { updater, calls, dir } = await stage({ launcher: false });
  const done = await updater.update();
  done.start();
  assert.equal(calls.at(-1), `setup ${path.join(dir, 'loader', 'modkit-update.exe')}`);
  assert.ok(!calls.includes('replace'));
});

test('a download that says another version than the release is thrown away, and nothing is replaced', async () => {
  const { updater, calls, exe, dir } = await stage({ said: '0.0.1' });
  await assert.rejects(updater.update(), /says it is version 0\.0\.1, not 0\.9\.3/);
  assert.ok(!calls.includes('replace'));
  assert.equal(await fs.readFile(exe, 'utf8'), 'old program');
  assert.equal(await fs.access(path.join(dir, 'loader', 'modkit-update.exe')).then(() => true, () => false), false);
});

test('a download that fails changes nothing', async () => {
  const { updater, calls, exe } = await stage({ downloadFails: new Error('the download does not match its checksum') });
  await assert.rejects(updater.update(), /checksum/);
  assert.deepEqual(calls, ['latest', 'download v0.9.3']);
  assert.equal(await fs.readFile(exe, 'utf8'), 'old program');
});

test('a program that cannot be replaced (it is in use) is said, the old one stays, and setup is not started', async () => {
  const { updater, calls, exe } = await stage({ replaceFails: new Error('EBUSY') });
  await assert.rejects(updater.update(), /could not put the new program in place of .*modkit\.exe: EBUSY/);
  assert.equal(await fs.readFile(exe, 'utf8'), 'old program');
  assert.ok(!calls.some(call => call.startsWith('setup')));
  assert.equal(await fs.access(`${exe}.new`).then(() => true, () => false), false, 'the copy made for it is gone');
});

test('there is nothing to take when this is the latest', async () => {
  const { updater, calls } = await stage({ latest: { tag: 'v0.9.2', version: '0.9.2' } });
  await assert.rejects(updater.update(), /already the latest/);
  assert.deepEqual(calls, ['latest']);
});

// --- what the page is told ---------------------------------------------------------------------------------

// A manager with an updater like the above, and a page that records what it is told.
async function manage(options) {
  const { updater, calls, exe } = await stage(options);
  const sent = [];
  const app = {
    evaluate: async (window, js) => {
      const prefix = 'window.modkit?.manageReply?.(';
      const [id, event] = JSON.parse(`[${js.slice(prefix.length, -1)}]`);
      sent.push({ window, id, event });
    },
  };
  const paused = [];
  const manager = new ModManager({ modsDir: await folder(), dataDir: await folder(), app, updater, pause: async ms => { paused.push(ms); calls.push('pause'); } });
  const send = (message, window = 'panel') => manager.onPageMessage(window, JSON.stringify({ t: 'manage', ...message }));
  const events = id => sent.filter(s => s.id === id).map(s => s.event);
  const finished = id => until(`${id} is answered`, () => events(id).find(e => e.type === 'result' || e.type === 'error'), 8000);
  return { manager, send, events, finished, calls, exe, sent, paused };
}

test('the page asks whether there is a newer version and is told what is running and what is there', async () => {
  const { send, finished, events } = await manage();
  send({ id: 'c1', action: 'self-check' });
  const result = await finished('c1');
  assert.deepEqual(events('c1')[0], { type: 'ack' });
  assert.deepEqual({ ...result }, { type: 'result', current: '0.9.2', latest: '0.9.3', tag: 'v0.9.3', newer: true, canUpdate: true });
});

test('a check that cannot reach GitHub is an error in words', async () => {
  const updater = new SelfUpdater({ version: '1', packaged: true, latest: async () => { throw new Error('could not ask GitHub (x/y): offline'); } });
  const sent = [];
  const manager = new ModManager({ modsDir: await folder(), dataDir: await folder(), updater, app: { evaluate: async (w, js) => { sent.push(js); } } });
  manager.onPageMessage('panel', JSON.stringify({ t: 'manage', id: 'e1', action: 'self-check' }));
  await until('error', () => sent.find(js => js.includes('"error"')), 8000);
  assert.match(sent.find(js => js.includes('"error"')), /连不上 GitHub/);
});

test('an update tells the page the download as it comes, then each step, then that it restarts, and only then starts setup', async () => {
  const { send, events, calls, exe, paused } = await manage();
  send({ id: 'u1', action: 'self-update' });
  await until('setup started', () => calls.some(call => call.startsWith('setup')), 8000);

  // the first 'download' is the step beginning (no counts yet); the page takes that as zero
  const told = events('u1').filter(e => e.type === 'progress').map(e => (e.stage === 'download' && e.received !== undefined ? `download ${e.received}/${e.total}` : e.stage));
  assert.deepEqual(told, ['download', 'download 50/100', 'download 100/100', 'verify', 'install', 'restart']);
  assert.equal(events('u1').find(e => e.stage === 'restart').version, '0.9.3');
  assert.ok(calls.indexOf('pause') < calls.findIndex(call => call.startsWith('setup')), 'the page has time to draw it before the app is closed');
  assert.deepEqual(paused.length, 1);
  assert.equal(calls.at(-1), `setup ${exe}`);
});

test('an update that fails is an error, setup is not started, and another can be asked for afterwards', async () => {
  const { send, finished, calls, events } = await manage({ said: '0.0.1' });
  send({ id: 'f1', action: 'self-update' });
  const error = await finished('f1');
  assert.equal(error.type, 'error');
  assert.match(error.message, /版本与发布的对不上/);
  assert.ok(!calls.some(call => call.startsWith('setup')));

  send({ id: 'f2', action: 'self-update' });
  assert.equal((await finished('f2')).type, 'error', 'the second one was run, not refused as busy');
  assert.ok(events('f2').some(e => e.type === 'progress'));
});

test('only the panel window can ask for an update: a mod in another window cannot restart the app', async () => {
  const { manager, calls, sent } = await manage();
  manager.onPageMessage('main', JSON.stringify({ t: 'manage', id: 'x', action: 'self-update' }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(calls, []);
  assert.deepEqual(sent, []);
});

test('the repository version says why it cannot update', async () => {
  const { send, finished } = await manage({ packaged: false });
  send({ id: 'd1', action: 'self-update' });
  const error = await finished('d1');
  assert.match(error.message, /开发版，不能自动更新/);
});

// --- the program that is opened, and setup -------------------------------------------------------------

test('setup writes down where the program that is opened is, unless it runs from the loader\'s folder', async () => {
  const dir = await folder();
  const file = path.join(dir, 'loader', 'launcher.json');
  const loader = path.join(dir, 'loader', 'modkit-loader.exe');
  const opened = path.join(dir, 'app', 'modkit.exe');
  await fs.mkdir(path.dirname(opened), { recursive: true });
  await fs.writeFile(opened, 'x');

  assert.equal(await rememberLauncher({ exe: loader, file, loader }), false);
  assert.equal(await rememberLauncher({ exe: path.join(dir, 'loader', 'modkit-update.exe'), file, loader }), false, 'a download waiting there is not the program that is opened');
  assert.equal(await readLauncher({ file, dir: path.join(dir, 'nowhere') }), null);

  assert.equal(await rememberLauncher({ exe: opened, file, loader }), true);
  assert.equal(await readLauncher({ file, dir: path.join(dir, 'nowhere') }), opened);
});

test('a program that was written down and is gone is not used; the one called modkit.exe in the app folder is, if it is there', async () => {
  const dir = await folder();
  const file = path.join(dir, 'launcher.json');
  await fs.writeFile(file, JSON.stringify({ exe: path.join(dir, 'gone.exe') }));
  assert.equal(await readLauncher({ file, dir }), null);
  await fs.writeFile(path.join(dir, 'modkit.exe'), 'x');
  assert.equal(await readLauncher({ file, dir }), path.join(dir, 'modkit.exe'));
});

test('setup after an update from the page restarts an app that is running even when it needed nothing', () => {
  assert.deepEqual(setupAppPlan({ state: 'debuggable', patched: true }), { stop: false, restart: false });
  assert.deepEqual(setupAppPlan({ state: 'debuggable', patched: true, restart: true }), { stop: true, restart: true });
  assert.deepEqual(setupAppPlan({ state: 'stopped', patched: true, restart: true }), { stop: false, restart: false }, 'an app that is not running is not started');
  assert.equal(parseOptions(['--restart-app']).restartApp, true);
  assert.equal(parseOptions([]).restartApp, false);
});
