// The plugin registry: reading its index, taking a plugin from it, and checking a folder. GitHub is stood
// in for by a fetch that serves an index and zips made here with the system's tar; the folders are
// temporary ones.
//
//   node --test tests/registry.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { InstallDeclined, checkMod, installMod, readSource, run } from '../src/lib/install.js';
import { REGISTRY_REPO, browse, fetchIndex, getFromRegistry, indexUrl, parseIndex, updateFromRegistry } from '../src/lib/registry.js';
import { write } from './app-helpers.js';

const exec = promisify(execFile);
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
const REPO = REGISTRY_REPO;

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-registry-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const fresh = async () => {
  const dir = path.join(root, `case-${++counter}`);
  await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
  return { dir, mods: path.join(dir, 'mods') };
};

// A plugin's folder, as an author would write it.
async function plugin(dir, id, version = '1.0.0', modkit = {}) {
  const folder = path.join(dir, 'src', id);
  await write(path.join(folder, 'package.json'), JSON.stringify({
    name: id, version, displayName: `The ${id}`, description: `what ${id} does`, modkit: { windows: { main: 'main.js' }, ...modkit },
  }));
  await write(path.join(folder, 'main.js'), 'return 1;');
  return folder;
}

// A zip of it, the way the registry's automation makes one, and the index entry that goes with it.
async function release(dir, folder, extra = {}) {
  const id = path.basename(folder);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const zip = path.join(dir, `${id}-${manifest.version}.zip`);
  await exec(tar, ['-a', '-cf', zip, '-C', folder, '.']);
  const bytes = await fs.readFile(zip);
  const entry = {
    id, name: manifest.displayName, description: manifest.description, version: manifest.version,
    nodePart: false, permissions: [], requires: {}, dependencies: [],
    url: `https://github.com/${REPO}/releases/download/${id}-v${manifest.version}/${id}-${manifest.version}.zip`,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    ...extra,
  };
  return { entry, bytes };
}

// What GitHub would answer: the index, and the files the entries point at.
function github(releases, { indexText = null } = {}) {
  const files = new Map(releases.map(({ entry, bytes }) => [entry.url, bytes]));
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    if (url === indexUrl(REPO)) return new Response(indexText ?? JSON.stringify({ formatVersion: 1, mods: releases.map(r => r.entry) }));
    if (files.has(url)) return new Response(files.get(url), { headers: { 'content-length': String(files.get(url).length) } });
    return new Response('', { status: 404 });
  };
  return { fetch, asked };
}

const ids = async mods => (await fs.readdir(mods)).sort();

// --- the index ----------------------------------------------------------------------------------

const goodEntry = () => ({
  id: 'auto-click', name: 'Auto click', description: 'clicks', version: '1.0.0', nodePart: false, permissions: [], requires: {}, dependencies: [],
  url: `https://github.com/${REPO}/releases/download/auto-click-v1.0.0/auto-click-1.0.0.zip`, sha256: 'a'.repeat(64), size: 10,
});
const indexOf = (...mods) => JSON.stringify({ formatVersion: 1, mods });

test('a good index is read, and optional fields are filled in', () => {
  const { entries, problems } = parseIndex(indexOf(goodEntry()));
  assert.deepEqual(problems, []);
  assert.equal(entries[0].id, 'auto-click');
  assert.equal(entries[0].author, null);
});

test('an entry that is not fit is left out with its reason, and the others are kept', () => {
  const bad = (change) => ({ ...goodEntry(), id: 'bad', ...change });
  const cases = [
    [{ url: 'https://evil.example/x.zip' }, /not a release asset/],
    [{ url: `https://github.com/someone-else/repo/releases/download/t/x.zip` }, /not a release asset/],
    [{ url: `https://github.com/${REPO}/releases/download/../../x.zip` }, /not a release asset/],
    [{ sha256: 'xyz' }, /no SHA-256/],
    [{ size: 0 }, /no size/],
    [{ version: 'next' }, /not one/],
    [{ id: '../up' }, /no usable id/],
    [{ nodePart: 'yes' }, /Node part/],
    [{ permissions: 'network' }, /permissions/],
  ];
  for (const [change, why] of cases) {
    const { entries, problems } = parseIndex(indexOf(goodEntry(), bad(change)));
    assert.deepEqual(entries.map(e => e.id), ['auto-click'], JSON.stringify(change));
    assert.match(problems[0], why, JSON.stringify(change));
  }
  const twice = parseIndex(indexOf(goodEntry(), goodEntry()));
  assert.match(twice.problems[0], /listed twice/);
});

