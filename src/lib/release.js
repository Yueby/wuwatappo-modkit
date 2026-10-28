// Finding out whether there is a newer version of this program on GitHub, getting it, and putting it
// in place of the running one.
//
// A release is a tag with two files: modkit.exe, and modkit.exe.sha256 (what `npm run build` writes
// beside it; see docs/RELEASING.md). Nothing is run until the download matches that hash.
//
// "What is the latest release" is asked of github.com/<repo>/releases/latest, which answers with a
// redirect to .../releases/tag/<tag> (or, when there is no release yet, to .../releases). Asking the
// API instead would work too, but an unauthenticated client gets 60 requests an hour for a whole
// address, and a program that checks every time a window opens would be what runs it out.
//
// The hash only says the file is the one that was uploaded: whoever can change the release can change
// both. That is the trust this has been given (a signature would need a key kept apart).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from './semver.js';

// Where releases are made. GitHub follows a renamed repository, so the old name keeps working.
export const REPO = 'Yueby/wuwatappo-modkit';
export const ASSET = 'modkit.exe';
const USER_AGENT = 'wuwatappo-modkit';

export function compareVersions(a, b) {
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) throw new Error(`not versions: ${a}, ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// { tag, version } of the latest release, or null when there is none yet.
export async function latestRelease({ repo = REPO, fetch = globalThis.fetch } = {}) {
  const response = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: 'manual',
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(response.status === 404 ? `${repo} not found on GitHub` : `GitHub answered ${response.status}`);
  }
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(response.headers.get('location') ?? '')?.[1];
  if (!tag) return null;
  const name = decodeURIComponent(tag);
  if (!parse(name)) return null;                         // a tag that is not a version is not ours
  return { tag: name, version: name.replace(/^v/, '') };
}

// The first 64 hex digits in the text: `sha256sum` and `certutil` both put the hash first or alone.
export function parseChecksum(text) {
  const hash = /\b([0-9a-f]{64})\b/i.exec(text)?.[1];
  if (!hash) throw new Error('the checksum file has no SHA-256 in it');
  return hash.toLowerCase();
}

// Fetch `url` into `file`, and only keep it if it is what it should be: its SHA-256 is `expected`, it is
// `size` bytes if that is known, and it did not stop short. Nothing is left behind otherwise. Resolves
// with the hash.
// `onProgress(received, total)` hears of it as it comes (about five times a second, and once at the end);
// `total` is what the server said or what `size` is, and 0 when neither is known.
//
// A download that goes quiet for `idleMs` is given up on, wherever it is: the connection, the headers, or
// half way through the body. (There is no limit on how long a download that keeps coming may take.)
export async function downloadVerified(url, file, { expected, size = null, fetch = globalThis.fetch, onProgress = null, idleMs = 30_000 }) {
  const controller = new AbortController();
  let idle;
  const watch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error(`nothing came from ${url} for ${idleMs / 1000} s`)), idleMs);
  };
  watch();
  try {
    return await download(url, file, { expected, size, fetch, onProgress, signal: controller.signal, watch });
  } catch (err) {
    if (controller.signal.aborted) throw controller.signal.reason;      // say why it was given up, not just that it was
    throw err;
  } finally {
    clearTimeout(idle);
  }
}

async function download(url, file, { expected, size, fetch, onProgress, signal, watch }) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  watch();

  const part = `${file}.part`;
  const hash = createHash('sha256');
  const total = Number(response.headers.get('content-length')) || size || 0;
  let received = 0;
  let reported = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (chunks) {
        for await (const chunk of chunks) {
          watch();
          hash.update(chunk);
          received += chunk.length;
          if (onProgress && Date.now() - reported >= 200) {
            reported = Date.now();
            onProgress(received, total);
          }
          yield chunk;
        }
      },
      fs.createWriteStream(part),
      { signal },
    );
    onProgress?.(received, total);
    const announced = Number(response.headers.get('content-length'));
    if (announced && received !== announced) throw new Error(`the download stopped at ${received} of ${announced} bytes`);
    if (size !== null && received !== size) throw new Error(`the download is ${received} bytes, not the ${size} it should be: it was not used`);
    const actual = hash.digest('hex');
    if (actual !== expected.toLowerCase()) throw new Error(`the download does not match its checksum (${actual.slice(0, 12)}… instead of ${expected.slice(0, 12)}…): it was not used`);
    await fsp.rename(part, file);
    return actual;
  } catch (err) {
    await fsp.rm(part, { force: true });
    throw err;
  }
}

// Get the release's exe into `file`, and only keep it if it matches its checksum. Resolves with the hash.
export async function downloadRelease(tag, file, { repo = REPO, fetch = globalThis.fetch, onProgress = null } = {}) {
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${ASSET}`;
  const response = await fetch(`${url}.sha256`, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}.sha256 answered ${response.status}`);
  return downloadVerified(url, file, { expected: parseChecksum(await response.text()), fetch, onProgress });
}

// Put `fresh` where `target` is. A running exe cannot be overwritten on Windows but it can be renamed,
// so the old one is moved aside (it is deleted by whoever runs next, see removeLeftovers) and the new
// one takes its name. If that fails half way the old one is put back.
export async function replaceProgram(fresh, target) {
  const aside = `${target}.old`;
  await fsp.rm(aside, { force: true }).catch(() => {});        // from an update before, if still held by a window
  await fsp.rename(target, aside);
  try {
    await fsp.rename(fresh, target);
  } catch (err) {
    await fsp.rename(aside, target);
    throw err;
  }
  return aside;
}

// What an update leaves beside the program, best effort: the old exe once nothing runs from it, and a
// download that did not finish.
export async function removeLeftovers(target) {
  for (const suffix of ['.old', '.part', '.new']) await fsp.rm(`${target}${suffix}`, { force: true }).catch(() => {});
}
