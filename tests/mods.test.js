// Offline tests: manifests, how mods are found on disk, and that the code generated for the
// page parses. Needs neither the app nor DevTools.   node --test tests/mods.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ManifestError, parseManifest } from '../src/lib/manifest.js';
import { discoverCore, discoverMods, unitFor } from '../src/lib/mods.js';
import { compileCore, compileMod } from '../src/lib/page-scripts.js';
import { MODS_DIR } from '../src/lib/paths.js';

const problemsOf = (raw, folder = 'demo') => {
  try {
    parseManifest(raw, folder);
  } catch (err) {
    if (err instanceof ManifestError) return err.problems;
    throw err;
  }
  return [];
};

test('a manifest with nothing but settings gets the defaults', () => {
  const { manifest, scripts } = parseManifest({}, 'demo');
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.name, 'demo');
  assert.equal(manifest.defaultEnabled, true);
  assert.deepEqual(manifest.settings, []);
  assert.deepEqual(scripts, { '*': 'index.js' });
});

test('settings are normalised and persist by default', () => {
  const { manifest } = parseManifest({
    settings: [
      { key: 'on', type: 'toggle', title: 'On' },
      { key: 'n', type: 'number', title: 'N', default: 5, min: 1, max: 9 },
      { key: 'shown', type: 'value', title: 'Shown' },
    ],
  }, 'demo');
  const [on, n, shown] = manifest.settings;
  assert.deepEqual([on.default, on.persist], [false, true]);
  assert.deepEqual([n.default, n.min, n.max, n.step, n.persist], [5, 1, 9, null, true]);
  assert.equal(shown.persist, undefined);
});

