// Installing, updating, removing and listing mods, always into a temporary mods folder. Archives
// are made and unpacked with the system's tar, dependencies are installed by the real npm (from a
// tarball on disk, so it needs no network); git and the npm registry are stood in for.
//
//   node --test tests/install.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HostManager } from '../src/lib/host.js';
import { classify, installMod, listMods, readSource, removeMod, run, updateMod } from '../src/lib/install.js';
import { discoverMods } from '../src/lib/mods.js';
import { until, write } from './app-helpers.js';

const exec = promisify(execFile);
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

let root;
let counter = 0;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-install-test-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// A fresh empty mods folder, and a place to build things.
async function fresh() {
  const dir = path.join(root, `case-${++counter}`);
  await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
  return { dir, mods: path.join(dir, 'mods') };
}

// A mod's source folder.
async function source(dir, name, { version = '1.0.0', modkit = {}, extra = {}, files = {} } = {}) {
  const folder = path.join(dir, 'src', name);
  await write(path.join(folder, 'package.json'), JSON.stringify({
    name, version, description: `the ${name} mod`, type: 'module', ...extra, modkit: { windows: { main: 'main.js' }, ...modkit },
  }));
  await write(path.join(folder, 'main.js'), 'return 1;');
  for (const [file, text] of Object.entries(files)) await write(path.join(folder, file), text);
  return folder;
}

const ids = async mods => (await discoverMods(mods)).map(m => m.name);

// --- from a folder ---------------------------------------------------------------------

test('a folder is installed, remembered, and listed with where it came from', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'alpha', { files: { 'node_modules/ignored/x.js': 'x', '.git/config': 'x' } });
  const seen = [];

  const result = await installMod(folder, { modsDir: mods, report: info => seen.push(info) });

  assert.equal(result.target, path.join(mods, 'alpha'));
  assert.deepEqual(await ids(mods), ['alpha']);
  assert.deepEqual(await fs.readdir(path.join(mods, 'alpha')).then(n => n.sort()), ['.modkit-source.json', 'main.js', 'package.json'], 'no node_modules or .git carried over');
  assert.equal(seen[0].version, '1.0.0', 'what it declares is reported before it is put in place');

  const source_ = await readSource(path.join(mods, 'alpha'));
  assert.deepEqual([source_.type, source_.spec, source_.version], ['folder', path.resolve(folder), '1.0.0']);
  const [row] = await listMods(mods);
  assert.deepEqual([row.id, row.version, row.problem, row.source], ['alpha', '1.0.0', null, `folder: ${path.resolve(folder)}`]);
});

test('what it declares is shown first: a Node part, permissions, mods it needs, npm packages', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'beta', {
    modkit: { host: 'host.js', permissions: ['network', 'files'], requires: { gamma: '^1.0.0' } },
    extra: { dependencies: { left: '1.0.0' } },
    files: { 'host.js': 'export default () => {}' },
  });
  let info;
  await installMod(folder, { modsDir: mods, noDeps: true, report: i => { info = i; } });
  assert.deepEqual(
    [info.nodePart, info.permissions, info.requires, info.dependencies],
    [true, ['network', 'files'], { gamma: '^1.0.0' }, ['left']],
  );
  assert.match(info.warning ?? '', /需要 mod「gamma」，但没有安装/, 'a missing requirement is said at once');
  assert.match((await listMods(mods))[0].problem, /gamma/, 'and the mod is listed as broken until it is put right');
});

test('installing over an existing one needs --force; a name that is not a mod is refused and leaves nothing', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'alpha');
  await installMod(folder, { modsDir: mods });
  await assert.rejects(installMod(folder, { modsDir: mods }), /already installed \(use update, or --force/);
  await installMod(folder, { modsDir: mods, force: true });

  const bad = path.join(dir, 'src', 'bad');
  await write(path.join(bad, 'package.json'), JSON.stringify({ name: 'bad', modkit: { windos: {} } }));
  await assert.rejects(installMod(bad, { modsDir: mods }), /not a valid mod manifest:\n {2}- modkit\.windos: unknown/);

  const notAMod = path.join(dir, 'src', 'plain');
  await write(path.join(notAMod, 'readme.txt'), 'hello');
  await assert.rejects(installMod(notAMod, { modsDir: mods }), /not a mod: no package.json, and no index.js/);

  assert.deepEqual(await fs.readdir(mods), ['alpha'], 'nothing half-installed, no staging left behind');
});

