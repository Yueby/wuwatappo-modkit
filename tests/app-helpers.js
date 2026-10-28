// Small helpers shared by the tests that run against the live app.

import fs from 'node:fs/promises';
import path from 'node:path';
import { openAppSessions } from '../src/lib/cdp.js';
import { windowLabel } from '../src/lib/targets.js';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const json = value => JSON.stringify(value);

export async function write(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

// Open a session on every app window; `inWindow(label, expression)` evaluates in one.
export async function openWindows() {
  const windows = await openAppSessions({ log: () => {} });
  if (!windows.length) throw new Error('no app windows: start the app with `node src/cli.js lab`');

  const find = label => {
    const found = windows.find(w => windowLabel(w.target) === label);
    if (!found) throw new Error(`no ${label} window`);
    return found.session;
  };
  return {
    windows,
    session: find,
    inWindow: (label, expression) => find(label).evaluate(expression),
    close: () => { for (const { session } of windows) session.close(); },
  };
}

// Poll until `check` returns something truthy, and return it.
export async function until(label, check, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${label} (last value: ${json(last)})`);
}