test('the manifest of a mod is rejected for the mistakes that would otherwise go quiet', () => {
  const cases = [
    [{ id: 'other' }, /must match the folder name/],
    [{ scripts: { mian: 'a.js' } }, /unknown window "mian"/],
    [{ scripts: { main: '../x.js' } }, /inside the mod's folder/],
    [{ scripts: { main: 'C:\\x.js' } }, /inside the mod's folder/],
    [{ scripts: {} }, /scripts is empty/],
    [{ settings: [{ key: 'a', type: 'toggle', title: 'A' }, { key: 'a', type: 'toggle', title: 'A' }] }, /used twice/],
    [{ settings: [{ key: 'a', type: 'slider', title: 'A' }] }, /type must be one of/],
    [{ settings: [{ key: 'a', type: 'toggle' }] }, /title is required/],
    [{ settings: [{ key: 'a', type: 'number', title: 'A', default: 99, max: 10 }] }, /outside min\/max/],
    [{ settings: [{ key: 'a', type: 'number', title: 'A' }] }, /default must be a number/],
    [{ settings: [{ key: 'a', type: 'value', title: 'A', persist: false }] }, /never stored/],
    [{ settings: [{ key: '1a', type: 'toggle', title: 'A' }] }, /key "1a"/],
    [{ defaultEnabled: 'no' }, /defaultEnabled/],
  ];
  for (const [raw, expected] of cases) {
    assert.match(problemsOf(raw).join('\n'), expected, JSON.stringify(raw));
  }
  assert.match(problemsOf([]).join(), /must be a JSON object/);
});

test('mods are found as single files and as folders; helpers and plain folders are skipped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-mods-'));
  try {
    await fs.writeFile(path.join(dir, 'single.js'), 'return 1;');
    await fs.writeFile(path.join(dir, '_helper.js'), 'x');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');

    await fs.mkdir(path.join(dir, 'pkg'));
    await fs.writeFile(path.join(dir, 'pkg', 'mod.json'), JSON.stringify({
      name: 'Pkg', scripts: { main: 'a.js', panel: 'b.js' },
      settings: [{ key: 'k', type: 'toggle', title: 'K' }],
    }));
    await fs.writeFile(path.join(dir, 'pkg', 'a.js'), 'A');
    await fs.writeFile(path.join(dir, 'pkg', 'b.js'), 'B');

    await fs.mkdir(path.join(dir, 'bare'));                       // no mod.json, has index.js
    await fs.writeFile(path.join(dir, 'bare', 'index.js'), 'C');
    await fs.mkdir(path.join(dir, 'assets'));                     // not a mod
    await fs.writeFile(path.join(dir, 'assets', 'logo.png'), 'x');
    await fs.mkdir(path.join(dir, 'bad'));                        // manifest does not parse
    await fs.writeFile(path.join(dir, 'bad', 'mod.json'), '{ nope');
    await fs.mkdir(path.join(dir, 'missing'));                    // names a script that is not there
    await fs.writeFile(path.join(dir, 'missing', 'mod.json'), JSON.stringify({ scripts: { main: 'gone.js' } }));

    const mods = await discoverMods(dir);
    assert.deepEqual(mods.map(m => m.name), ['bad', 'bare', 'missing', 'pkg', 'single']);
    const byName = Object.fromEntries(mods.map(m => [m.name, m]));

    assert.match(byName.bad.loadError, /^mod\.json:/);
    assert.match(byName.missing.loadError, /cannot read gone\.js/);
    assert.equal(byName.pkg.loadError, null);
    assert.equal(byName.pkg.manifest.name, 'Pkg');
    assert.deepEqual(byName.bare.scripts, { '*': 'C' });
    assert.deepEqual(byName.single.scripts, { '*': 'return 1;' });

    // Each window gets the manifest, and only its own code.
    assert.equal(unitFor(byName.pkg, 'main').code, 'A');
    assert.equal(unitFor(byName.pkg, 'panel').code, 'B');
    assert.equal(unitFor(byName.pkg, 'toast').code, null);
    assert.equal(unitFor(byName.single, 'toast').code, 'return 1;');
    assert.equal(unitFor(byName.pkg, 'toast').manifest.name, 'Pkg');

    // Editing one window's script changes that window's version and no other's.
    const before = { main: unitFor(byName.pkg, 'main').version, panel: unitFor(byName.pkg, 'panel').version };
    await fs.writeFile(path.join(dir, 'pkg', 'a.js'), 'A2');
    const [, , , edited] = await discoverMods(dir);
    assert.notEqual(unitFor(edited, 'main').version, before.main);
    assert.equal(unitFor(edited, 'panel').version, before.panel);
    assert.notEqual(edited.signature, byName.pkg.signature);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('every mod in mods/ loads cleanly, and the page code generated for it parses', async () => {
  const mods = await discoverMods(MODS_DIR);
  for (const mod of mods) {
    assert.equal(mod.loadError, null, `${mod.name}: ${mod.loadError}`);
    for (const label of ['main', 'panel', 'toast']) {
      new vm.Script(compileMod(unitFor(mod, label), label), { filename: `${mod.name}@${label}` });
    }
  }
});

test('the template mod is valid once the underscore is dropped, so copying it works', async () => {
  const folder = path.join(MODS_DIR, '_template');
  const raw = JSON.parse(await fs.readFile(path.join(folder, 'mod.json'), 'utf8'));
  const { manifest, scripts } = parseManifest(raw, 'template');
  for (const file of Object.values(scripts)) {
    const code = await fs.readFile(path.join(folder, file), 'utf8');
    new vm.Script(compileMod({ name: 'template', manifest, code, version: '1' }, 'main'));
  }
});

test('the framework scripts parse once wrapped', async () => {
  for (const script of await discoverCore()) {
    new vm.Script(compileCore(script), { filename: script.name });
  }
});

test('a mod whose code does not compile is told apart by the generator, not by luck', () => {
  const unit = { name: 'x', manifest: { id: 'x', name: 'x', settings: [] }, code: 'let = ;', version: '1' };
  assert.throws(() => new vm.Script(compileMod(unit, 'main')), SyntaxError);
  // The placeholder the injector falls back to carries the message and no code, and parses.
  const placeholder = compileMod({ ...unit, code: null, loadError: 'boom' }, 'main');
  assert.doesNotThrow(() => new vm.Script(placeholder));
  assert.match(placeholder, /"loadError":"boom"/);
});