test('a single .js file is installed as it is', async () => {
  const { dir, mods } = await fresh();
  const file = path.join(dir, 'hello.js');
  await write(file, 'return 1;');
  await installMod(file, { modsDir: mods });
  assert.deepEqual(await fs.readdir(mods), ['hello.js']);
  assert.deepEqual(await ids(mods), ['hello']);
});

// --- from an archive -------------------------------------------------------------------

for (const [extension, flags] of [['zip', ['-a', '-cf']], ['tgz', ['-czf']]]) {
  test(`a .${extension} is unpacked, whether the mod is at its top or inside one folder (as GitHub makes them)`, async () => {
    const { dir, mods } = await fresh();
    const folder = await source(dir, 'packed');

    const flat = path.join(dir, `flat.${extension}`);
    await exec(tar, [...flags, flat, '-C', folder, '.']);
    await installMod(flat, { modsDir: mods });
    assert.deepEqual(await ids(mods), ['packed']);
    assert.equal((await readSource(path.join(mods, 'packed'))).type, 'archive');
    await removeMod('packed', { modsDir: mods });

    const nested = path.join(dir, `nested.${extension}`);
    await exec(tar, [...flags, nested, '-C', path.join(dir, 'src'), 'packed']);
    await installMod(nested, { modsDir: mods });
    assert.deepEqual(await ids(mods), ['packed']);
  });
}

// --- dependencies ----------------------------------------------------------------------

// A package to depend on, as a tarball (what a registry would give), whose install script leaves a mark.
async function tinyPackage(dir) {
  const folder = path.join(dir, 'tiny');
  await write(path.join(folder, 'package.json'), JSON.stringify({
    name: 'tiny', version: '1.0.0', main: 'index.js', scripts: { postinstall: 'node mark.js' },
  }));
  await write(path.join(folder, 'index.js'), 'module.exports = { answer: 42 };');
  await write(path.join(folder, 'mark.js'), "require('fs').writeFileSync(require('path').join(__dirname, 'ran-postinstall'), 'yes');");
  const { stdout } = await exec(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'pack', folder, '--pack-destination', dir, '--json'], { cwd: dir, windowsHide: true });
  return path.join(dir, JSON.parse(stdout)[0].filename);
}

test('dependencies are installed by npm, scripts are not run unless allowed, and the mod can import them', async () => {
  const { dir, mods } = await fresh();
  const tarball = await tinyPackage(dir);
  const make = name => source(dir, name, {
    modkit: { host: 'host.js' },
    extra: { dependencies: { tiny: `file:${tarball.replaceAll('\\', '/')}` } },
    files: { 'host.js': "import tiny from 'tiny'; export default host => host.handle('answer', () => tiny.answer);" },
  });

  const safe = await installMod(await make('safe'), { modsDir: mods });
  assert.equal(safe.installedDependencies, true);
  const installed = path.join(mods, 'safe', 'node_modules', 'tiny');
  assert.ok(await fs.stat(path.join(installed, 'index.js')));
  await assert.rejects(fs.stat(path.join(installed, 'ran-postinstall')), 'the install script of a dependency did not run');

  const trusted = await installMod(await make('trusted'), { modsDir: mods, allowScripts: true });
  assert.equal(trusted.installedDependencies, true);
  assert.equal(await fs.readFile(path.join(mods, 'trusted', 'node_modules', 'tiny', 'ran-postinstall'), 'utf8'), 'yes', 'but with --allow-scripts it does');

  const skipped = await installMod(await make('skipped'), { modsDir: mods, noDeps: true });
  assert.equal(skipped.installedDependencies, undefined);
  await assert.rejects(fs.stat(path.join(mods, 'skipped', 'node_modules')), '--no-deps leaves it alone');

  // The point of it all: the mod's Node part imports the package like any Node program would.
  const app = { evaluate: async () => {}, evaluateAll: async () => {} };
  const manager = new HostManager({ dataDir: path.join(dir, 'data') });
  manager.connect(app);
  const replies = [];
  app.evaluate = async (window, expression) => { replies.push(expression); };
  manager.setMods(await discoverMods(mods));
  manager.onPageMessage('main', JSON.stringify({ t: 'hello', mod: 'safe', window: 'main', enabled: true, config: {} }));
  try {
    await until('the Node part is up', () => manager.states().safe === 'ready', 10000);
    manager.onPageMessage('main', JSON.stringify({ t: 'call', mod: 'safe', window: 'main', name: 'answer', arg: null, callId: 'a1' }));
    await until('answered', () => replies.some(r => r.includes('hostReply?.("a1", true, 42)')));
  } finally {
    await manager.close();
  }
});

