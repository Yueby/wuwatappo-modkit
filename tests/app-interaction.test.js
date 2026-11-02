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
  const pointerHandlers = [];                          // what listens to the app's native mouse-move events
  let clock = 0;
  const sandbox = {
    console, setTimeout, clearTimeout, BroadcastChannel,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    addEventListener() {}, removeEventListener() {},
    __TAURI_INTERNALS__: { invoke: async () => {}, transformCallback: fn => { pointerHandlers.push(fn); return pointerHandlers.length; } },
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
    held, boxes, page, mod, core, app: sandbox.__wuwaApp,
    events: () => JSON.parse(JSON.stringify(sandbox.__events)),
    // the pointer moved to (x, y), as the app's native event says it, at the clock's time
    pointer: (x, y) => { for (const fn of pointerHandlers) fn({ payload: { x, y } }); },
    tick: ms => { clock += ms; },
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

// --- the speed of a pet that is let go ---------------------------------------------------------------------------------
//
// It is the pointer's: a pet's own place is known once a frame and moves in steps, and the speed taken from the last two
// frames was a matter of luck (measured on a real hand: 3000 to 6000 px/s at the pointer, 11 to 170 from the frames, because
// the last frames before the release had not moved).

// The hand moves along a line at `speed` px/s for `ms`, a mouse event a millisecond, and the pet is drawn a frame at a
// time (every 5 ms) at where it was at the last frame, so that the frames before the release may show it standing still.
function flick(w, { speed, ms = 100, who = 'member', dir = [0, -1], stillFrames = 0 }) {
  let x = 1000;
  let y = 800;
  const per = speed / 1000;
  const set = (left, top) => {
    if (who === 'member') w.boxes[7] = { left, top };
  };
  const pet = { left: 500, top: 500 };
  set(pet.left, pet.top);
  w.frame(5);
  if (who === 'member') w.held.member = 7; else w.held.pet = true;
  w.frame(5);
  for (let t = 0; t < ms; t++) {
    x += dir[0] * per;
    y += dir[1] * per;
    w.tick(1);
    w.pointer(x, y);
    if (t % 5 === 4) {
      // a frame: the pet is where the hand is, unless these are the frames that did not get the update
      if (t >= ms - 5 * stillFrames) { /* the pet has not moved since the last frame */ } else { pet.left += dir[0] * per * 5; pet.top += dir[1] * per * 5; }
      set(pet.left, pet.top);
      if (who === 'pet') { w.app.pet.left.value = pet.left; w.app.pet.top.value = pet.top; w.held.moved = true; }
      w.frame(0);
    }
  }
  if (who === 'member') w.held.member = null; else { w.held.pet = false; w.held.moved = false; }
  w.frame(2);
}

const releaseOf = w => w.events().filter(e => e.type === 'release').at(-1);

test("the speed at the release is the hand's, also when the last frames did not show the pet move", async () => {
  const w = await open(WATCH);
  try {
    flick(w, { speed: 4000, stillFrames: 3, dir: [0, -1] });
    const release = releaseOf(w);
    assert.equal(release.id, '7');
    assert.ok(Math.abs(release.vy + 4000) < 400, `vy was ${release.vy}, the hand did -4000`);
    assert.ok(Math.abs(release.vx) < 200);
  } finally {
    await w.close();
  }
});

test("a player's pet and the person's own are let go at the same speed for the same hand", async () => {
  const speeds = [];
  for (const who of ['member', 'pet']) {
    const w = await open(WATCH);
    try {
      flick(w, { speed: 3000, stillFrames: 2, dir: [0.6, -0.8], who });
      const release = releaseOf(w);
      speeds.push(Math.hypot(release.vx, release.vy));
    } finally {
      await w.close();
    }
  }
  assert.ok(speeds.every(speed => Math.abs(speed - 3000) < 400), `speeds ${speeds}`);
  assert.ok(Math.abs(speeds[0] - speeds[1]) < 300);
});

test('a hand that has stopped before the release throws nothing, however fast it went before', async () => {
  const w = await open(WATCH);
  try {
    flick(w, { speed: 5000, ms: 60, dir: [1, 0] });
    w.held.member = 7;
    w.frame(5);
    w.tick(120);                    // the hand rests 120 ms with the pet held
    w.frame(5);
    w.held.member = null;
    w.frame(5);
    const release = releaseOf(w);
    assert.ok(Math.hypot(release.vx, release.vy) < 50, `it was ${release.vx}, ${release.vy}`);
  } finally {
    await w.close();
  }
});

test('where the pet does not follow the hand (it is at the edge), its own speed is what is used on that axis', async () => {
  const w = await open(WATCH);
  try {
    // the hand goes down at 3000 px/s, the pet is against the floor and does not
    w.boxes[7] = { left: 400, top: 900 };
    w.frame(5);
    w.held.member = 7;
    w.frame(5);
    let y = 800;
    for (let t = 0; t < 80; t++) {
      y += 3;
      w.tick(1);
      w.pointer(1000, y);
      if (t % 5 === 4) w.frame(0);
    }
    w.held.member = null;
    w.frame(2);
    const release = releaseOf(w);
    assert.ok(Math.abs(release.vy) < 100, `vy was ${release.vy}`);
  } finally {
    await w.close();
  }
});

test('a click carries no speed', async () => {
  const w = await open(WATCH);
  try {
    w.boxes[7] = { left: 10, top: 10 };
    w.frame();
    w.held.member = 7;
    w.frame(30);
    w.held.member = null;
    w.frame(30);
    const release = releaseOf(w);
    assert.equal(release.moved, false);
    assert.equal(release.vx, 0);
    assert.equal(release.vy, 0);
  } finally {
    await w.close();
  }
});

test('the pointer is listened to once, and what comes is kept', async () => {
  const w = await open(`${WATCH}\nmod.app.pointer.start();`);
  try {
    w.pointer(100, 100); w.tick(5); w.pointer(110, 100); w.tick(5); w.pointer(120, 100); w.tick(5);
    const v = JSON.parse(JSON.stringify(vm.runInContext('window.modkit.pointer.samples.length', w.page)));
    assert.equal(v, 3);
  } finally {
    await w.close();
  }
});
