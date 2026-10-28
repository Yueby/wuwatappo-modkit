// mods/click-journal, the real mod and its real Node part in a worker thread, with a scripted
// stand-in for the app: what the app would answer to "what is the click count", and a record of
// what the mod shows and logs. Nothing here reaches an app.   node --test tests/click-journal.test.js

import { afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostManager } from '../src/lib/host.js';
import { discoverMods } from '../src/lib/mods.js';
import { MODS_DIR } from '../src/lib/paths.js';
import { ratePerMinute } from '../mods/click-journal/host.js';
import { sleep, until } from './app-helpers.js';

const ID = 'click-journal';
let mod;
let root;
let manager;
let app;

// Answers the count read from a script: a number, 'fail' to make the read throw, or (once the
// script runs out) the last number again. Records what the mod publishes and logs.
class JournalApp {
  constructor(script) {
    this.script = [...script];
    this.reads = 0;
    this.last = null;
    this.live = {};
    this.logs = [];
    this.cleared = 0;
  }

  async evaluate(window, expression) {
    if (expression.includes('load_cumulative_click_count')) {
      assert.equal(window, 'main', 'the count is read in the main window');
      assert.ok(!/save_/.test(expression), 'it must never call a save command');
      this.reads += 1;
      const next = this.script.length ? this.script.shift() : this.last;
      if (next === 'fail') throw new Error('the app is not answering');
      this.last = next;
      return next;
    }
    let match = expression.match(/hostLive\("click-journal", "(\w+)", (.*)\)$/s);
    if (match) this.live[match[1]] = JSON.parse(match[2]);
    match = expression.match(/logFromHost\?\.\("click-journal", "(\w+)", (.*)\)$/s);
    if (match) this.logs.push([match[1], JSON.parse(match[2])]);
    if (expression.includes('clearLive')) this.cleared += 1;
  }

  async evaluateAll() {}

  text(fragment) { return this.logs.filter(([, text]) => text.includes(fragment)); }
}

async function begin(script, dataDir = path.join(root, 'data')) {
  app = new JournalApp(script);
  manager = new HostManager({ dataDir });
  manager.connect(app);
  manager.setMods([mod]);
  // The page would say: switched on, and the interval it is set to.
  manager.onPageMessage('main', JSON.stringify({ t: 'hello', mod: ID, window: 'main', enabled: true, config: { interval: 0.05 } }));
  await until('ready', () => manager.states()[ID] === 'ready');
}

const csv = async dir => (await fs.readFile(path.join(dir ?? path.join(root, 'data'), ID, 'clicks.csv'), 'utf8').catch(() => '')).split('\n').filter(Boolean);

before(async () => {
  mod = (await discoverMods(MODS_DIR)).find(m => m.name === ID);
  assert.ok(mod, 'mods/click-journal is there');
  assert.equal(mod.loadError, null, mod.loadError);
});

afterEach(async () => {
  await manager?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-journal-'));
});

root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-journal-'));

test('it records each change of the count (not each read), and shows what it has', async () => {
  await begin([1000, 1000, 1500, 2100]);
  await until('all four read', () => app.reads >= 4);
  await until('the last one shown', () => app.live.count === (2100).toLocaleString('zh-CN'));

  const lines = await csv();
  assert.deepEqual(lines.map(l => l.split(',')[1]), ['1000', '1500', '2100'], 'the repeat of 1000 is not a new line');
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z,1000$/);

  assert.equal(app.live.rows, '3 行');
  assert.equal(app.live.session, `+${(1100).toLocaleString('zh-CN')}`);
  assert.equal(app.live.rate, '—', 'too little history for a rate yet');
});

test('it logs the start, the first number, and every thousand passed (and nothing in between)', async () => {
  await begin([900, 950, 1200, 1990, 2000, 3100]);
  await until('all read', () => app.reads >= 6);
  await until('last logged', () => app.text('3,000').length > 0);

  const texts = app.logs.map(([, text]) => text);
  assert.ok(texts[0].startsWith('开始记录，每 0.05 秒读取一次'), texts[0]);
  assert.ok(texts.some(t => t === `累计点击数 ${(900).toLocaleString('zh-CN')}`), 'the first reading');
  assert.deepEqual(
    texts.filter(t => t.startsWith('累计点击数达到')),
    ['累计点击数达到 1,000', '累计点击数达到 2,000', '累计点击数达到 3,000'],
  );
});

test('a count that goes down is a warning that says why, and the "new this run" starts over', async () => {
  await begin([5000, 3000, 3040]);
  await until('read', () => app.reads >= 3);
  await until('shown', () => app.live.session === '+40');

  const [warning] = app.logs.filter(([level]) => level === 'warn');
  assert.match(warning[1], /从 5,000 变成 3,000.*服务器/);
});

test('when the app does not answer it says so once, and says when it is back', async () => {
  await begin(['fail', 'fail', 'fail', 4000]);
  await until('recovered', () => app.live.count === (4000).toLocaleString('zh-CN'));

  assert.equal(app.text('读不到点击数').length, 1, 'once, not once per failed read');
  assert.match(app.text('读不到点击数')[0][1], /the app is not answering/);
  assert.equal(app.text('又读到了').length, 1);
});

test('no count (not logged in) is reported as such and nothing is written', async () => {
  await begin([null, null]);
  await until('read twice', () => app.reads >= 2);
  assert.match(app.text('读不到点击数')[0][1], /没有给出点击数/);
  assert.deepEqual(await csv(), []);
});

test('switching it off stops the reading, withdraws what it showed, and says so; on again continues the file', async () => {
  await begin([100, 200]);
  await until('two lines', async () => (await csv()).length === 2);

  manager.onPageMessage('main', JSON.stringify({ t: 'enabled', mod: ID, enabled: false }));
  await until('stopped', () => Object.keys(manager.states()).length === 0);
  assert.ok(app.cleared >= 1, 'its figures were withdrawn');
  // Written by its dispose hook, which runs after it has been taken off the list.
  await until('the stop is logged', () => app.text('停止记录').length === 1);

  const reads = app.reads;
  await sleep(300);
  assert.equal(app.reads, reads, 'no reads after it stopped');

  app.script = [300];
  manager.onPageMessage('main', JSON.stringify({ t: 'enabled', mod: ID, enabled: true }));
  await until('three lines', async () => (await csv()).length === 3);
  assert.equal(app.live.rows, '3 行', 'it counted what the file already had');
});

test('the rate is clicks per minute over the last minute, and needs a few seconds of history', () => {
  const at = s => s * 1000;
  assert.equal(ratePerMinute([{ at: at(0), count: 0 }, { at: at(30), count: 60 }], at(30)), 120);
  assert.equal(ratePerMinute([{ at: at(0), count: 0 }, { at: at(3), count: 60 }], at(3)), null, 'under 5 s');
  assert.equal(ratePerMinute([{ at: at(0), count: 0 }], at(0)), null, 'one sample');
  assert.equal(ratePerMinute([], at(0)), null);
  // The oldest sample is outside the minute and does not count.
  const samples = [{ at: at(0), count: 0 }, { at: at(70), count: 1000 }, { at: at(100), count: 1030 }];
  assert.equal(ratePerMinute(samples, at(100)), 60);
});
