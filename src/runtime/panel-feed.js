// Framework: how often the main window tells the settings panel its state. Main window only.
//
// While the panel is open, the main window sends it a snapshot of the whole of its state (the bag, the atlas, the
// room, the click counts, ...) every time any of it changes, as an event (`cat-panel-state`): the snapshot is
// written out as JSON, goes through the app's backend, is read in again by the panel, and the panel is drawn
// again. A click is a change, so at the twenty clicks a second that a plugin can make that is twenty snapshots
// a second, each with the whole bag and atlas in it: the panel is busy nearly all the time, makes tens of
// megabytes of garbage a second, and answers the person's own clicks late.
//
// A snapshot is the whole state, so the newest of a run of them makes the ones before it unnecessary. One that
// differs from the last one sent in anything but the revision and the click counts (another tab, a list, the
// room, who is logged in, ...) is sent at once; one that differs only in those waits for the next FEED_GAP_MS,
// and then the newest of them is sent. The panel wants revisions that go up (it ignores the rest), and they do.
// The patch of the room's members (merged into the snapshot) is never sent before a snapshot older than it: the
// one held goes first.
//
// How: the app's messages to its backend end in a \`fetch\` of the IPC address (Tauri's own `invoke` and its
// internals cannot be replaced: they are read-only), and \`fetch\` can be. A snapshot that is held is answered
// at once with what the backend answers an event (nothing), so the app goes on; the newest is sent later, by
// the same \`fetch\`, and what the backend answers then is not needed. Everything else goes through untouched.
//
// It is put back when it is switched off or replaced. The panel window has the same on its receiving end
// (panel-tab.js), for a loader that has not got this.

if (!/^#?\/?$/.test(location.hash)) return;                       // the main window is at "#/"

if (typeof window.fetch !== 'function') return;
window.__modkitPanelFeed?.stop();                                   // a reload of this script replaces the copy before it

// <feed>
const EMIT_COMMAND = 'plugin:event|emit';
const SNAPSHOT_START = '{"event":"cat-panel-state"';
const PATCH_START = '{"event":"cat-panel-room-members-patch"';
const FEED_GAP_MS = 200;

const feed = (() => {
  const original = window.fetch;
  const stats = { received: 0, sent: 0 };                          // snapshots the app made, and snapshots that were sent
  let lastAt = 0;
  let lastKey = null;
  let held = null;                // the newest snapshot waiting: the arguments of the call
  let timer = 0;
  let stopped = false;

  // The snapshot without what changes with every click: if this is the same as the last one sent, the panel would
  // show nothing different (the counters are in the snapshot twice, and the revision counts the snapshots).
  const keyOf = body => body.replace(/"(?:revision|localClickCount|cumulativeClickCount)":-?\d+(?:\.\d+)?,?/g, '');

  const isEmit = url => {
    try {
      return decodeURIComponent(String(url)).endsWith(EMIT_COMMAND);
    } catch {
      return false;
    }
  };

  // What the backend answers to an event that was sent: nothing. This is what the app's code reads (the
  // `Tauri-Response` header says which of its two callbacks to call, and the body is the value).
  const answer = () => new Response('null', { status: 200, headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } });

  const send = (args, key) => {
    lastAt = performance.now();
    lastKey = key;
    stats.sent += 1;
    return original.apply(window, args);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!held) return;
    const { args, key } = held;
    held = null;
    try {
      send(args, key).catch(err => console.warn('[modkit] a snapshot for the panel was not sent', err));
    } catch (err) {
      console.warn('[modkit] a snapshot for the panel was not sent', err);
    }
  };

  const wrapper = function fetch(url, init) {
    const body = init?.body;
    if (stopped || typeof body !== 'string' || !isEmit(url)) return original.apply(this, arguments);

    if (body.startsWith(PATCH_START)) {
      flush();                                                       // the snapshot held is older than this patch: it goes first
      return original.apply(this, arguments);
    }
    if (!body.startsWith(SNAPSHOT_START)) return original.apply(this, arguments);

    stats.received += 1;
    const key = keyOf(body);
    const now = performance.now();
    if (key !== lastKey || (!timer && now - lastAt >= FEED_GAP_MS)) {
      held = null;                                                   // this one is newer than whatever was held
      clearTimeout(timer);
      timer = 0;
      return send([...arguments], key);
    }
    held = { args: [...arguments], key };
    if (!timer) timer = setTimeout(flush, Math.max(0, FEED_GAP_MS - (now - lastAt)));
    return Promise.resolve(answer());                                // told, in its own time
  };
  window.fetch = wrapper;

  return {
    stats,
    installed: window.fetch === wrapper,
    // Off and on again without taking it apart (what is held is sent when it goes off).
    pause(off) {
      stopped = !!off;
      if (stopped) flush();
    },
    stop() {
      stopped = true;
      flush();
      if (window.fetch === wrapper) window.fetch = original;         // not if somebody else has wrapped it since
    },
  };
})();
// </feed>

if (!feed.installed) return;
window.__modkitPanelFeed = feed;
mod.onDispose(() => {
  feed.stop();
  if (window.__modkitPanelFeed === feed) delete window.__modkitPanelFeed;
});
