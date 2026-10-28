// Asking GitHub for the latest release, downloading it, and putting it in place of the running program.
// GitHub is stood in for by a fetch that answers what it answers (checked by hand against the real
// thing: a repository with a release redirects /releases/latest to /releases/tag/<tag>, one with none to
// /releases); the files are in a temporary folder.
//
//   node --test tests/release.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { progressWriter } from '../src/commands/update.js';
import { compareVersions, downloadVerified, downloadRelease, latestRelease, parseChecksum, removeLeftovers, replaceProgram } from '../src/lib/release.js';
import { write } from './app-helpers.js';

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-release-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const redirect = location => new Response(null, { status: 302, headers: { location } });

// --- is there a newer one ---------------------------------------------------------------------

test('the latest release is the tag the redirect points at, asked without the API', async () => {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push([url, options.redirect]);
    return redirect('https://github.com/Yueby/wuwatappo-modkit/releases/tag/v1.2.3');
  };
  assert.deepEqual(await latestRelease({ repo: 'Yueby/wuwatappo-modkit', fetch }), { tag: 'v1.2.3', version: '1.2.3' });
  assert.deepEqual(seen, [['https://github.com/Yueby/wuwatappo-modkit/releases/latest', 'manual']], 'the redirect is read, not followed');
});

test('no release yet is null, not an error; a tag that is not a version is not a release of ours', async () => {
  assert.equal(await latestRelease({ fetch: async () => redirect('https://github.com/x/y/releases') }), null);
  assert.equal(await latestRelease({ fetch: async () => redirect('https://github.com/x/y/releases/tag/nightly') }), null);
});

test('a repository that is not there, or GitHub failing, is an error with what was said', async () => {
  await assert.rejects(latestRelease({ repo: 'a/b', fetch: async () => new Response('', { status: 404 }) }), /a\/b not found/);
  await assert.rejects(latestRelease({ fetch: async () => new Response('', { status: 503 }) }), /answered 503/);
  await assert.rejects(latestRelease({ fetch: async () => { throw new Error('offline'); } }), /offline/);
});

test('versions are compared as numbers, not as text', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.throws(() => compareVersions('nightly', '1.0.0'), /not versions/);
});

// --- the download -----------------------------------------------------------------------------

function release(bytes, { checksum = sha(bytes), length = bytes.length, status = 200 } = {}) {
  const requested = [];
  const fetch = async url => {
    requested.push(url);
    if (url.endsWith('.sha256')) return new Response(checksum === null ? '' : `${checksum}  modkit.exe\n`, { status });
    return new Response(bytes, { status, headers: { 'content-length': String(length) } });
  };
  return { fetch, requested };
}

const fresh = () => path.join(root, `case-${++counter}`);

test('the checksum is read from what sha256sum or certutil print', () => {
  const hash = 'A'.repeat(64);
  assert.equal(parseChecksum(`${hash}  modkit.exe\n`), 'a'.repeat(64));
  assert.equal(parseChecksum(`SHA256 hash of x:\r\n${'b'.repeat(64)}\r\nCertUtil: done`), 'b'.repeat(64));
  assert.throws(() => parseChecksum('no hash here'), /no SHA-256/);
  assert.throws(() => parseChecksum('abc123'), /no SHA-256/);
});

test('a download that matches its checksum is kept, and both files come from the tag\'s own address', async () => {
  const dir = fresh();
  const bytes = Buffer.from('the new program');
  const { fetch, requested } = release(bytes);
  const file = path.join(dir, 'modkit.exe.new');
  await fs.mkdir(dir);

  assert.equal(await downloadRelease('v2.0.0', file, { repo: 'o/r', fetch }), sha(bytes));
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.deepEqual(requested, [
    'https://github.com/o/r/releases/download/v2.0.0/modkit.exe.sha256',
    'https://github.com/o/r/releases/download/v2.0.0/modkit.exe',
  ]);
  assert.deepEqual(await fs.readdir(dir), ['modkit.exe.new'], 'no partial file left beside it');
});

test('a download that does not match is thrown away, and so is one that stopped short', async () => {
  const dir = fresh();
  await fs.mkdir(dir);
  const file = path.join(dir, 'modkit.exe.new');

  await assert.rejects(downloadRelease('v2', file, { fetch: release(Buffer.from('tampered'), { checksum: sha(Buffer.from('original')) }).fetch }), /does not match its checksum/);
  await assert.rejects(downloadRelease('v2', file, { fetch: release(Buffer.from('cut'), { length: 999 }).fetch }), /stopped at 3 of 999/);
  assert.deepEqual(await fs.readdir(dir), [], 'nothing left, neither the file nor the part');
});

test('no checksum, a checksum that is not one, or a missing file is no download', async () => {
  const dir = fresh();
  await fs.mkdir(dir);
  const file = path.join(dir, 'x.new');
  await assert.rejects(downloadRelease('v2', file, { fetch: release(Buffer.from('a'), { checksum: null }).fetch }), /no SHA-256/);
  await assert.rejects(downloadRelease('v2', file, { fetch: release(Buffer.from('a'), { status: 404 }).fetch }), /answered 404/);
  assert.deepEqual(await fs.readdir(dir), []);
});

// --- putting it in place ---------------------------------------------------------------------------