test('an index that is not JSON, or in a format from the future, is refused outright', () => {
  assert.throws(() => parseIndex('<html>'), /not JSON/);
  assert.throws(() => parseIndex(JSON.stringify({ formatVersion: 2, mods: [] })), /update the program/);
  assert.throws(() => parseIndex(JSON.stringify({ mods: [] })), /formatVersion/);
});

test('the index is fetched from the registry\'s own release, and a missing one is said', async () => {
  const seen = [];
  const ok = await fetchIndex({ fetch: async url => { seen.push(url); return new Response(indexOf(goodEntry())); } });
  assert.equal(ok.entries.length, 1);
  assert.deepEqual(seen, [`https://github.com/${REPO}/releases/download/index/index.json`]);
  await assert.rejects(fetchIndex({ fetch: async () => new Response('', { status: 404 }) }), /no index yet/);
  await assert.rejects(fetchIndex({ fetch: async () => { throw new Error('offline'); } }), /could not reach.*offline/);
});

// --- taking a plugin ------------------------------------------------------------------------------

test('a plugin is downloaded, checked against the index, shown, and put in place, remembered as from the registry', async () => {
  const { dir, mods } = await fresh();
  const rel = await release(dir, await plugin(dir, 'alpha', '1.2.0'));
  const { fetch } = github([rel]);
  const asked = [];

  const done = await getFromRegistry('alpha', { modsDir: mods, fetch, confirm: async info => { asked.push([info.id, info.version, info.entry.sha256 === rel.entry.sha256, await ids(mods)]); return true; } });

  assert.deepEqual(asked, [['alpha', '1.2.0', true, []]], 'asked with the package\'s own declaration, before anything was on disk');
  assert.equal(done.target, path.join(mods, 'alpha'));
  assert.deepEqual(await ids(mods), ['alpha']);
  assert.deepEqual(await readSource(path.join(mods, 'alpha')).then(s => [s.type, s.spec, s.version]), ['registry', 'alpha', '1.2.0']);
});

test('a no installs nothing', async () => {
  const { dir, mods } = await fresh();
  const rel = await release(dir, await plugin(dir, 'alpha'));
  await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch: github([rel]).fetch, confirm: async () => false }), InstallDeclined);
  assert.deepEqual(await ids(mods), []);
});

test('a download that is not what the index hashes is thrown away before it is looked at', async () => {
  const { dir, mods } = await fresh();
  const rel = await release(dir, await plugin(dir, 'alpha'));
  const tampered = { entry: rel.entry, bytes: Buffer.concat([rel.bytes.subarray(0, rel.bytes.length - 1), Buffer.from('!')]) };
  let asked = false;
  await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch: github([tampered]).fetch, confirm: async () => { asked = true; return true; } }), /does not match its checksum/);
  assert.equal(asked, false);
  assert.deepEqual(await ids(mods), []);
});

test('a size that is not the one in the index is refused too', async () => {
  const { dir, mods } = await fresh();
  const rel = await release(dir, await plugin(dir, 'alpha'));
  rel.entry.size += 1;
  await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch: github([rel]).fetch }), /bytes, not the/);
});

