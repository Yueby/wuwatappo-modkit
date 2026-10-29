// The part of src/runtime/panel-tab.js that decides when the panel is told the app's state (the section between
// <snapshots> and </snapshots>), run against a made-up clock and a made-up table of listeners like Tauri's.
// Nothing here needs the app.
//
//   node --test tests/snapshot-throttle.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const source = (await fs.readFile(path.join(import.meta.dirname, '..', 'src', 'runtime', 'panel-tab.js'), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('// <snapshots>');
const end = source.indexOf('// </snapshots>');
assert.ok(start > 0 && end > start, 'the section is in panel-tab.js');
const section = source.slice(start, end);

// A clock that only moves when the test says, with the timers that go with it.
function world({ tauri = true, reuse = null } = {}) {
  const clock = { now: 1000, timers: [] };
  const performance = { now: () => clock.now };
  const setTimeout = (fn, ms) => { const timer = { fn, at: clock.now + ms, live: true }; clock.timers.push(timer); return timer; };
  const clearTimeout = timer => { if (timer) timer.live = false; };
  const advance = ms => {
    const until = clock.now + ms;
    for (;;) {
      const next = clock.timers.filter(t => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock.now = next.at;
      next.live = false;
      next.fn();
    }
    clock.now = until;
  };

  const callbacks = reuse?.callbacks ?? new Map();
  const window = { __TAURI_INTERNALS__: tauri ? { callbacks } : undefined };
  const { snapshots, gap } = new Function('window', 'performance', 'setTimeout', 'clearTimeout', `${section}\nreturn { snapshots, gap: SNAPSHOT_GAP_MS };`)(window, performance, setTimeout, clearTimeout);

  // What the app does: a listener is registered, and Tauri calls it with the event.
  const received = [];
  let nextId = 1;
  const listen = (name = 'listener') => {
    const id = nextId++;
    callbacks.set(id, data => { received.push({ name, event: data.event, revision: data.payload?.revision, payload: data.payload }); return `${name}-answer`; });
    return id;
  };
  const deliver = (id, event, payload) => callbacks.get(id)({ event, id: 0, payload });
  return { snapshots, gap, clock, advance, callbacks, received, listen, deliver };
}

const snapshot = (revision, over = {}) => ({ revision, streamId: 's', activeTab: 'setting', collapsed: false, isLoggedIn: true, roomMode: 'idle', currentRoomId: '', bagList: [1, 2, 3], atlasList: [1], roomMembers: [], localClickCount: revision, cumulativeClickCount: revision * 2, ...over });

test('a run of snapshots that differ only in the click counts is passed on a few times a second, newest first', () => {
  const w = world();
  const id = w.listen();
  w.deliver(id, 'cat-panel-state', snapshot(1));                                  // the first is passed on at once
  assert.deepEqual(w.received.map(r => r.revision), [1]);

  for (let revision = 2; revision <= 21; revision += 1) {                         // twenty clicks in a second
    w.advance(50);
    w.deliver(id, 'cat-panel-state', snapshot(revision));
  }
  w.advance(w.gap);
  const revisions = w.received.map(r => r.revision);
  assert.ok(revisions.length <= 7, `about one in four: got ${revisions.length}`);
  assert.equal(revisions.at(-1), 21, 'and the last one is the newest');
  assert.deepEqual([...revisions].sort((a, b) => a - b), revisions, 'revisions only go up: the app\'s panel ignores any that do not');
  assert.equal(new Set(revisions).size, revisions.length);
});

test('a snapshot that changes what the panel shows is passed on at once, even in the middle of a run, and the older one held is dropped', () => {
  const w = world();
  const id = w.listen();
  w.deliver(id, 'cat-panel-state', snapshot(1));
  w.deliver(id, 'cat-panel-state', snapshot(2));                                  // held
  w.deliver(id, 'cat-panel-state', snapshot(3, { activeTab: 'bag' }));            // a tab was clicked
  assert.deepEqual(w.received.map(r => r.revision), [1, 3], 'passed on at once, and 2 is not passed on after it');
  w.advance(w.gap * 2);
  assert.deepEqual(w.received.map(r => r.revision), [1, 3]);

});

test('each thing the panel shows, changed alone, is passed on at once, in the middle of a run of counters', () => {
  const changes = [{ bagList: [1, 2, 3, 4] }, { atlasList: [1, 2] }, { presetList: [1] }, { roomMembers: [{ id: 1 }] }, { isLoggedIn: false }, { currentRoomId: 'R' }, { roomMode: 'member' }, { roomIdInput: 'x' },
    { bagListLoading: true }, { atlasListLoading: true }, { presetListLoading: true }, { panelUiEpoch: 9 }, { collapsed: true }, { selectedRoleId: 5 }, { selectedPartId: 6 }, { participantsLength: 3 },
    { userInfo: { id: 7 } }, { localMemberId: 7 }, { canCreateRoom: true }, { canJoinRoom: true }, { canLeaveRoom: true }, { streamId: 'other' }];
  for (const change of changes) {
    const w = world();
    const id = w.listen();
    w.deliver(id, 'cat-panel-state', snapshot(1));
    w.deliver(id, 'cat-panel-state', snapshot(2));                                // only the counters: held
    assert.equal(w.received.length, 1, 'held');
    w.deliver(id, 'cat-panel-state', snapshot(3, change));
    assert.equal(w.received.length, 2, `${Object.keys(change)[0]} is passed on at once`);
  }
});

test('a held snapshot that a newer one replaced does not turn up later, when a patch or the end makes the held ones go', () => {
  const w = world();
  const snapshotListener = w.listen('panel-state');
  const patchListener = w.listen('members-patch');
  w.deliver(snapshotListener, 'cat-panel-state', snapshot(1));
  w.deliver(snapshotListener, 'cat-panel-state', snapshot(2));                    // held
  w.deliver(snapshotListener, 'cat-panel-state', snapshot(3, { activeTab: 'bag' })); // newer, and passed on: 2 is not wanted any more
  w.deliver(patchListener, 'cat-panel-room-members-patch', {});
  w.snapshots.stop();
  assert.deepEqual(w.received.filter(r => r.event === 'cat-panel-state').map(r => r.revision), [1, 3]);
});

test('started again on the same table (a copy that did not get to clean up), the listeners are not wrapped twice', () => {
  const first = world();
  const id = first.listen();
  const once = first.callbacks.get(id);
  const second = world({ reuse: first });                                         // a second copy of the section, on the same table
  const stillOnce = first.callbacks.get(id);
  assert.equal(stillOnce, once, 'the wrapper is the one that was there');
  assert.equal(stillOnce.original.original, undefined, 'and the app\'s listener is under one wrapper, not two');
  second.snapshots.stop();
});

test('the patch of the room\'s members is never passed on before a snapshot older than it: the held one goes first', () => {
  const w = world();
  const snapshotListener = w.listen('panel-state');
  const patchListener = w.listen('members-patch');
  w.deliver(snapshotListener, 'cat-panel-state', snapshot(1));
  w.deliver(snapshotListener, 'cat-panel-state', snapshot(2));                    // held
  w.deliver(patchListener, 'cat-panel-room-members-patch', { roomMembers: [] });
  assert.deepEqual(w.received.map(r => `${r.name}:${r.event}:${r.revision ?? '-'}`), ['panel-state:cat-panel-state:1', 'panel-state:cat-panel-state:2', 'members-patch:cat-panel-room-members-patch:-']);
});

test('what is not a snapshot is passed on untouched, with its answer', () => {
  const w = world();
  const id = w.listen('other');
  assert.equal(w.deliver(id, 'something-else', { a: 1 }), 'other-answer');
  assert.equal(w.deliver(id, 'something-else', { a: 2 }), 'other-answer');
  assert.deepEqual(w.received.map(r => r.event), ['something-else', 'something-else'], 'not held, however fast');
});

test('each listener of the snapshots is treated alike, one added later is wrapped too, and each gets the newest', () => {
  const w = world();
  const first = w.listen('first');
  const second = w.listen('second');
  const late = (() => { const id = w.listen('late'); return id; })();             // registered after the wrapping: set() wraps it
  for (const id of [first, second, late]) w.deliver(id, 'cat-panel-state', snapshot(1));
  assert.deepEqual(w.received.map(r => r.name), ['first', 'second', 'late'], 'every one is told at once the first time');

  for (const id of [first, second, late]) w.deliver(id, 'cat-panel-state', snapshot(2));
  assert.equal(w.received.length, 3, 'and every one is held');
  w.advance(w.gap);
  assert.deepEqual(w.received.slice(3).map(r => [r.name, r.revision]), [['first', 2], ['second', 2], ['late', 2]]);
});

test('after a quiet moment the next snapshot is passed on at once again', () => {
  const w = world();
  const id = w.listen();
  w.deliver(id, 'cat-panel-state', snapshot(1));
  w.deliver(id, 'cat-panel-state', snapshot(2));
  w.advance(w.gap);                                                               // 2 is passed on
  w.advance(5000);                                                                // a quiet moment
  w.deliver(id, 'cat-panel-state', snapshot(3));
  assert.deepEqual(w.received.map(r => r.revision), [1, 2, 3], 'at once, not another wait');
});

test('switched off, what the app had is back, and what was held is passed on', () => {
  const w = world();
  const id = w.listen();
  const original = w.callbacks.get(id).original;
  assert.equal(typeof original, 'function', 'it was wrapped');
  w.deliver(id, 'cat-panel-state', snapshot(1));
  w.deliver(id, 'cat-panel-state', snapshot(2));                                  // held
  w.snapshots.stop();
  assert.deepEqual(w.received.map(r => r.revision), [1, 2], 'the held one is passed on');
  assert.equal(w.callbacks.get(id), original, 'the listener is the app\'s own again');
  assert.ok(!Object.prototype.hasOwnProperty.call(w.callbacks, 'set'), 'and the table adds listeners as it did');
  w.deliver(id, 'cat-panel-state', snapshot(3));
  w.deliver(id, 'cat-panel-state', snapshot(4));
  assert.deepEqual(w.received.map(r => r.revision), [1, 2, 3, 4], 'nothing is held any more');
  w.advance(w.gap * 3);
  assert.equal(w.received.length, 4, 'and nothing comes late');
});

test('where Tauri\'s table of listeners is not there, it does nothing and does not fail', () => {
  const w = world({ tauri: false });
  assert.doesNotThrow(() => w.snapshots.stop());
  assert.deepEqual(w.snapshots.stats, {});
});

test('a listener wrapped before is not wrapped twice, so that a reload does not stack them', () => {
  const w = world();
  const id = w.listen();
  const wrapped = w.callbacks.get(id);
  w.callbacks.set(id, wrapped);                                                   // set again with what is already wrapped
  assert.equal(w.callbacks.get(id), wrapped);
  assert.equal(w.callbacks.get(id).original.original, undefined);
});

test('paused, every snapshot is passed on as it comes; resumed, they are held again', () => {
  const w = world();
  const id = w.listen();
  w.deliver(id, 'cat-panel-state', snapshot(1));
  w.deliver(id, 'cat-panel-state', snapshot(2));                                  // held
  w.snapshots.pause(true);
  assert.deepEqual(w.received.map(r => r.revision), [1, 2], 'what was held is passed on when it is paused');
  for (let revision = 3; revision <= 6; revision += 1) w.deliver(id, 'cat-panel-state', snapshot(revision));
  assert.deepEqual(w.received.map(r => r.revision), [1, 2, 3, 4, 5, 6], 'all of them while it is paused');
  w.snapshots.pause(false);
  w.advance(w.gap);
  w.deliver(id, 'cat-panel-state', snapshot(7));
  w.deliver(id, 'cat-panel-state', snapshot(8));
  assert.deepEqual(w.received.map(r => r.revision), [1, 2, 3, 4, 5, 6, 7], 'held again after');
});
