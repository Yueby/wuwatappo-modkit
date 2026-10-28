// Auto click: raises the click count by sending the app the same native key events the
// keyboard hook would send. Settings and what the MOD page shows are in mod.json.
//
// How the app counts (read from the 1.0.2 main-window bundle):
//   * the Rust hook emits `key-press` and `key-release` with the key name as the payload;
//   * a click is counted on the RELEASE of a key that was recorded as pressed, so one
//     count is one press followed by its release — a press alone adds nothing;
//   * F5/F7/F8/F9 do something else (game mode, switching screens), so they are avoided.
// F13 is used because nothing is bound to it and a physical keyboard almost never has it,
// so it cannot collide with what the user is typing.
//
// The "running" switch is persist:false in the manifest: whatever the master switch does,
// clicking only ever starts because the user turned it on in this session.
//
// Runs in the main window only (see "scripts" in mod.json): the events are received there,
// and a timer in every window would send each pair seven times.

const KEY = 'F13';

let sent = 0;            // pairs sent since this mod loaded
let timer = null;

const emit = event => mod.invoke('plugin:event|emit', { event, payload: KEY });
const loggedIn = () => !!localStorage.getItem('wuwatappo-login-cuid');
const showSent = () => mod.live('sent', `${sent} 次`);

// One click: press, then release.
async function tick() {
  timer = null;
  if (!mod.config.get('running')) return;

  try {
    if (!loggedIn()) throw new Error('未登录');
    await emit('key-press');
    await emit('key-release');
    sent += 1;
  } catch (err) {
    mod.warn('stopped:', err.message ?? err);
    mod.config.set('running', false);                  // the listener below stops the timer
    mod.live('state', `已停止：${err.message ?? err}`);  // after set(): replaces its plain "已停止"
    showSent();
    return;
  }

  if (sent % 10 === 0) showSent();                     // keep the counter moving without a message per tick
  if (mod.config.get('running')) timer = setTimeout(tick, mod.config.get('interval'));
}

function halt() {
  clearTimeout(timer);
  timer = null;
}

mod.config.onChange('running', on => {
  halt();
  if (on) {
    mod.live('state', '运行中');
    timer = setTimeout(tick, mod.config.get('interval'));
  } else {
    mod.live('state', '已停止');
    showSent();
  }
});

// Switching the mod off or reloading it must stop the loop, or it would keep clicking with
// no switch left to turn off.
mod.onDispose(halt);
