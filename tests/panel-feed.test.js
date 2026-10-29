// src/runtime/panel-feed.js: the section between <feed> and </feed>, run against a made-up clock and a made-up
// `fetch`. Nothing here needs the app.
//
//   node --test tests/panel-feed.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const file = (await fs.readFile(path.join(import.meta.dirname, '..', 'src', 'runtime', 'panel-feed.js'), 'utf8')).replace(/\r\n/g, '\n');
const start = file.indexOf('// <feed>');
const end = file.indexOf('// </feed>');
assert.ok(start > 0 && end > start, 'the section is in panel-feed.js');
const section = file.slice(start, end);

const EMIT_URL = 'http://ipc.localhost/plugin%3Aevent%7Cemit';

function world({ replaceable = true } = {}) {
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

  const calls = [];
  const backend = { fail: false };
  const real = function fetch(url, init) {
    calls.push({ url: String(url), init, self: this });
    if (backend.fail) return Promise.reject(new Error('backend said no'));
    return Promise.resolve(new Response('"from the backend"', { headers: { 'Content-Type': 'application/json' } }));
  };
  const window = {};
  if (replaceable) window.fetch = real;
  else Object.defineProperty(window, 'fetch', { value: real, writable: false });
  const warnings = [];
  const console = { warn: (...a) => warnings.push(a.join(' ')) };
  const { feed, gap } = new Function('window', 'performance', 'setTimeout', 'clearTimeout', 'console', `${section}\nreturn { feed, gap: FEED_GAP_MS };`)(window, performance, setTimeout, clearTimeout, console);
  return { feed, gap, window, real, calls, backend, advance, warnings };
}

const snapshot = (revision, over = {}) => ({ revision, streamId: 's', activeTab: 'setting', collapsed: false, isLoggedIn: true, roomMode: 'idle', currentRoomId: '', bagList: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], atlasList: [{ id: 1 }], roomMembers: [], localClickCount: revision, cumulativeClickCount: revision * 2, userInfo: { id: 7, nickname: 'x' }, ...over });
const bodyOf = (event, payload) => JSON.stringify({ event, payload });
const emit = (w, event, payload, url = EMIT_URL) => w.window.fetch(url, { method: 'POST', body: bodyOf(event, payload), headers: { 'Tauri-Callback': '1' } });
const sent = w => w.calls.filter(c => c.init?.body?.startsWith('{"event":"cat-panel-state"')).map(c => JSON.parse(c.init.body).payload.revision);

test('a run of snapshots that differ only in the revision and the click counts is sent a few times a second, the newest last', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));                                        // the first is sent at once
  assert.deepEqual(sent(w), [1]);
  for (let revision = 2; revision <= 21; revision += 1) {                         // twenty clicks in a second
    w.advance(50);
    emit(w, 'cat-panel-state', snapshot(revision));
  }
  w.advance(w.gap);
  const revisions = sent(w);
  assert.ok(revisions.length <= 7, `about one in four: ${revisions.length}`);
  assert.equal(revisions.at(-1), 21, 'and the newest is the last');
  assert.deepEqual([...revisions].sort((a, b) => a - b), revisions, 'revisions only go up');
  assert.deepEqual(w.feed.stats, { received: 21, sent: revisions.length });
});

test('a snapshot that differs in anything else is sent at once, in the middle of a run, and the older one held is dropped', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));                                        // held
  emit(w, 'cat-panel-state', snapshot(3, { activeTab: 'bag' }));
  assert.deepEqual(sent(w), [1, 3]);
  w.advance(w.gap * 3);
  assert.deepEqual(sent(w), [1, 3], '2 does not turn up later');
  emit(w, 'cat-panel-room-members-patch', {});                                    // what makes a held one go
  w.feed.stop();
  assert.deepEqual(sent(w), [1, 3], 'not with a patch, and not when it is switched off');
});

test('whatever else changes in a snapshot, one thing at a time, it is sent at once: not only the fields the panel is known to show', () => {
  const changes = [{ bagList: [{ id: 1, name: 'a' }, { id: 2, name: 'CHANGED' }] }, { bagList: [] }, { atlasList: [{ id: 2 }] }, { presetList: [1] }, { roomMembers: [{ id: 1, left: 10 }] }, { isLoggedIn: false },
    { currentRoomId: 'R' }, { roomMode: 'member' }, { bagListLoading: true }, { panelUiEpoch: 9 }, { collapsed: true }, { selectedRoleId: 5 }, { userInfo: { id: 7, nickname: 'y' } }, { streamId: 'other' }, { somethingNew: 1 }];
  for (const change of changes) {
    const w = world();
    emit(w, 'cat-panel-state', snapshot(1));
    emit(w, 'cat-panel-state', snapshot(2));
    assert.equal(w.calls.length, 1, 'held');
    emit(w, 'cat-panel-state', snapshot(3, change));
    assert.equal(w.calls.length, 2, `${Object.keys(change)[0]} is sent at once`);
  }
});

test('the patch of the room\'s members is never sent before a snapshot older than it: the held one goes first', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));                                        // held
  emit(w, 'cat-panel-room-members-patch', { roomMembers: [] });
  assert.deepEqual(w.calls.map(c => JSON.parse(c.init.body).event), ['cat-panel-state', 'cat-panel-state', 'cat-panel-room-members-patch']);
});

