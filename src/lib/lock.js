// One loader at a time.
//
// Two of them would each start every mod's Node part, each inject, each answer the pages: calls
// answered twice, files written by two processes, clicks sent twice. So a loader that is meant to
// stay (`watch`, `start`) holds a lock file with its pid, and a second one refuses to start while
// that process is alive. A lock whose process is gone (a crash, a kill) is simply taken over.

import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from './paths.js';

export const LOCK_FILE = path.join(WORK_DIR, 'loader.lock');

export class LoaderRunning extends Error {
  constructor(pid, file) {
    super(`another loader is already running (pid ${pid}).\n` +
      `  Only one can run: it holds ${file}. Close it first, or just use it.`);
    this.name = 'LoaderRunning';
    this.pid = pid;
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';           // there, and not ours to signal
  }
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Take the lock or throw LoaderRunning. Released at exit, and by release() for a caller that wants
// to say so earlier. `pid` and `alive` are for tests.
export function acquireLock({ file = LOCK_FILE, pid = process.pid, alive = isAlive } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx' });       // fails if it is there: no race between two starts
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readPid(file);
      if (holder !== null && holder !== pid && alive(holder)) throw new LoaderRunning(holder, file);
      if (attempt > 0) throw err;                                // took it over and lost it to someone again
      fs.rmSync(file, { force: true });                          // stale: its process is gone
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readPid(file) === pid) fs.rmSync(file, { force: true });
  };
  process.once('exit', release);
  return { release };
}
