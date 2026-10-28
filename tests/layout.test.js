// Where things go in the app folder, and putting them there. Everything happens in a temporary folder,
// never in the real app folder.   node --test tests/layout.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureFolders, installLoaderCopy, removeLoaderCopy } from '../src/lib/layout.js';
import { EXAMPLES_DIR, INSTALL_DIR, LOCK_FILE, LOG_FILE, MODS_DIR, MOD_DATA_DIR, resolveInstallDir } from '../src/lib/paths.js';
import { readMarker } from '../src/lib/patch.js';
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
  assert.notEqual(path.resolve(EXAMPLES_DIR), path.resolve(MODS_DIR), 'the examples are not what runs');
});

test('the app folder: the environment wins, a packaged loader is in it, otherwise this machine\'s default', () => {
  assert.equal(resolveInstallDir({ env: { WUWA_INSTALL_DIR: 'D:\\Games\\Tappo' }, packaged: true, execPath: 'C:\\x\\modkit.exe' }), 'D:\\Games\\Tappo');
  assert.equal(resolveInstallDir({ env: {}, packaged: true, execPath: 'E:\\Programs\\WuwaTappo\\modkit.exe' }), 'E:\\Programs\\WuwaTappo');
  assert.equal(resolveInstallDir({ env: {}, packaged: false, execPath: 'C:\\node\\node.exe' }), 'E:\\Programs\\WuwaTappo');
  // The loader runs from a copy of the exe inside the app folder, and still means the app folder.
  assert.equal(resolveInstallDir({ env: {}, packaged: true, execPath: 'E:\\Programs\\WuwaTappo\\moddata\\.modkit\\modkit-loader.exe' }), 'E:\\Programs\\WuwaTappo');
  assert.equal(resolveInstallDir({ env: {}, packaged: true, execPath: 'D:\\x\\.modkit\\modkit.exe' }), 'D:\\x\\.modkit', 'a folder that is only called .modkit is not the loader\'s');
});

// --- the folders ---------------------------------------------------------

test('the folders are made, and making them again changes nothing', async () => {
  const dir = fresh();
  const dirs = [path.join(dir, 'mods'), path.join(dir, 'moddata'), path.join(dir, 'moddata', '.modkit')];
  assert.deepEqual((await ensureFolders({ dirs })).map(d => path.basename(d)), ['mods', 'moddata', '.modkit']);
  assert.deepEqual(await listing(path.join(dir, 'mods')), [], 'and they start empty: the program brings no mods');
  await write(path.join(dir, 'moddata', 'keep.txt'), 'kept');
  assert.deepEqual(await ensureFolders({ dirs }), [], 'nothing was made the second time');
  assert.deepEqual(await listing(path.join(dir, 'moddata')), ['.modkit', 'keep.txt']);
});

// --- the loader's own copy of the program -------------------------------------------------

test('the loader runs from a copy, so the program in the app folder is never the one in use', async () => {
  const dir = fresh();
  const program = path.join(dir, 'modkit.exe');
  const copy = path.join(dir, 'moddata', '.modkit', 'modkit-loader.exe');
  await write(program, 'version one');

  assert.deepEqual(await installLoaderCopy({ from: program, to: copy }), { path: copy, copied: true });
  assert.equal(await fs.readFile(copy, 'utf8'), 'version one');

  await write(program, 'version two');                                         // a new version put over the program
  await installLoaderCopy({ from: program, to: copy });
  assert.equal(await fs.readFile(copy, 'utf8'), 'version two', 'and the next setup brings the copy up to date');

  assert.deepEqual(await installLoaderCopy({ from: copy, to: copy }), { path: copy, copied: false }, 'the copy is not copied onto itself');
  await removeLoaderCopy({ file: copy });
  await assert.rejects(fs.stat(copy));
  await removeLoaderCopy({ file: copy });                                      // twice is fine
});

// --- the marker of a patch ----------------------------------------------------------------------

test('the patch marker is read under its new name, and under the old one from before the rename', async () => {
  const dir = fresh();
  const file = path.join(dir, '.wuwatappo-modkit.json');
  const legacy = path.join(dir, '.wuwa-modkit.json');
  assert.equal(await readMarker({ file, legacy }), null, 'none at all');

  await write(legacy, JSON.stringify({ sha256: 'old' }));
  assert.equal((await readMarker({ file, legacy })).sha256, 'old', 'an old one still says the exe is patched');

  await write(file, JSON.stringify({ sha256: 'new' }));
  assert.equal((await readMarker({ file, legacy })).sha256, 'new', 'the new name wins');
});