test('a package that is not the plugin the index says is refused, and is never shown to the person', async () => {
  const { dir, mods } = await fresh();
  // The index says "alpha" 1.0.0, and the zip holds "beta".
  const beta = await release(dir, await plugin(dir, 'beta'));
  const lie = { entry: { ...beta.entry, id: 'alpha' }, bytes: beta.bytes };
  let asked = false;
  await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch: github([lie]).fetch, confirm: async () => { asked = true; return true; } }), /is called "beta", not "alpha"/);
  assert.equal(asked, false);

  // And the right plugin at a version other than the one listed.
  const old = await release(dir, await plugin(dir, 'gamma', '1.0.0'));
  const newer = { entry: { ...old.entry, version: '2.0.0' }, bytes: old.bytes };
  await assert.rejects(getFromRegistry('gamma', { modsDir: mods, fetch: github([newer]).fetch }), /is version 1\.0\.0, not 2\.0\.0/);
  assert.deepEqual(await ids(mods), []);
});

test('a package that declares more than the index says (a Node part, permissions, dependencies) is refused', async () => {
  const { dir, mods } = await fresh();
  const folder = await plugin(dir, 'alpha', '1.0.0', { host: 'host.js', permissions: ['files'] });
  await write(path.join(folder, 'host.js'), 'export default () => {};');
  const raw = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  await write(path.join(folder, 'package.json'), JSON.stringify({ ...raw, type: 'module', dependencies: { left: '1.0.0' } }));
  const honest = await release(dir, folder, { nodePart: true, permissions: ['files'], dependencies: ['left'] });
  let asked = 0;
  const confirm = async () => { asked += 1; return true; };

  // The index leaves things out, as a compromised one would to make a plugin look harmless.
  for (const lie of [{ nodePart: false }, { permissions: [] }, { dependencies: [] }]) {
    const rel = { entry: { ...honest.entry, ...lie }, bytes: honest.bytes };
    await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch: github([rel]).fetch, confirm }), /declares something other than the index says/, JSON.stringify(lie));
  }
  assert.equal(asked, 0, 'nobody was asked about it');
  assert.deepEqual(await ids(mods), []);

  // Said as it is, it goes through. (npm is stood in for: nothing is fetched for the dependency.)
  const tools = { npmCli: process.execPath, run: (command, args, options) => (command === process.execPath ? '' : run(command, args, options)) };
  await getFromRegistry('alpha', { modsDir: mods, fetch: github([honest]).fetch, confirm, tools });
  assert.equal(asked, 1, 'and then it is asked about');
  assert.deepEqual(await ids(mods), ['alpha']);
});

test('a name the registry does not have is said, and a plugin already installed needs --force or an update', async () => {
  const { dir, mods } = await fresh();
  const rel = await release(dir, await plugin(dir, 'alpha'));
  const { fetch } = github([rel]);
  await assert.rejects(getFromRegistry('nothing', { modsDir: mods, fetch }), /no plugin called "nothing"/);
  await getFromRegistry('alpha', { modsDir: mods, fetch });
  await assert.rejects(getFromRegistry('alpha', { modsDir: mods, fetch }), /already installed/);
  await getFromRegistry('alpha', { modsDir: mods, fetch, force: true });
});

// --- what is here and what is there ------------------------------------------------------------------

test('browse says what is installed, what came from the registry, and where there is a newer version', async () => {
  const { dir, mods } = await fresh();
  const v1 = await release(dir, await plugin(dir, 'alpha', '1.0.0'));
  await getFromRegistry('alpha', { modsDir: mods, fetch: github([v1]).fetch });
  await installMod(await plugin(dir, 'mine', '3.0.0'), { modsDir: mods });                   // from a folder, not the registry
  const current = await release(dir, await plugin(dir, 'current', '1.0.0'));
  await getFromRegistry('current', { modsDir: mods, fetch: github([current]).fetch });         // from the registry, and up to date

  const v2 = await release(dir, await plugin(dir, 'alpha', '1.1.0'));
  const mineToo = await release(dir, await plugin(dir, 'mine', '9.0.0'));
  const other = await release(dir, await plugin(dir, 'other', '1.0.0'));
  const { entries } = await browse({ modsDir: mods, fetch: github([v2, mineToo, other, current]).fetch });

  const by = Object.fromEntries(entries.map(e => [e.id, e]));
  assert.deepEqual([by.alpha.installed, by.alpha.installedVersion, by.alpha.fromRegistry, by.alpha.update], [true, '1.0.0', true, true]);
  assert.deepEqual([by.mine.installed, by.mine.fromRegistry, by.mine.update], [true, false, false], 'one installed from elsewhere is not offered an update from here');
  assert.deepEqual([by.other.installed, by.other.update], [false, false]);
  assert.deepEqual([by.current.installed, by.current.fromRegistry, by.current.update], [true, true, false], 'the same version is not an update');
});

