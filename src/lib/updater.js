// Updating this program from inside the app: the MOD page asks whether there is a newer version, and takes it.
//
// It is what `modkit.exe update` does (release.js), done by the loader, which is the one part that is always
// running and that the page can talk to (manager.js). Two things are different from the command:
//
//   * the loader runs from a copy of the exe (layout.js), so the exe in the app folder (the one the person
//     double-clicks) is not in use and is replaced as it is; the new exe's `setup` then puts a copy of itself where
//     the loader runs from, patches, starts the new loader and starts the app again. That setup stops this very
//     process, so it is started last, apart from it, and what it says goes to the loader's log.
//   * nothing else can say how far it is: the download tells the page as it comes (`onProgress`), and each step
//     after it (`onStage`).
//
// From the repository there is no exe to replace (`git pull` is the update): checking works, taking does not.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPackaged } from './bundle.js';
import { readLauncher } from './layout.js';
import { LOADER_DIR, LOG_FILE } from './paths.js';
import { compareVersions, downloadRelease, latestRelease, replaceProgram } from './release.js';
import { VERSION } from './version.js';

const run = promisify(execFile);

// How long an answer about the latest release is believed: the page asks whenever the MOD page opens.
const CHECK_CACHE_MS = 10 * 60_000;

// Where the download is kept until it is put in place, and what it is called while it waits.
export const FRESH_NAME = 'modkit-update.exe';

// What the new program says its version is, before it is trusted with anything.
async function versionOfExe(exe) {
  const { stdout } = await run(exe, ['--version'], { timeout: 20_000, windowsHide: true });
  return stdout.trim();
}

// Start `program setup --restart-app` apart from this process, saying what it says into the loader's log. It stops this
// process (the loader), so nothing here may depend on it.
function startSetup(program, { log = LOG_FILE } = {}) {
  let out = 'ignore';
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    out = fs.openSync(log, 'a');
  } catch { /* no log to write: it still has to run */ }
  const child = spawn(program, ['setup', '--restart-app'], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
  child.unref();
  if (typeof out === 'number') fs.closeSync(out);
  return child;
}

export class SelfUpdater {
  #version;
  #packaged;
  #latest;
  #download;
  #versionOf;
  #replace;
  #setup;
  #dir;
  #launcher;
  #now;
  #cached = null;       // { at, answer }

  constructor({
    version = VERSION,
    packaged = isPackaged(),
    latest = latestRelease,
    download = downloadRelease,
    versionOf = versionOfExe,
    replace = replaceProgram,
    setup = startSetup,
    dir = LOADER_DIR,
    launcher = readLauncher,
    now = Date.now,
  } = {}) {
    this.#version = version;
    this.#packaged = packaged;
    this.#latest = latest;
    this.#download = download;
    this.#versionOf = versionOf;
    this.#replace = replace;
    this.#setup = setup;
    this.#dir = dir;
    this.#launcher = launcher;
    this.#now = now;
  }

  get version() {
    return this.#version;
  }

  // { current, latest, tag, newer, canUpdate }: what is running, what GitHub has, and whether this program can take it.
  // `latest` is null when there is no release yet. Asked again only when `force`, or after a while.
  async check({ force = false } = {}) {
    if (!force && this.#cached && this.#now() - this.#cached.at < CHECK_CACHE_MS) return this.#cached.answer;
    const release = await this.#latest();
    const newer = release !== null && compareVersions(release.version, this.#version) > 0;
    const answer = {
      current: this.#version,
      latest: release?.version ?? null,
      tag: release?.tag ?? null,
      newer,
      canUpdate: this.#packaged,
    };
    this.#cached = { at: this.#now(), answer };
    return answer;
  }

  // Take the newest version: download, check, put in place. Resolves with { version, start } when everything is in place
  // and only the last step is left: `start()` runs the new program's setup, which ends this process, so the caller says
  // what it has to first. Throws, with nothing changed that matters, if any step before it does.
  //   onProgress(received, total)   the download, about five times a second
  //   onStage(name)                 'download', 'verify', 'install'
  async update({ onProgress = null, onStage = () => {} } = {}) {
    if (!this.#packaged) throw new Error('only the packaged exe can replace itself; from the repository, git pull');
    const answer = await this.check({ force: true });
    if (!answer.newer) throw new Error(`already the latest (${this.#version})`);

    await fsp.mkdir(this.#dir, { recursive: true });
    const fresh = path.join(this.#dir, FRESH_NAME);
    try {
      onStage('download');
      await this.#download(answer.tag, fresh, { onProgress });

      onStage('verify');
      const said = await this.#versionOf(fresh).catch(err => { throw new Error(`the download does not start: ${err.message}`); });
      if (said !== answer.latest) throw new Error(`the download says it is version ${said}, not ${answer.latest}: it was not used`);

      // The exe in the app folder is the one the person opens: it is replaced too (when it is known where it is), and
      // it is the one that runs setup, so that the copy the loader runs from is made from it.
      onStage('install');
      const launcher = await this.#launcher();
      let program = fresh;
      if (launcher) {
        const next = `${launcher}.new`;
        await fsp.copyFile(fresh, next);
        try {
          await this.#replace(next, launcher);
        } catch (err) {
          await fsp.rm(next, { force: true });
          throw new Error(`could not put the new program in place of ${launcher}: ${err.message}`);
        }
        program = launcher;
      }
      return { version: answer.latest, program, start: () => this.#setup(program) };
    } catch (err) {
      await fsp.rm(fresh, { force: true }).catch(() => {});
      throw err;
    }
  }
}

// What an update leaves in the loader's folder: the download, once nothing needs it any more.
export async function removeUpdateLeftovers({ dir = LOADER_DIR } = {}) {
  for (const name of [FRESH_NAME, `${FRESH_NAME}.part`]) await fsp.rm(path.join(dir, name), { force: true }).catch(() => {});
}
