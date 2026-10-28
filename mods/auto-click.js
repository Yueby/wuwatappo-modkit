// Auto click: raises the click count by sending the app the same native key events the
// keyboard hook would send.
//
// How the app counts (read from the 1.0.2 main-window bundle):
//   * the Rust hook emits `key-press` and `key-release` with the key name as the payload;
//   * a click is counted on the RELEASE of a key that was recorded as pressed, so one
//     count is one press followed by its release — a press alone adds nothing;
//   * F5/F7/F8/F9 do something else (game mode, switching screens), so they are avoided.
// F13 is used because nothing is bound to it and a physical keyboard almost never has it,
// so it cannot collide with what the user is typing.
//
// Off by default and never remembered across a reload: a switch left on by accident would
// keep adding clicks to the account for as long as the app runs.

// Mods run once per window. Only the main window listens to these events; a timer in every
// window would send the pair seven times per tick.
if (location.hash !== '' && location.hash !== '#/') return;

const KEY = 'F13';
const MIN_INTERVAL_MS = 50;
const MAX_INTERVAL_MS = 5000;
const DEFAULT_INTERVAL_MS = 200;
const ENV = 'cn-cn-prod';

let enabled = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let sent = 0;            // pairs sent since this mod loaded
let problem = null;      // why the loop stopped by itself, if it did
let timer = null;

const emit = event => mod.invoke('plugin:event|emit', { event, payload: KEY });
const loggedIn = () => !!localStorage.getItem('wuwatappo-login-cuid');
const redraw = () => window.modkit.changed();

// One click: press, then release.
async function tick() {
  timer = null;
  if (!enabled) return;

  try {
    if (!loggedIn()) throw new Error('未登录，已停止');
    await emit('key-press');
    await emit('key-release');
    sent += 1;
  } catch (err) {
    enabled = false;
    problem = String(err.message ?? err);
    mod.warn('stopped:', problem);
    redraw();
    return;
  }

  if (sent % 10 === 0) redraw();          // keep the counter moving without redrawing every tick
  if (enabled) timer = setTimeout(tick, intervalMs);
}

function setEnabled(next) {
  enabled = next;
  problem = null;
  clearTimeout(timer);
  timer = null;
  if (enabled) timer = setTimeout(tick, intervalMs);
  redraw();
}

// A reload or deletion must stop the loop, or it would keep clicking with no switch to turn off.
mod.onDispose(() => { enabled = false; clearTimeout(timer); });

mod.entry({
  title: '自动点击',
  description: () => problem ?? (enabled ? `运行中，每 ${intervalMs} 毫秒点击一次` : '关闭。开启后按设定间隔模拟按键，增加点击数'),
  toggle: { value: () => enabled, onChange: setEnabled },
});

mod.entry({
  title: '点击间隔（毫秒）',
  description: `${MIN_INTERVAL_MS}–${MAX_INTERVAL_MS}，越小点得越快`,
  number: {
    value: () => intervalMs,
    min: MIN_INTERVAL_MS,
    max: MAX_INTERVAL_MS,
    step: 10,
    onChange: v => { intervalMs = Math.round(v); redraw(); },
  },
});

mod.entry({ title: '本次已发送', value: () => `${sent} 次` });