test('what is not a snapshot goes through untouched: the same call, `this`, arguments and answer', async () => {
  const w = world();
  const init = { method: 'POST', body: bodyOf('some-other-event', {}), headers: {} };
  const answer = await w.window.fetch(EMIT_URL, init);
  assert.equal(await answer.json(), 'from the backend');
  assert.equal(w.calls[0].init, init, 'the same init object');
  assert.equal(w.calls[0].self, w.window);

  await w.window.fetch('http://ipc.localhost/plugin%3Awindow%7Cis_visible', { method: 'POST', body: '{"label":"main"}' });
  await w.window.fetch('http://example.com/data', { method: 'POST', body: bodyOf('cat-panel-state', snapshot(1)) });     // not the IPC address
  await w.window.fetch(EMIT_URL, { method: 'POST', body: new Uint8Array([1, 2, 3]) });                                    // not text
  await w.window.fetch('http://example.com/plain');                                                                        // no init at all
  await w.window.fetch(new URL(EMIT_URL), { method: 'POST', body: bodyOf('cat-panel-state', snapshot(1)) });              // an address given as a URL
  assert.equal(w.calls.length, 6, 'every one reached the backend');
  for (let i = 0; i < 30; i += 1) await emit(w, 'some-other-event', {});                                                  // the very same, over and over
  assert.equal(w.calls.length, 36, 'other events are not held, however fast, even when nothing in them changes');
});

test('both ways the address can be written are recognised', () => {
  for (const url of ['http://ipc.localhost/plugin%3Aevent%7Cemit', 'ipc://localhost/plugin%3Aevent%7Cemit', 'http://ipc.localhost/plugin:event|emit']) {
    const w = world();
    emit(w, 'cat-panel-state', snapshot(1), url);
    emit(w, 'cat-panel-state', snapshot(2), url);
    assert.equal(w.calls.length, 1, `${url}: the second is held`);
  }
});

test('a snapshot held is answered at once as the backend would, sent later, and a failure then is said and not left unhandled', async () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  const held = await emit(w, 'cat-panel-state', snapshot(2));
  assert.equal(held.headers.get('Tauri-Response'), 'ok', 'the app calls its success callback');
  assert.equal(held.headers.get('content-type'), 'application/json');
  assert.equal(await held.json(), null);

  w.backend.fail = true;                                                          // the held one is sent later and fails
  w.advance(w.gap);
  assert.deepEqual(sent(w), [1, 2]);
  await Promise.resolve();
  await Promise.resolve();
  assert.match(w.warnings.join('\n'), /was not sent/);
});

test('after a quiet moment the next snapshot is sent at once again', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));
  w.advance(w.gap);
  w.advance(5000);
  emit(w, 'cat-panel-state', snapshot(3));
  assert.deepEqual(sent(w), [1, 2, 3]);
});

test('switched off, the app\'s own fetch is back, and a snapshot held is sent', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));
  w.feed.stop();
  assert.deepEqual(sent(w), [1, 2]);
  assert.equal(w.window.fetch, w.real, 'the same function');
  emit(w, 'cat-panel-state', snapshot(3));
  emit(w, 'cat-panel-state', snapshot(4));
  assert.deepEqual(sent(w), [1, 2, 3, 4]);
  w.advance(w.gap * 3);
  assert.equal(w.calls.length, 4);
});

test('if somebody else wrapped fetch after this, putting it back does not undo theirs, and this one passes everything', () => {
  const w = world();
  const ours = w.window.fetch;
  const theirs = function (...args) { return ours.apply(this, args); };
  w.window.fetch = theirs;
  w.feed.stop();
  assert.equal(w.window.fetch, theirs, 'theirs stays');
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));
  assert.deepEqual(sent(w), [1, 2], 'and this one no longer holds anything');
});

test('paused, every snapshot goes through; resumed, they are held again', () => {
  const w = world();
  emit(w, 'cat-panel-state', snapshot(1));
  emit(w, 'cat-panel-state', snapshot(2));
  w.feed.pause(true);
  assert.deepEqual(sent(w), [1, 2]);
  for (let revision = 3; revision <= 5; revision += 1) emit(w, 'cat-panel-state', snapshot(revision));
  assert.deepEqual(sent(w), [1, 2, 3, 4, 5]);
  w.feed.pause(false);
  w.advance(w.gap);
  emit(w, 'cat-panel-state', snapshot(6));
  emit(w, 'cat-panel-state', snapshot(7));
  assert.deepEqual(sent(w), [1, 2, 3, 4, 5, 6]);
});

test('where fetch cannot be replaced it says so and changes nothing', () => {
  const w = world({ replaceable: false });
  assert.equal(w.feed.installed, false);
  assert.equal(w.window.fetch, w.real);
});

test('bodies that are not what was expected do not make it fail', () => {
  const w = world();
  for (const body of ['', 'not json', '{', '{"event":"cat-panel-state"', '{"event":"cat-panel-state","payload":null}']) {
    assert.doesNotThrow(() => w.window.fetch(EMIT_URL, { method: 'POST', body }));
  }
  assert.equal(w.calls.length >= 3, true);
});