// --- update ----------------------------------------------------------------------------

test('update asks the same place again: a new version replaces the old, the same one is left alone', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'alpha', { version: '1.0.0', files: { 'old.txt': 'old' } });
  await installMod(folder, { modsDir: mods });

  const same = await updateMod('alpha', { modsDir: mods });
  assert.equal(same.unchanged, true);

  await fs.rm(path.join(folder, 'old.txt'));
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'alpha', version: '1.1.0', type: 'module', modkit: { windows: { main: 'main.js' } } }));
  const updated = await updateMod('alpha', { modsDir: mods });
  assert.deepEqual([updated.before, updated.version, updated.unchanged], ['1.0.0', '1.1.0', false]);
  assert.equal((await discoverMods(mods))[0].manifest.version, '1.1.0');
  await assert.rejects(fs.stat(path.join(mods, 'alpha', 'old.txt')), 'a file the new version dropped is gone');
  assert.deepEqual((await fs.readdir(mods)), ['alpha'], 'no .old / .new folders left');
});

test('an update that cannot be installed leaves the old one exactly as it was', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'alpha', { version: '1.0.0' });
  await installMod(folder, { modsDir: mods });
  const before = await fs.readFile(path.join(mods, 'alpha', 'package.json'), 'utf8');

  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'alpha', version: '2.0.0', modkit: { windos: {} } }));
  await assert.rejects(updateMod('alpha', { modsDir: mods }), /not a valid mod manifest/);
  assert.equal(await fs.readFile(path.join(mods, 'alpha', 'package.json'), 'utf8'), before);

  // Dependencies that cannot be installed fail before the old one is touched, so it is simply still there.
  await write(path.join(folder, 'package.json'), JSON.stringify({
    name: 'alpha', version: '2.0.0', modkit: { windows: { main: 'main.js' } }, dependencies: { nothing: 'file:/does/not/exist.tgz' },
  }));
  await assert.rejects(updateMod('alpha', { modsDir: mods }));
  assert.equal(await fs.readFile(path.join(mods, 'alpha', 'package.json'), 'utf8'), before, 'still the old one');
  assert.deepEqual(await fs.readdir(mods), ['alpha'], 'nothing left over');
});

test('a mod that is renamed at its source cannot update the old one, and one with no source says so', async () => {
  const { dir, mods } = await fresh();
  const folder = await source(dir, 'alpha');
  await installMod(folder, { modsDir: mods });
  await write(path.join(folder, 'package.json'), JSON.stringify({ name: 'omega', version: '1.0.0', modkit: { windows: { main: 'main.js' } } }));
  await assert.rejects(updateMod('alpha', { modsDir: mods }), /now called "omega", not "alpha"/);

  await write(path.join(mods, 'handmade', 'package.json'), JSON.stringify({ name: 'handmade', modkit: { windows: { main: 'm.js' } } }));
  await write(path.join(mods, 'handmade', 'm.js'), 'return 1;');
  await assert.rejects(updateMod('handmade', { modsDir: mods }), /not installed from anywhere this can ask again/);
});

// --- remove ----------------------------------------------------------------------------

test('remove deletes the mod, and with --purge what its Node part kept', async () => {
  const { dir, mods } = await fresh();
  const data = path.join(dir, 'data');
  await installMod(await source(dir, 'alpha'), { modsDir: mods });
  await write(path.join(data, 'alpha', 'notes.txt'), 'kept');

  const kept = await removeMod('alpha', { modsDir: mods, dataDir: data });
  assert.equal(kept.purged, false);
  assert.deepEqual(await fs.readdir(mods), []);
  assert.equal(await fs.readFile(path.join(data, 'alpha', 'notes.txt'), 'utf8'), 'kept', 'its files stay unless asked');

  await installMod(await source(dir, 'alpha'), { modsDir: mods });
  assert.equal((await removeMod('alpha', { modsDir: mods, dataDir: data, purge: true })).purged, true);
  await assert.rejects(fs.stat(path.join(data, 'alpha')));

  await assert.rejects(removeMod('nothing', { modsDir: mods, dataDir: data }), /there is no mod called "nothing"/);
});