test('the new program takes the old one\'s name, and the old one is kept beside it until nothing runs from it', async () => {
  const dir = fresh();
  await write(path.join(dir, 'modkit.exe'), 'old');
  await write(path.join(dir, 'modkit.exe.new'), 'new');

  const aside = await replaceProgram(path.join(dir, 'modkit.exe.new'), path.join(dir, 'modkit.exe'));

  assert.equal(await fs.readFile(path.join(dir, 'modkit.exe'), 'utf8'), 'new');
  assert.equal(await fs.readFile(aside, 'utf8'), 'old');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['modkit.exe', 'modkit.exe.old']);

  await write(path.join(dir, 'modkit.exe.part'), 'half');
  await removeLeftovers(path.join(dir, 'modkit.exe'));
  assert.deepEqual(await fs.readdir(dir), ['modkit.exe'], 'what an update leaves is cleaned up');
  await removeLeftovers(path.join(dir, 'modkit.exe'));                  // nothing to remove is fine
});

test('an old leftover from the update before does not stop the next one', async () => {
  const dir = fresh();
  await write(path.join(dir, 'modkit.exe'), 'two');
  await write(path.join(dir, 'modkit.exe.old'), 'one');
  await write(path.join(dir, 'modkit.exe.new'), 'three');

  await replaceProgram(path.join(dir, 'modkit.exe.new'), path.join(dir, 'modkit.exe'));

  assert.equal(await fs.readFile(path.join(dir, 'modkit.exe'), 'utf8'), 'three');
  assert.equal(await fs.readFile(path.join(dir, 'modkit.exe.old'), 'utf8'), 'two');
});

test('if the new program cannot be moved in, the old one is put back and the failure is said', async () => {
  const dir = fresh();
  await write(path.join(dir, 'modkit.exe'), 'old');

  await assert.rejects(replaceProgram(path.join(dir, 'does-not-exist.new'), path.join(dir, 'modkit.exe')));

  assert.equal(await fs.readFile(path.join(dir, 'modkit.exe'), 'utf8'), 'old', 'still there, still the old one');
  assert.deepEqual(await fs.readdir(dir), ['modkit.exe']);
});

// --- the version it says -------------------------------------------------------------------------

test('--version prints the version in package.json, which is where it is written', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(import.meta.dirname, '..', 'src', 'cli.js'), '--version']);
  const { version } = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.equal(stdout.trim(), version);
});

// --- progress ---------------------------------------------------------------------------------------------

test('a download says how far it is, ends on all of it, and knows the total from the server or else from what it was told', async () => {
  const bytes = Buffer.alloc(300_000, 7);
  const body = () => new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 100_000) controller.enqueue(bytes.subarray(i, i + 100_000)); controller.close(); } });
  const file = path.join(root, `progress-${++counter}.bin`);

  const seen = [];
  await downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), size: bytes.length, fetch: async () => new Response(body(), { headers: { 'content-length': String(bytes.length) } }), onProgress: (received, total) => seen.push([received, total]) });
  assert.deepEqual(seen.at(-1), [bytes.length, bytes.length], 'the last word is all of it');
  assert.ok(seen.every(([received, total], i) => total === bytes.length && (i === 0 || received >= seen[i - 1][0])), 'the total is the server\'s, and it only goes forward');

  const told = [];
  await downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), size: bytes.length, fetch: async () => new Response(body()), onProgress: (received, total) => told.push(total) });
  assert.ok(told.every(total => total === bytes.length), 'no length from the server: the one it was told');

  const unknown = [];
  await downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), fetch: async () => new Response(body()), onProgress: (received, total) => unknown.push(total) });
  assert.ok(unknown.every(total => total === 0), 'neither: 0, so that whoever shows it does not invent a percentage');
});

test('what the update command says while it downloads: lines for a window that asked, a rewritten line for a terminal, nothing for a pipe', () => {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = text => { lines.push(String(text).trimEnd()); return true; };
  try {
    progressWriter({ machine: true })(26214400, 104857600);
  } finally {
    process.stdout.write = original;
  }
  assert.deepEqual(lines, ['progress 26214400 104857600']);

  const written = [];
  const terminal = { isTTY: true, write: text => written.push(text) };
  progressWriter({ machine: false, stream: terminal })(26214400, 104857600);
  assert.match(written[0], /^\r\s+25\.0 \/ 100\.0 MB\s+25%/);
  progressWriter({ machine: false, stream: terminal })(5242880, 0);
  assert.match(written[1], /5\.0 MB/, 'no total: no percentage');

  assert.equal(progressWriter({ machine: false, stream: { isTTY: false, write() {} } }), null, 'a pipe that did not ask hears nothing');
});

test('a download that goes quiet is given up, wherever it stalls, and leaves nothing; one that keeps coming is not', async () => {
  const file = path.join(root, `stall-${++counter}.bin`);
  const bytes = Buffer.alloc(1000, 3);

  // Quiet from the start: the fetch itself never answers (it hears of the abort, as a real one does).
  const silent = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await assert.rejects(downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), fetch: silent, idleMs: 80 }), /nothing came from/);

  // Quiet half way: some of the body comes, and then no more.
  const half = (url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 400));
      signal.addEventListener('abort', () => controller.error(signal.reason));
    },
  }));
  await assert.rejects(downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), fetch: half, idleMs: 80 }), /nothing came from/);
  assert.deepEqual((await fs.readdir(root)).filter(name => name.startsWith('stall-')), [], 'neither the file nor its part is left');

  // Slow but steady: longer in all than the limit, with something coming inside it each time.
  const steady = () => new Response(new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 5; i++) {
        controller.enqueue(bytes.subarray(i * 200, (i + 1) * 200));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      controller.close();
    },
  }));
  assert.equal(await downloadVerified('https://github.com/x/y/z', file, { expected: sha(bytes), fetch: steady, idleMs: 120 }), sha(bytes));
});
