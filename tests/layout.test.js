// Where things go in the app folder, and putting them there. Everything happens in a temporary folder,
// never in the real app folder.   node --test tests/layout.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureFolders, installBundledMods, moveLegacyData } from '../src/lib/layout.js';
import { BUNDLED_MODS_DIR, INSTALL_DIR, LOCK_FILE, LOG_FILE, MODS_DIR, MOD_DATA_DIR, resolveInstallDir } from '../src/lib/paths.js';
import { write } from './app-helpers.js';

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-layout-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const fresh = () => path.join(root, `case-${++counter}`);
const listing = async dir => (await fs.readdir(dir)).sort();

// --- paths -----------------------------------------------------------------------------

test('the mods and their data are in the app folder, and the loader\'s own files are under a name no mod can have', () => {
  assert.equal(MODS_DIR, path.join(INSTALL_DIR, 'mods'));
  assert.equal(MOD_DATA_DIR, path.join(INSTALL_DIR, 'moddata'));
  for (const file of [LOCK_FILE, LOG_FILE]) {
    assert.equal(path.dirname(file), path.join(MOD_DATA_DIR, '.modkit'));
  }
  assert.notEqual(path.resolve(BUNDLED_MODS_DIR), path.resolve(MODS_DIR), 'what ships is not what runs');
});

test('the app folder: the environment wins, a packaged loader is in it, otherwise this machine\'s default', () => {
  assert.equal(resolveInstallDir({ env: { WUWA_INSTALL_DIR: 'D:\\Games\\Tappo' }, packaged: true, execPath: 'C:\\x\\modkit.exe' }), 'D:\\Games\\Tappo');
  assert.equal(resolveInstallDir({ env: {}, packaged: true, execPath: 'E:\\Programs\\WuwaTappo\\modkit.exe' }), 'E:\\Programs\\WuwaTappo');
  assert.equal(resolveInstallDir({ env: {}, packaged: false, execPath: 'C:\\node\\node.exe' }), 'E:\\Programs\\WuwaTappo');
});

// --- the folders and what ships ---------------------------------------------------------

test('the folders are made, and making them again changes nothing', async () => {
  const dir = fresh();
  const dirs = [path.join(dir, 'mods'), path.join(dir, 'moddata'), path.join(dir, 'moddata', '.modkit')];
  await ensureFolders({ dirs });
  await write(path.join(dir, 'moddata', 'keep.txt'), 'kept');
  await ensureFolders({ dirs });
  assert.deepEqual(await listing(path.join(dir, 'moddata')), ['.modkit', 'keep.txt']);
});

test('what ships is added when missing and never overwrites what is there', async () => {
  const dir = fresh();
  const from = path.join(dir, 'bundled');
  const to = path.join(dir, 'mods');
  await write(path.join(from, 'alpha', 'package.json'), '{"name":"alpha","version":"2.0.0"}');
  await write(path.join(from, 'beta', 'package.json'), '{"name":"beta"}');
  await write(path.join(from, '_template', 'package.json'), '{}');
  await write(path.join(from, '.hidden', 'x'), 'x');
  await write(path.join(to, 'alpha', 'package.json'), '{"name":"alpha","version":"1.0.0-mine"}');   // the user's own, changed

  const first = await installBundledMods({ from, to });
  assert.deepEqual(first.installed.sort(), ['_template', 'beta']);
  assert.deepEqual(first.kept, ['alpha']);
  assert.match(await fs.readFile(path.join(to, 'alpha', 'package.json'), 'utf8'), /1\.0\.0-mine/, 'a mod that is there is left alone, even if the shipped one is newer');
  assert.deepEqual(await listing(to), ['_template', 'alpha', 'beta'], 'hidden entries are not shipped');

  const second = await installBundledMods({ from, to });
  assert.deepEqual([second.installed, second.kept.sort()], [[], ['_template', 'alpha', 'beta']], 'again: nothing to do');
});

test('developing inside the mods folder itself copies nothing onto itself', async () => {
  const dir = fresh();
  await write(path.join(dir, 'mods', 'alpha', 'package.json'), '{}');
  assert.deepEqual(await installBundledMods({ from: path.join(dir, 'mods'), to: path.join(dir, 'mods') }), { installed: [], kept: [] });
});

// --- data from the old place -------------------------------------------------------------

test('a mod\'s data is moved to its folder in moddata; one that already has data there is left, and the old kept', async () => {
  const dir = fresh();
  const from = path.join(dir, 'work', 'mod-data');
  const to = path.join(dir, 'moddata');
  await write(path.join(from, 'journal', 'clicks.csv'), '1,2\n');
  await write(path.join(from, 'journal', 'deep', 'more.txt'), 'x');
  await write(path.join(from, 'notes', 'notes.txt'), 'old');
  await write(path.join(from, 'stray-file.txt'), 'not a mod folder');
  await write(path.join(to, 'notes', 'notes.txt'), 'new');

  const result = await moveLegacyData({ from, to });

  assert.deepEqual([result.moved, result.skipped], [['journal'], ['notes']]);
  assert.equal(await fs.readFile(path.join(to, 'journal', 'clicks.csv'), 'utf8'), '1,2\n');
  assert.equal(await fs.readFile(path.join(to, 'journal', 'deep', 'more.txt'), 'utf8'), 'x');
  await assert.rejects(fs.stat(path.join(from, 'journal')), 'moved, not copied: no second copy to drift');
  assert.equal(await fs.readFile(path.join(to, 'notes', 'notes.txt'), 'utf8'), 'new', 'what was there is not touched');
  assert.equal(await fs.readFile(path.join(from, 'notes', 'notes.txt'), 'utf8'), 'old', 'and the old one is kept, so nothing is lost');

  assert.deepEqual(await moveLegacyData({ from, to }), { moved: [], skipped: ['notes'] }, 'again: nothing more to move');
});

test('no old data at all is not an error', async () => {
  const dir = fresh();
  assert.deepEqual(await moveLegacyData({ from: path.join(dir, 'nowhere'), to: path.join(dir, 'moddata') }), { moved: [], skipped: [] });
});