// --- git and npm: the calls made --------------------------------------------------------

const npmCliFile = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

test('git is cloned shallowly, with the branch if one is given, and its history is not kept', async () => {
  const { dir, mods } = await fresh();
  const fixture = await source(dir, 'fromgit');
  const calls = [];
  const tools = {
    run: async (command, args) => {
      calls.push([command, args]);
      await fs.cp(fixture, args.at(-1), { recursive: true });          // pretend the clone worked: the folder is the last argument
      await fs.mkdir(path.join(args.at(-1), '.git'));
      return '';
    },
  };

  await installMod('https://example.com/someone/fromgit.git#v1.0', { modsDir: mods, tools });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 6), ['clone', '--depth', '1', '--branch', 'v1.0', 'https://example.com/someone/fromgit.git']);
  assert.equal(calls[0][0], 'git');
  assert.deepEqual(await ids(mods), ['fromgit']);
  await assert.rejects(fs.stat(path.join(mods, 'fromgit', '.git')));
  assert.equal((await readSource(path.join(mods, 'fromgit'))).spec, 'https://example.com/someone/fromgit.git#v1.0');
});

test('npm: the package is fetched with npm pack through node (not a shell), unpacked from package/, and installed', async () => {
  const { dir, mods } = await fresh();
  const fixture = await source(dir, 'fromnpm', { version: '2.3.4' });
  const calls = [];
  const tools = {
    npmCli: npmCliFile,
    run: async (command, args, options) => {
      calls.push([command, args]);
      if (!args.includes('pack')) return run(command, args, options);   // unpacking: the real tar
      // What the registry would hand over: a tarball with everything under package/.
      const place = args[args.indexOf('--pack-destination') + 1];
      const stage = path.join(dir, 'pack-stage');
      await fs.cp(fixture, path.join(stage, 'package'), { recursive: true });
      await exec(tar, ['-czf', path.join(place, 'fromnpm-2.3.4.tgz'), '-C', stage, 'package']);
      return JSON.stringify([{ filename: 'fromnpm-2.3.4.tgz' }]);
    },
  };

  const result = await installMod('fromnpm@^2.0.0', { modsDir: mods, tools });

  const [command, args] = calls[0];
  assert.equal(command, process.execPath, 'node runs npm: no shell reads what the user typed');
  assert.equal(args[0], npmCliFile);
  assert.deepEqual(args.slice(1, 3), ['pack', 'fromnpm@^2.0.0']);
  assert.ok(args.includes('--ignore-scripts'), 'packing runs no scripts either');
  assert.deepEqual(await ids(mods), ['fromnpm']);
  assert.deepEqual([result.version, result.source], ['2.3.4', 'npm']);
  assert.deepEqual(await fs.readdir(mods), ['fromnpm'], 'the downloaded tarball is not left in mods/');
  assert.equal((await readSource(path.join(mods, 'fromnpm'))).spec, 'fromnpm@^2.0.0', 'so update asks npm again');
});

test('what a source is: folder, archive, script, git, npm; and a path that does not exist is an error, not an npm name', async () => {
  const { dir } = await fresh();
  await write(path.join(dir, 'a.js'), '');
  await write(path.join(dir, 'a.zip'), '');
  await fs.mkdir(path.join(dir, 'folder'));
  assert.equal((await classify(path.join(dir, 'folder'))).type, 'folder');
  assert.equal((await classify(path.join(dir, 'a.zip'))).type, 'archive');
  assert.equal((await classify(path.join(dir, 'a.js'))).type, 'file');
  for (const git of ['https://github.com/someone/thing', 'https://example.com/x/y.git', 'git+https://example.com/x/y', 'https://example.com/x/y.git#main']) {
    assert.equal((await classify(git)).type, 'git', git);
  }
  for (const name of ['some-mod', '@who/some-mod', 'some-mod@^1.2.0']) assert.equal((await classify(name)).type, 'npm', name);
  await assert.rejects(classify('.\\nowhere\\mod'), /does not exist/);
  await assert.rejects(classify(path.join(dir, 'missing.zip')), /does not exist|npm/);
});