test('an update takes a newer version and leaves a current one alone', async () => {
  const { dir, mods } = await fresh();
  const v1 = await release(dir, await plugin(dir, 'alpha', '1.0.0'));
  await getFromRegistry('alpha', { modsDir: mods, fetch: github([v1]).fetch });

  const same = await updateFromRegistry('alpha', { modsDir: mods, fetch: github([v1]).fetch });
  assert.deepEqual([same.unchanged, same.version], [true, '1.0.0']);

  const v2 = await release(dir, await plugin(dir, 'alpha', '1.1.0'));
  const seen = [];
  const updated = await updateFromRegistry('alpha', { modsDir: mods, fetch: github([v2]).fetch, confirm: async info => { seen.push(info.version); return true; } });
  assert.deepEqual([updated.unchanged, updated.before, updated.version, seen], [false, '1.0.0', '1.1.0', ['1.1.0']]);
  assert.equal(JSON.parse(await fs.readFile(path.join(mods, 'alpha', 'package.json'), 'utf8')).version, '1.1.0');
  assert.deepEqual((await readSource(path.join(mods, 'alpha'))).type, 'registry', 'and it is still from the registry');
});

test('a plugin from somewhere else cannot be updated from the registry', async () => {
  const { dir, mods } = await fresh();
  await installMod(await plugin(dir, 'mine'), { modsDir: mods });
  await assert.rejects(updateFromRegistry('mine', { modsDir: mods, fetch: github([]).fetch }), /did not come from the registry/);
});

// --- checking a folder ------------------------------------------------------------------------------

test('a folder that can be loaded is ok, and says what it declares', async () => {
  const { dir } = await fresh();
  const folder = await plugin(dir, 'alpha', '1.0.0', { permissions: ['network'] });
  const result = await checkMod(folder, { registry: true });
  assert.deepEqual([result.ok, result.id, result.version, result.permissions, result.nodePart], [true, 'alpha', '1.0.0', ['network'], false]);
});

test('a folder that cannot be loaded says why: a missing file, a name that is not the folder\'s, a Node part without "type": "module"', async () => {
  const { dir } = await fresh();
  const missing = await plugin(dir, 'alpha', '1.0.0', { windows: { main: 'gone.js' } });
  assert.match((await checkMod(missing)).problems.join('\n'), /gone\.js is named in package\.json but is not in the folder/);

  const renamed = await plugin(dir, 'beta');
  const raw = JSON.parse(await fs.readFile(path.join(renamed, 'package.json'), 'utf8'));
  await write(path.join(renamed, 'package.json'), JSON.stringify({ ...raw, name: 'other' }));
  assert.match((await checkMod(renamed)).problems.join('\n'), /must match the folder name "beta"/);

  const host = await plugin(dir, 'gamma', '1.0.0', { host: 'host.js' });
  await write(path.join(host, 'host.js'), 'export default () => {};');
  assert.match((await checkMod(host)).problems.join('\n'), /"type": "module"/);

  assert.match((await checkMod(path.join(dir, 'nowhere'))).problems[0], /there is none/);
});

test('for the registry a plugin also needs a version and a description, and no node_modules', async () => {
  const { dir } = await fresh();
  const folder = path.join(dir, 'src', 'bare');
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'bare', modkit: { windows: { main: 'main.js' } } }));
  await write(path.join(folder, 'main.js'), '');
  await write(path.join(folder, 'node_modules', 'x', 'index.js'), '');

  assert.equal((await checkMod(folder)).ok, true, 'fine to load');
  const problems = (await checkMod(folder, { registry: true })).problems.join('\n');
  assert.match(problems, /version must be a version number/);
  assert.match(problems, /description is empty/);
  assert.match(problems, /node_modules is in the folder/);
});
