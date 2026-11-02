// Whether the program is in the app's own folder, and where the app is when it is not. Windows is stood in for by a
// function that says what it would find; the folders are temporary ones.
//
//   node --test tests/placement.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPlacement, findAppFolders, inStartMenu, placementMessage } from '../src/lib/placement.js';

let root;
let app;          // a folder with WuwaTappo.exe in it
let elsewhere;    // a folder without
let other;        // another folder with WuwaTappo.exe in it

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-placement-'));
  app = path.join(root, 'Programs', 'WuwaTappo');
  other = path.join(root, 'Games', 'WuwaTappo');
  elsewhere = path.join(root, 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'WuwaTappo');
  for (const dir of [app, other, elsewhere]) await fs.mkdir(dir, { recursive: true });
  for (const dir of [app, other]) await fs.writeFile(path.join(dir, 'WuwaTappo.exe'), 'x');
  await fs.writeFile(path.join(elsewhere, 'WuwaTappo.lnk'), 'x');
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('beside WuwaTappo.exe is the place, and nothing else is asked', async () => {
  let asked = false;
  const result = await checkPlacement({ dir: app, find: async () => { asked = true; return []; } });
  assert.deepEqual(result, { ok: true, dir: app });
  assert.equal(asked, false);
});

test('a folder without WuwaTappo.exe is not the place, and the Start menu folder of the shortcuts is known for what it is', async () => {
  const result = await checkPlacement({ dir: elsewhere, find: async () => [] });
  assert.equal(result.ok, false);
  assert.equal(result.dir, elsewhere);
  assert.equal(result.startMenu, true);
  assert.deepEqual(result.found, []);

  assert.equal((await checkPlacement({ dir: path.join(root, 'Downloads'), find: async () => [] })).startMenu, false);
  assert.equal(inStartMenu('C:\\Users\\a\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\WuwaTappo'), true);
  assert.equal(inStartMenu('C:\\Users\\a\\AppData\\Roaming\\Microsoft\\Windows\\开始菜单\\程序\\WuwaTappo'), true);
  assert.equal(inStartMenu('E:\\Programs\\WuwaTappo'), false);
});

test('where the app is: the shortcut first, then the running app, then what is installed; each once, and only where the exe really is', async () => {
  const find = async () => [
    { how: 'registry', dir: other },
    { how: 'process', dir: app.toUpperCase() === app ? app : app },
    { how: 'shortcut', dir: app },
    { how: 'registry', dir: path.join(root, 'Gone') },            // an entry for something that is not there any more
  ];
  const result = await checkPlacement({ dir: elsewhere, find });
  assert.deepEqual(result.found.map(entry => [entry.how, entry.dir]), [['shortcut', app], ['registry', other]]);
});

test('a place found twice with another spelling of its letters is one place', async () => {
  const find = async () => [{ how: 'shortcut', dir: app }, { how: 'process', dir: app.toLowerCase() }];
  const result = await checkPlacement({
    dir: elsewhere,
    find,
    exists: async file => path.dirname(file).toLowerCase() === app.toLowerCase(),
  });
  assert.equal(result.found.length, 1);
});

test('a search that fails is no answer, and the person is still told the place is wrong', async () => {
  const result = await checkPlacement({ dir: elsewhere, find: async () => { throw new Error('powershell is gone'); } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.found, []);
});

test('what Windows says is read: one entry, several, none, and what is not JSON', async () => {
  const run = text => async () => text;
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: run('[{"how":"process","dir":"E:\\\\a"}]') }), [{ how: 'process', dir: 'E:\\a' }]);
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: run('{"how":"shortcut","dir":"E:\\\\a"}') }), [{ how: 'shortcut', dir: 'E:\\a' }], 'one entry may come as an object');
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: run('[{"how":"x","dir":""},{"how":"y"}]') }), [], 'entries without a folder are dropped');
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: run('') }), []);
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: run('warning: not json') }), []);
  assert.deepEqual(await findAppFolders({ near: elsewhere, run: async () => { throw new Error('timed out'); } }), []);
});

test('the folder it looks beside is given to PowerShell as a quoted string, apostrophes included', async () => {
  let script = '';
  await findAppFolders({ near: "C:\\Users\\O'Brien\\Start Menu", run: async text => { script = text; return '[]'; } });
  assert.match(script, /\$dir = 'C:\\Users\\O''Brien\\Start Menu'/);
});

test('the message says what is wrong and where the app is, and when it cannot say where, what to do', async () => {
  const wrong = await checkPlacement({ dir: elsewhere, find: async () => [{ how: 'shortcut', dir: app }] });
  const text = placementMessage(wrong);
  assert.match(text, /is not in .*Start Menu/);
  assert.match(text, /shortcuts are, not the app/);
  assert.ok(text.includes(`put it in ${app}`));

  const lost = await checkPlacement({ dir: path.join(root, 'Downloads'), find: async () => [] });
  assert.doesNotMatch(placementMessage(lost), /put it in /);
  assert.match(placementMessage(lost), /beside WuwaTappo\.exe/);

  assert.match(placementMessage({ ok: true, dir: app }), /is in/);
});
