// What a mod is told about the way a pet is handled (mod.app.pet.onInteraction, mod.app.members.onInteraction),
// with the real framework script in a vm context standing in for the window: the app's state (who is held, where a pet
// is drawn) is made up and changed by the test, one animation frame at a time.   node --test tests/app-interaction.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { discoverCore, discoverMods, unitFor } from '../src/lib/mods.js';
import { compileCore, compileMod } from '../src/lib/page-scripts.js';
import { write } from './app-helpers.js';

// A window with a clock the test moves and a queue of frames it runs by hand.
async function open(modSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-interaction-'));
  await write(path.join(root, 'mods', 'watcher', 'package.json'), JSON.stringify({
    modkit: { api: 8, windows: { main: 'main.js' }, permissions: ['app-internals'] },
  }));
  await write(path.join(root, 'mods', 'watcher', 'main.js'), modSource);

  const store = new Map();
  const frames = [];
  const boxes = {};                                    // data-room-cat-id -> { left, top } of the pet as drawn
  const held = { member: null, pet: false, moved: false };
  let clock = 0;
  const sandbox = {
    console, setTimeout, clearTimeout, BroadcastChannel,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    addEventListener() {}, removeEventListener() {},
    __TAURI_INTERNALS__: { invoke: async () => {}, transformCallback: () => 1 },
    performance: { now: () => clock },
    requestAnimationFrame: fn => frames.push(fn),
    document: {
      querySelector: selector => {
        const id = /data-room-cat-id="([^"]+)"/.exec(selector)?.[1];
        const box = id && boxes[id];
        return box ? { getBoundingClientRect: () => ({ ...box, width: 100, height: 100 }) } : null;
      },
      querySelectorAll: () => [],
    },
    __events: [],
  };
  sandbox.window = sandbox;
  sandbox.__wuwaApp = {
    pet: { left: { value: 100 }, top: { value: 100 }, held: { get value() { return held.pet; } }, moved: { get value() { return held.moved; } } },
    members: { held: () => held.member, list: () => [], where: () => ({ left: 0, top: 0 }) },
  };
  const page = vm.createContext(sandbox);
  const core = (await discoverCore()).find(s => s.name === '@core/modkit-registry');
  await vm.runInContext(compileCore(core), page);
  const [mod] = await discoverMods(path.join(root, 'mods'));
  const report = await vm.runInContext(compileMod(unitFor(mod, 'main'), 'main'), page);
  assert.equal(report.status === 'error', false, report.error);
  return {
    held, boxes, page, mod, core,
    events: () => JSON.parse(JSON.stringify(sandbox.__events)),
    // one animation frame, `ms` later
    frame(ms = 16) {
      clock += ms;
      const now = frames.splice(0);
      for (const fn of now) fn(clock);
    },
    close: async () => {
      vm.runInContext(`window.modkit?.channel?.close(); window.__wuwaMods?.['@core/modkit-registry']?.dispose?.()`, page);
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

const WATCH = `
  mod.app.members.onInteraction(event => window.__events.push(event));
  mod.app.pet.onInteraction(event => window.__events.push({ pet: true, ...event }));
`;

test("another player's pet is told as pressed, dragged and let go, and it is let go when it is", async () => {
  const w = await open(WATCH);
  try {
    w.boxes[7] = { left: 10, top: 10 };
    w.frame();
    w.held.member = 7;
    w.frame();
    w.boxes[7] = { left: 40, top: 10 };
    w.frame();
    w.frame();
    w.held.member = null;
    w.frame();
    w.frame();
    const types = w.events().map(e => e.type);
    assert.deepEqual(types.slice(0, 2), ['press', 'dragstart']);
    assert.equal(types.at(-1), 'release', 'the release is told once the pet is no longer held');
    assert.equal(types.filter(t => t === 'release').length, 1);
    assert.equal(w.events().at(-1).id, '7');
    assert.equal(w.events().at(-1).moved, true);
  } finally {
    await w.close();
  }
});

test("a click on another player's pet is a press, a release and a click", async () => {
  const w = await open(WATCH);
  try {
    w.boxes[7] = { left: 10, top: 10 };
    w.frame();
    w.held.member = 7;
    w.frame();
    w.frame();
    w.held.member = null;
    w.frame();
    w.frame();
    assert.deepEqual(w.events().map(e => e.type), ['press', 'release', 'click']);
    assert.equal(w.events()[1].moved, false);
  } finally {
    await w.close();
  }
});

test('two players\' pets, one after the other, are each let go', async () => {
  const w = await open(WATCH);
  try {
    w.boxes[7] = { left: 10, top: 10 };
    w.boxes[8] = { left: 200, top: 10 };
    for (const id of [7, 8]) {
      w.held.member = id;
      w.frame();
      w.boxes[id] = { left: w.boxes[id].left + 30, top: 10 };
      w.frame();
      w.held.member = null;
      w.frame();
    }
    w.frame();
    const releases = w.events().filter(e => e.type === 'release').map(e => e.id);
    assert.deepEqual(releases, ['7', '8']);
  } finally {
    await w.close();
  }
});

test('a pet that is let go as it is passed from one hand to another pet is let go, and the other is pressed', async () => {
  const w = await open(WATCH);
  try {
    w.boxes[7] = { left: 10, top: 10 };
    w.boxes[8] = { left: 200, top: 10 };
    w.held.member = 7;
    w.frame();
    w.held.member = 8;                                  // within one frame
    w.frame();
    w.held.member = null;
    w.frame();
    w.frame();
    const told = w.events().map(e => `${e.id}:${e.type}`);
    assert.ok(told.includes('7:release'));
    assert.ok(told.includes('8:press'));
    assert.ok(told.includes('8:release'));
  } finally {
    await w.close();
  }
});

test("the person's own pet is told the same way", async () => {
  const w = await open(WATCH);
  try {
    w.frame();
    w.held.pet = true;
    w.frame();
    w.held.moved = true;
    w.frame();
    w.held.pet = false;
    w.held.moved = false;
    w.frame();
    assert.deepEqual(w.events().map(e => e.type), ['press', 'dragstart', 'drag', 'release']);
  } finally {
    await w.close();
  }
});

test('a mod that has not changed is run again when the framework is a new copy, so it has the new API', async () => {
  const w = await open('window.__runs = (window.__runs ?? 0) + 1;');
  try {
    const run = code => vm.runInContext(code, w.page);
    const install = () => run(compileMod(unitFor(w.mod, 'main'), 'main'));
    assert.equal(run('window.__runs'), 1);
    assert.equal((await install()).status, 'already-installed', 'the same framework leaves it alone');
    assert.equal(run('window.__runs'), 1);

    // The framework is evaluated again, with a change (so the loader sees another version of it)
    const next = { ...w.core, code: `${w.core.code}\n// changed`, version: `${w.core.version}-next` };
    assert.equal((await run(compileCore(next))).status, 'ok');
    assert.notEqual((await install()).status, 'already-installed', 'a mod built by the old copy is not kept');
    assert.equal(run('window.__runs'), 2);
    assert.equal((await install()).status, 'already-installed', 'and then it is left alone again');
    assert.equal(run('window.__runs'), 2);
  } finally {
    await w.close();
  }
});
