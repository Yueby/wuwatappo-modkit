// The click loop of examples/auto-click, run against a stand-in for `mod`. Nothing here talks to
// the app, so no event is ever sent: this is how the loop is tested without clicking on
// anyone's account.   node --test tests/auto-click.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXAMPLES_DIR } from '../src/lib/paths.js';

const source = await fs.readFile(path.join(EXAMPLES_DIR, 'auto-click', 'main.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs the mod's script with a fake `mod` and returns what it did.
function load({ interval = 60, loggedIn = true, failEmitAt = null } = {}) {
  const config = { running: false, interval };
  const listeners = [];
  const disposers = [];
  const calls = [];                 // { event, payload, at }
  const live = {};

  const mod = {
    invoke: async (cmd, args) => {
      assert.equal(cmd, 'plugin:event|emit');
      calls.push({ event: args.event, payload: args.payload, at: Date.now() });
      if (failEmitAt !== null && calls.length === failEmitAt) throw new Error('emit failed');
    },
    warn: () => {},
    live: (key, value) => { live[key] = value; },
    onDispose: fn => disposers.push(fn),
    config: {
      get: key => config[key],
      set: (key, value) => {
        const previous = config[key];
        config[key] = value;
        if (previous !== value) for (const l of listeners.filter(l => l.key === key)) l.fn(value, previous);
      },
      onChange: (key, fn) => listeners.push({ key, fn }),
    },
  };
  const localStorage = { getItem: () => (loggedIn ? 'cuid' : null) };

  new AsyncFunction('mod', 'localStorage', source)(mod, localStorage);
  return { mod, config, calls, live, dispose: () => disposers.forEach(fn => fn()) };
}

const gapsOf = calls => calls.map(c => c.at).map((t, i, all) => t - all[i - 1]).slice(1);

test('one click is one global-clap-mouse event: no key, no payload, no release to follow', async () => {
  const run = load({ interval: 60 });
  run.mod.config.set('running', true);
  await sleep(300);
  run.mod.config.set('running', false);
  await sleep(100);

  assert.ok(run.calls.length >= 4, `expected several clicks, got ${run.calls.length}`);
  for (const call of run.calls) {
    assert.equal(call.event, 'global-clap-mouse');
    assert.equal(call.payload, undefined);
  }
  assert.match(run.live.sent, /^\d+ 次$/);
});

test('clicks follow the interval, and a changed interval applies while it runs', async () => {
  const run = load({ interval: 60 });
  run.mod.config.set('running', true);
  await sleep(250);
  run.mod.config.set('interval', 150);
  const changedAt = Date.now();
  await sleep(700);
  run.mod.config.set('running', false);

  const before = run.calls.filter(c => c.at < changedAt - 80);
  const after = run.calls.filter(c => c.at > changedAt + 160);
  assert.ok(gapsOf(before).every(g => g >= 50 && g < 110), `early gaps ${gapsOf(before)}`);
  assert.ok(gapsOf(after).every(g => g >= 140 && g < 230), `later gaps ${gapsOf(after)}`);
});

test('stopping or disposing stops it, and nothing is sent afterwards', async () => {
  for (const stop of [run => run.mod.config.set('running', false), run => run.dispose()]) {
    const run = load({ interval: 40 });
    run.mod.config.set('running', true);
    await sleep(120);
    stop(run);
    await sleep(100);
    const after = run.calls.length;
    await sleep(250);
    assert.equal(run.calls.length, after, 'no further clicks once stopped');
  }
});

test('switching off and on again does not leave two loops running', async () => {
  const run = load({ interval: 80 });
  run.mod.config.set('running', true);
  await sleep(30);
  run.mod.config.set('running', false);
  run.mod.config.set('running', true);
  await sleep(500);
  run.mod.config.set('running', false);

  // The restart itself clicks at once, so the first gap is short. After it there is one loop:
  // evenly spaced clicks, and about 500/80 of them rather than twice that.
  const gaps = gapsOf(run.calls);
  assert.ok(gaps.slice(1).every(g => g >= 60), `two loops would interleave clicks; gaps: ${gaps}`);
  assert.ok(run.calls.length <= 9, `${run.calls.length} clicks in 500 ms at an 80 ms interval`);
});

test('not logged in: nothing is sent, the switch goes back off, and the reason is shown', async () => {
  const run = load({ loggedIn: false });
  run.mod.config.set('running', true);
  await sleep(100);
  assert.equal(run.calls.length, 0);
  assert.equal(run.config.running, false);
  assert.match(run.live.state, /未登录/);
});

test('a failed send stops the loop and says so', async () => {
  const run = load({ failEmitAt: 3 });
  run.mod.config.set('running', true);
  await sleep(400);
  assert.equal(run.config.running, false);
  assert.match(run.live.state, /已停止：emit failed/);
  assert.equal(run.calls.length, 3, 'it did not carry on after the failure');
});

test('it never starts by itself: loading the script sends nothing', async () => {
  const run = load();
  await sleep(200);
  assert.equal(run.calls.length, 0);
  assert.equal(run.config.running, false);
});
