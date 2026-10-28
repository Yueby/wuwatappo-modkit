// modkit.exe update — is there a newer version on GitHub, and if so, take it.
//
//   update --check [--json]   only ask (the window does, every time it opens)
//   update                    download it, check it, put it in place of this program, then run its
//                             `setup` (which re-applies the patch and replaces the running loader)
//   update --reopen           as above, and open the window again from the new program; exit code 10
//                             tells the window that did the asking that it is replaced and can close
//
// Only a packaged exe can replace itself. From the repository, `git pull` is the update.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isPackaged } from '../lib/bundle.js';
import { fail, log, style } from '../lib/output.js';
import { REPO, compareVersions, downloadRelease, latestRelease, replaceProgram } from '../lib/release.js';
import { VERSION } from '../lib/version.js';

export const UPDATED_AND_REOPENED = 10;

const FLAGS = new Set(['--check', '--json', '--reopen']);

const run = promisify(execFile);

// What the new program says its version is, before it is trusted with anything.
async function versionOf(exe) {
  const { stdout } = await run(exe, ['--version'], { timeout: 20_000, windowsHide: true });
  return stdout.trim();
}

// Run the new program's `setup`, showing what it says as it goes. Resolves with its exit code.
const setupOf = exe => new Promise((resolve, reject) => {
  const child = spawn(exe, ['setup'], { stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => resolve(code));
});

export default async function update(argv) {
  const unknown = argv.filter(arg => !FLAGS.has(arg));
  if (unknown.length) throw new Error(`unknown option ${unknown[0]} (update takes ${[...FLAGS].join(', ')})`);
  const [check, json, reopen] = ['--check', '--json', '--reopen'].map(flag => argv.includes(flag));

  let latest;
  try {
    latest = await latestRelease();
  } catch (err) {
    if (json) log(JSON.stringify({ current: VERSION, error: err.message }));
    else fail(`could not ask GitHub (${REPO}): ${err.message}`);
    return 1;
  }
  const newer = latest !== null && compareVersions(latest.version, VERSION) > 0;

  if (json) log(JSON.stringify({ current: VERSION, latest: latest?.version ?? null, tag: latest?.tag ?? null, newer }));
  else if (!latest) log(`version ${VERSION}: no release has been published yet (${REPO})`);
  else if (!newer) log(`version ${VERSION}: this is the latest (${latest.version})`);
  else log(`version ${VERSION}: ${style.bold(latest.version)} is available`);
  if (check || !newer) return 0;

  if (!isPackaged()) {
    fail('only the packaged exe can replace itself; from the repository, git pull');
    return 1;
  }

  const target = process.execPath;
  const fresh = `${target}.new`;

  log(`downloading ${latest.tag} (about 90 MB)…`);
  await downloadRelease(latest.tag, fresh);
  log('checksum ok');

  const said = await versionOf(fresh).catch(err => { throw new Error(`the download does not start: ${err.message}`); });
  if (said !== latest.version) throw new Error(`the download says it is version ${said}, not ${latest.version}: it was not used`);

  await replaceProgram(fresh, target);
  log(`${style.green('updated')} to ${latest.version}; applying it (setup)…\n`);

  const code = await setupOf(target);
  if (code !== 0) {
    fail(`updated to ${latest.version}, but setup stopped (exit ${code}): read what it said above, then press 安装 once more`);
    return 1;
  }

  if (reopen) {
    // The new program opens its own window; the one that asked is this program's, and closes.
    await run(target, ['window'], { windowsHide: true });
    return UPDATED_AND_REOPENED;
  }
  return 0;
}
