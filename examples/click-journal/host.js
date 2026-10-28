// 点击记录: a mod that is only a Node part (there is no page script).
//
// Every `interval` seconds it asks the app for its cumulative click count, through the app's own
// read-only command, appends a line to clicks.csv whenever the number has changed, works out how
// fast it is going, and shows it on the MOD page. It never writes to the app: the only command it
// calls is load_cumulative_click_count (not the save_* one).
//
// What it shows of Node being used for something a page could not: it keeps a file, and its timer
// is a Node timer, which does not slow down when a window is hidden or covered.
//
// Needs no npm package. If one were wanted, `npm install` in this folder would do, and `import`
// would find it: this file is an ordinary ES module ("type": "module" in package.json).

import fs from 'node:fs/promises';
import path from 'node:path';

const ENVIRONMENT = 'cn-cn-prod';          // what the app itself passes for its production build
const KEEP_MS = 10 * 60_000;               // how long samples are kept for the rate
const RATE_WINDOW_MS = 60_000;
const MILESTONE = 1000;                    // a log line for every thousand

// Runs in the main window. Only the number comes back (the reply also names the account; it is
// neither kept nor shown).
const READ_COUNT = `window.__TAURI_INTERNALS__
  .invoke('load_cumulative_click_count', { environment: ${JSON.stringify(ENVIRONMENT)} })
  .then(reply => (typeof reply?.count === 'number' ? reply.count : null))`;

const format = n => n.toLocaleString('zh-CN');

// Clicks per minute over the last RATE_WINDOW_MS, from samples { at, count } (oldest first), or
// null while there is not enough to say (under 5 s of history).
export function ratePerMinute(samples, now) {
  const from = samples.find(s => now - s.at <= RATE_WINDOW_MS);   // the oldest sample inside the window
  const to = samples.at(-1);
  if (!from || to === from || to.at - from.at < 5_000) return null;
  return ((to.count - from.count) / (to.at - from.at)) * 60_000;
}

async function lineCount(file) {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export default async function (host) {
  const file = path.join(host.dataDir, 'clicks.csv');
  let rows = await lineCount(file);

  const samples = [];                      // { at, count }, newest last
  let first = null;                        // the count when this run began
  let last = null;
  let failing = false;                     // already said so; say it again only after it recovered
  let stopped = false;
  let timer = null;

  host.log(`开始记录，每 ${host.config.get('interval')} 秒读取一次，文件 ${file}`);
  host.live('rows', `${rows} 行`);

  async function sample() {
    const now = Date.now();
    try {
      const count = await host.evaluate('main', READ_COUNT);
      if (count === null) throw new Error('应用没有给出点击数（还没登录？）');

      if (failing) host.log('又读到了');
      failing = false;

      samples.push({ at: now, count });
      while (samples[0] && now - samples[0].at > KEEP_MS) samples.shift();

      if (first === null) {
        first = count;
        host.log(`累计点击数 ${format(count)}`);
      } else if (count < last) {
        // The app adopts the server's total when it logs in or out, which can be lower than what
        // it had counted locally.
        host.warn(`点击数从 ${format(last)} 变成 ${format(count)}（登录或退出时应用会改用服务器上的数值）`);
        first = count;
      } else if (Math.floor(count / MILESTONE) > Math.floor(last / MILESTONE)) {
        host.log(`累计点击数达到 ${format(Math.floor(count / MILESTONE) * MILESTONE)}`);
      }

      if (count !== last) {
        await fs.appendFile(file, `${new Date(now).toISOString()},${count}\n`);
        rows += 1;
      }
      last = count;

      const perMinute = ratePerMinute(samples, now);
      host.live('count', format(count));
      host.live('rate', perMinute === null ? '—' : `${perMinute.toFixed(1)} 次`);
      host.live('session', `+${format(count - first)}`);
      host.live('rows', `${rows} 行`);
    } catch (err) {
      if (!failing) host.warn(`读不到点击数：${err.message ?? err}`);
      failing = true;
    }
    if (!stopped) timer = setTimeout(sample, host.config.get('interval') * 1000);
  }

  sample();

  return () => {
    stopped = true;
    clearTimeout(timer);
    host.log('停止记录');
  };
}
