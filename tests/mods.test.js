// Offline tests: manifests, how mods are found on disk, and that the code generated for the
// page parses. Needs neither the app nor DevTools.   node --test tests/mods.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

test('a package.json with nothing in it gets the defaults', () => {
  const { manifest, windows } = parseManifest({}, 'demo');
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.name, 'demo');
  assert.equal(manifest.defaultEnabled, true);
  assert.deepEqual(manifest.settings, []);
  assert.deepEqual(windows, { '*': 'index.js' });
});

test('standard package.json fields mean what they always do, and the rest of it is left alone', () => {
  const { manifest } = parseManifest({
    name: 'demo', displayName: '  示例  ', version: '1.2.3', description: 'd',
    private: true, author: 'me', license: 'MIT', keywords: ['x'],
    scripts: { test: 'node --test' },                      // npm's scripts: not ours, not an error
    modkit: { defaultEnabled: false },
  }, 'demo');
  assert.deepEqual(
    [manifest.id, manifest.name, manifest.version, manifest.description, manifest.defaultEnabled],
    ['demo', '示例', '1.2.3', 'd', false],
  );
});

test('settings are normalised and persist by default', () => {
  const { manifest } = parseManifest({
    modkit: {
      settings: [
        { key: 'on', type: 'toggle', title: 'On' },
        { key: 'n', type: 'number', title: 'N', default: 5, min: 1, max: 9 },
        { key: 'shown', type: 'value', title: 'Shown' },
      ],
    },
  }, 'demo');
  const [on, n, shown] = manifest.settings;
  assert.deepEqual([on.default, on.persist], [false, true]);
  assert.deepEqual([n.default, n.min, n.max, n.step, n.persist], [5, 1, 9, null, true]);
  assert.equal(shown.persist, undefined);
});

test('the manifest of a mod is rejected for the mistakes that would otherwise go quiet', () => {
  const cases = [
    [{ name: 'other' }, /must match the folder name/],
    [{ displayName: '' }, /displayName/],
    [{ modkit: [] }, /"modkit" must be an object/],
    [{ modkit: { windos: {} } }, /modkit\.windos: unknown/],
    [{ modkit: { windows: { mian: 'a.js' } } }, /unknown window "mian"/],
    [{ modkit: { windows: { main: '../x.js' } } }, /inside the mod's folder/],
    [{ modkit: { windows: { main: 'C:\\x.js' } } }, /inside the mod's folder/],
    [{ modkit: { windows: {} } }, /windows is empty/],
    [{ modkit: { host: '../outside.js' } }, /modkit\.host.*inside the mod's folder/],
    [{ modkit: { host: 3 } }, /modkit\.host/],
    [{ modkit: { defaultEnabled: 'no' } }, /defaultEnabled/],
    ...[
      [[{ key: 'a', type: 'toggle', title: 'A' }, { key: 'a', type: 'toggle', title: 'A' }], /used twice/],
      [[{ key: 'a', type: 'slider', title: 'A' }], /type must be one of/],
      [[{ key: 'a', type: 'toggle' }], /title is required/],
      [[{ key: 'a', type: 'number', title: 'A', default: 99, max: 10 }], /outside min\/max/],
      [[{ key: 'a', type: 'number', title: 'A' }], /default must be a number/],
      [[{ key: 'a', type: 'value', title: 'A', persist: false }], /never stored/],
      [[{ key: '1a', type: 'toggle', title: 'A' }], /key "1a"/],
    ].map(([settings, expected]) => [{ modkit: { settings } }, expected]),
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
    await fs.writeFile(path.join(dir, 'pkg', 'package.json'), JSON.stringify({
      displayName: 'Pkg',
      modkit: { windows: { main: 'a.js', panel: 'b.js' }, settings: [{ key: 'k', type: 'toggle', title: 'K' }] },
    }));
    await fs.writeFile(path.join(dir, 'pkg', 'a.js'), 'A');
    await fs.writeFile(path.join(dir, 'pkg', 'b.js'), 'B');

    await fs.mkdir(path.join(dir, 'bare'));                       // no package.json, has index.js
    await fs.writeFile(path.join(dir, 'bare', 'index.js'), 'C');
    await fs.mkdir(path.join(dir, 'assets'));                     // not a mod
    await fs.writeFile(path.join(dir, 'assets', 'logo.png'), 'x');
    await fs.mkdir(path.join(dir, 'bad'));                        // manifest does not parse
    await fs.writeFile(path.join(dir, 'bad', 'package.json'), '{ nope');
    await fs.mkdir(path.join(dir, 'missing'));                    // names a script that is not there
    await fs.writeFile(path.join(dir, 'missing', 'package.json'), JSON.stringify({ modkit: { windows: { main: 'gone.js' } } }));

    const mods = await discoverMods(dir);
    assert.deepEqual(mods.map(m => m.name), ['bad', 'bare', 'missing', 'pkg', 'single']);
    const byName = Object.fromEntries(mods.map(m => [m.name, m]));

    assert.match(byName.bad.loadError, /^package\.json:/);
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

test('a Node part: only the page is told, a mod may have no page script, and one without it is unchanged', () => {
  const withHost = parseManifest({ modkit: { host: 'host.js' } }, 'demo');
  assert.equal(withHost.host, 'host.js');
  assert.equal(withHost.manifest.host, true);
  assert.deepEqual(withHost.windows, {}, 'no page script is needed when there is a Node part');
  assert.deepEqual(parseManifest({ modkit: { host: 'host.js', windows: {} } }, 'demo').windows, {});

  // A manifest without one must stay byte-identical to what it was before the feature existed,
  // or every installed mod would count as changed and be reloaded.
  const without = parseManifest({}, 'demo');
  assert.equal(without.host, null);
  assert.equal('host' in without.manifest, false);
});

test('the Node part of a package: found, fingerprinted by what it can import, and checked to exist', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-host-mods-'));
  const pause = () => new Promise(resolve => setTimeout(resolve, 1100));     // file times are only so fine
  try {
    const mod = path.join(dir, 'tool');
    await fs.mkdir(path.join(mod, 'lib'), { recursive: true });
    await fs.mkdir(path.join(mod, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(mod, 'package.json'), JSON.stringify({
      type: 'module', modkit: { host: 'host.js', windows: { main: 'main.js' } },
    }));
    await fs.writeFile(path.join(mod, 'host.js'), 'export default () => {}');
    await fs.writeFile(path.join(mod, 'lib', 'helper.js'), 'export const x = 1');
    await fs.writeFile(path.join(mod, 'main.js'), 'return 1;');
    await fs.writeFile(path.join(mod, 'node_modules', 'dep', 'index.js'), 'x');

    await fs.mkdir(path.join(dir, 'missing'));
    await fs.writeFile(path.join(dir, 'missing', 'package.json'), JSON.stringify({ modkit: { host: 'nope.js' } }));

    const first = await discoverMods(dir);
    const tool = first.find(m => m.name === 'tool');
    assert.equal(tool.hostFile, path.join(mod, 'host.js'));
    assert.equal(tool.manifest.host, true);
    assert.match(first.find(m => m.name === 'missing').loadError, /modkit\.host: cannot read nope\.js/);

    await pause();
    await fs.writeFile(path.join(mod, 'main.js'), 'return 2;');                   // a page script
    await fs.writeFile(path.join(mod, 'node_modules', 'dep', 'index.js'), 'y');    // something installed
    const afterPageEdit = (await discoverMods(dir)).find(m => m.name === 'tool');
    assert.equal(afterPageEdit.hostVersion, tool.hostVersion, 'neither restarts the Node part');
    assert.notEqual(afterPageEdit.signature, tool.signature, 'though the page script did change');

    await fs.writeFile(path.join(mod, 'lib', 'helper.js'), 'export const x = 2');  // something it imports
    const afterImport = (await discoverMods(dir)).find(m => m.name === 'tool');
    assert.notEqual(afterImport.hostVersion, tool.hostVersion, 'a file it can import changed: restart');
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

test('the templates are valid once the underscore is dropped, so copying one works', async () => {
  const templates = (await fs.readdir(MODS_DIR, { withFileTypes: true }))
    .filter(e => e.isDirectory() && e.name.startsWith('_template'));
  assert.ok(templates.length >= 2, 'a template with a Node part, and one without');

  for (const { name: folderName } of templates) {
    const folder = path.join(MODS_DIR, folderName);
    const id = folderName.slice(1);                              // what it is called once copied and renamed
    const raw = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    const { manifest, windows, host } = parseManifest(raw, id);

    for (const file of Object.values(windows)) {
      const code = await fs.readFile(path.join(folder, file), 'utf8');
      new vm.Script(compileMod({ name: id, manifest, code, version: '1' }, 'main'), { filename: `${folderName}/${file}` });
    }
    if (host) {
      // Importing runs nothing but the module's top level; the function is only called by the loader.
      const module = await import(pathToFileURL(path.join(folder, host)).href);
      assert.equal(typeof (module.default ?? module.start), 'function', `${folderName}/${host} exports a function`);
      assert.equal(raw.type, 'module', `${folderName} says "type": "module", or Node warns on every start`);
    }
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
