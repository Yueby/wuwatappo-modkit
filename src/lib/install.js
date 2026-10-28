// Getting a mod onto the machine and keeping it there: install, update, remove, list.
//
// A mod is a folder in mods/ with a package.json (see manifest.js), so installing is putting such a
// folder there, from wherever it is:
//
//   a folder        C:\work\my-mod          copied
//   an archive      my-mod.zip, .tgz        unpacked (Windows' own tar reads both)
//   git             https://host/x/y.git    cloned (add #branch-or-tag to pick one)
//   npm             some-mod, @who/some-mod@^1.2     fetched with `npm pack`, unpacked
//   a single file   thing.js                copied as it is
//
// Where it came from is kept beside it (.modkit-source.json) so that `update` can ask the same place
// again. Nothing a mod brings is run while installing, with one exception that is named: its
// dependencies are fetched with `npm install --ignore-scripts`, so a package's install script does
// not run unless the user says --allow-scripts. What a mod will be allowed to do is not enforced
// (its Node part is ordinary Node); what it declares is shown before it is put in place.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ManifestError, parseManifest } from './manifest.js';
import { checkRequirements, discoverMods } from './mods.js';
import { parse } from './semver.js';
import { MOD_DATA_DIR } from './paths.js';

const exec = promisify(execFile);
const SOURCE_FILE = '.modkit-source.json';

// --- running other programs -----------------------------------------------------------

// What npm, git and tar are run through. Tests give their own.
export async function run(command, args, { cwd } = {}) {
  const { stdout } = await exec(command, args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

// npm is a .cmd on Windows, which Node will not start without a shell, and a shell would read the
// package spec a user typed as commands. So it is run the way the .cmd runs it: node npm-cli.js.
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find(file => file && /npm-cli\.js$/.test(file)) ?? null;
}

async function npm(args, options, tools) {
  const cli = tools.npmCli ?? npmCli();
  if (!cli || !(await exists(cli))) throw new Error('could not find npm (npm-cli.js next to node): is Node installed with npm?');
  return tools.run(process.execPath, [cli, ...args], options);
}

// Windows' own tar (bsdtar) reads zip as well as tar.gz; the one on PATH may be GNU's, which does not.
const tarProgram = () => (process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar');

// --- where from -----------------------------------------------------------------------

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function classify(spec) {
  // Never an option for the program it is handed to (git clone --upload-pack=..., npm pack --...).
  if (/^\s*-/.test(spec)) throw new Error(`"${spec}" is not a source: it starts with a dash`);
  if (await exists(spec)) {
    const stat = await fs.stat(spec);
    if (stat.isDirectory()) return { type: 'folder' };
    if (/\.(zip|tgz|tar\.gz|tar)$/i.test(spec)) return { type: 'archive' };
    if (/\.m?js$/i.test(spec)) return { type: 'file' };
    throw new Error(`${spec} is not a folder, an archive (.zip, .tgz) or a script (.js)`);
  }
  if (/^(git\+|git:|ssh:\/\/)|\.git(#.*)?$/.test(spec) || /^https?:\/\/(www\.)?(github|gitlab|bitbucket)\.[a-z]+\//i.test(spec)) return { type: 'git' };
  if (/^[./\\]|^[A-Za-z]:[\\/]/.test(spec)) throw new Error(`${spec} does not exist`);
  return { type: 'npm' };
}

// Put the mod's files in `dest` (empty) and say where in it the mod is.
async function fetchInto(spec, dest, tools) {
  const { type } = await classify(spec);

  if (type === 'folder') {
    await fs.cp(spec, dest, { recursive: true, filter: file => !/[\\/](\.git|node_modules)([\\/]|$)/.test(file) });
    return { type, root: dest, hint: path.basename(path.resolve(spec)) };
  }

  if (type === 'file') {
    await fs.copyFile(spec, path.join(dest, path.basename(spec)));
    return { type, root: dest, hint: path.basename(spec).replace(/\.m?js$/i, ''), single: path.basename(spec) };
  }

  if (type === 'archive') {
    await tools.run(tarProgram(), ['-xf', path.resolve(spec), '-C', dest]);
    return { type, root: await modRoot(dest), hint: path.basename(spec).replace(/\.(zip|tgz|tar\.gz|tar)$/i, '') };
  }

  if (type === 'git') {
    const [url, ref] = spec.replace(/^git\+/, '').split('#');
    await tools.run('git', ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, dest]);
    await fs.rm(path.join(dest, '.git'), { recursive: true, force: true });
    return { type, root: dest, hint: path.basename(url).replace(/\.git$/, '') };
  }

  // npm: `npm pack` downloads the tarball; it unpacks into package/.
  const out = await npm(['pack', spec, '--pack-destination', dest, '--json', '--ignore-scripts'], { cwd: dest }, tools);
  const tarball = JSON.parse(out)[0]?.filename;
  if (!tarball) throw new Error(`npm did not say what it fetched for ${spec}`);
  await tools.run(tarProgram(), ['-xf', path.join(dest, tarball), '-C', dest]);
  await fs.rm(path.join(dest, tarball), { force: true });
  return { type, root: path.join(dest, 'package'), hint: spec.replace(/^@[^/]+\//, '').replace(/@.*$/, '') };
}

// An archive may hold the mod directly, or inside one folder that holds it (GitHub's zips do).
async function modRoot(dir) {
  if (await exists(path.join(dir, 'package.json'))) return dir;
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.'));
  if (entries.length === 1 && entries[0].isDirectory()) return modRoot(path.join(dir, entries[0].name));
  return dir;
}

// --- what is in it ----------------------------------------------------------------------

async function readPackage(root, hint, single) {
  if (single) {
    return { id: hint, raw: {}, manifest: null, single };
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`package.json: ${err.message}`);
    if (!(await exists(path.join(root, 'index.js')))) throw new Error('this is not a mod: no package.json, and no index.js');
    raw = {};
  }
  const id = String(raw.name ?? hint).replace(/^@[^/]+\//, '');
  try {
    return { id, raw, manifest: parseManifest(raw, id) };
  } catch (err) {
    if (err instanceof ManifestError) throw new Error(`package.json is not a valid mod manifest:\n  - ${err.problems.join('\n  - ')}`);
    throw err;
  }
}

// What someone installing it should read first.
export function describe({ id, raw, manifest, single }) {
  if (single) return { id, name: id, version: null, description: null, nodePart: false, permissions: [], requires: {}, dependencies: [] };
  return {
    id,
    name: manifest.manifest.name,
    version: manifest.manifest.version,
    description: manifest.manifest.description,
    nodePart: manifest.host !== null,
    permissions: manifest.permissions,
    requires: manifest.requires,
    dependencies: Object.keys(raw.dependencies ?? {}),
  };
}

// --- install / update / remove / list -----------------------------------------------------

async function withTemp(work) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-install-'));
  try {
    return await work(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const defaults = tools => ({ run, ...tools });

// Raised when `confirm` said no: nothing was changed.
export class InstallDeclined extends Error {}

// Install `spec` into modsDir. `replace`: it is an update, the old copy goes and the new takes its
// place (and is put back if the new one cannot be installed).
//
// `confirm(info)` is asked once what the mod is and what it declares is known, and before anything is put
// in place: an answer that is not true (it may be a promise) stops the install with InstallDeclined.
// `source` is what is remembered of where it came from, when that is not the file it was unpacked from
// (a plugin fetched through the registry is remembered by its name there).
export async function installMod(spec, {
  modsDir, force = false, allowScripts = false, noDeps = false, replace = null, tools, report = () => {},
  confirm = null, source = null,
}) {
  tools = defaults(tools);

  return withTemp(async temp => {
    const staging = path.join(temp, 'fetched');
    await fs.mkdir(staging);
    const fetched = await fetchInto(spec, staging, tools);
    const found = await readPackage(fetched.root, fetched.hint, fetched.single);
    const info = describe(found);
    report(info);

    const target = fetched.single ? path.join(modsDir, fetched.single) : path.join(modsDir, found.id);
    if (replace !== null && replace !== found.id) {
      throw new Error(`${spec} is now called "${found.id}", not "${replace}": it cannot update that mod (install it as a new one)`);
    }
    if (replace === null && !force && await exists(target)) {
      throw new Error(`${path.basename(target)} is already installed (use update, or --force to replace it)`);
    }

    // Everything else known, plus this one: does it have what it needs?
    if (!fetched.single) {
      const others = (await discoverMods(modsDir)).filter(m => m.name !== found.id);
      const mine = {
        name: found.id, file: target, loadError: null, requires: found.manifest.requires,
        engines: found.manifest.engines, manifest: found.manifest.manifest, scripts: {},
      };
      const verdict = checkRequirements([...others, mine]).find(m => m.name === found.id);
      if (verdict.loadError) info.warning = verdict.loadError;
    }

    if (confirm && !(await confirm(info))) throw new InstallDeclined('not installed: declined');

    // Swap: stage next to the target, move the old aside, move the new in, then drop the old.
    await fs.mkdir(modsDir, { recursive: true });
    const incoming = `${target}.new-${process.pid}`;
    const outgoing = `${target}.old-${process.pid}`;
    await fs.rm(incoming, { recursive: true, force: true });
    if (fetched.single) await fs.copyFile(path.join(fetched.root, fetched.single), incoming);
    else await fs.cp(fetched.root, incoming, { recursive: true });

    const hadOld = await exists(target);
    try {
      if (!fetched.single) {
        await fs.writeFile(path.join(incoming, SOURCE_FILE), JSON.stringify({
          type: source?.type ?? fetched.type,
          spec: source?.spec ?? (fetched.type === 'folder' || fetched.type === 'archive' ? path.resolve(spec) : spec),
          version: info.version,
          installedAt: new Date().toISOString(),
        }, null, 2));
        if (info.dependencies.length && !noDeps) {
          const args = ['install', '--omit=dev', '--no-audit', '--no-fund', ...(allowScripts ? [] : ['--ignore-scripts'])];
          await npm(args, { cwd: incoming }, tools);
          info.installedDependencies = true;
        }
      }
      if (hadOld) await fs.rename(target, outgoing);
      await fs.rename(incoming, target);
    } catch (err) {
      await fs.rm(incoming, { recursive: true, force: true });
      // If the old one had been moved aside and the new one then could not be moved in, put it back.
      // (Not covered by a test: it needs a rename to fail half way. Everything that can fail before
      // that point, dependencies included, happens while the old one is still in place.)
      if (hadOld && !(await exists(target))) await fs.rename(outgoing, target).catch(() => {});
      throw err;
    }
    await fs.rm(outgoing, { recursive: true, force: true });
    return { ...info, target, replaced: hadOld, source: fetched.type };
  });
}

// For a mod's author, and for the registry's automation: is this folder a mod that can be loaded, and what
// does it declare. `registry` adds what the registry needs to tell versions apart and to show a plugin.
export async function checkMod(folder, { registry = false } = {}) {
  const id = path.basename(path.resolve(folder));
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  } catch (err) {
    return { ok: false, id, problems: [`package.json: ${err.code === 'ENOENT' ? 'there is none' : err.message}`] };
  }

  let manifest;
  try {
    manifest = parseManifest(raw, id);
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    return { ok: false, id, problems: err.problems };
  }

  const problems = [];
  for (const file of [...Object.values(manifest.windows), ...(manifest.host ? [manifest.host] : [])]) {
    if (!(await exists(path.join(folder, file)))) problems.push(`${file} is named in package.json but is not in the folder`);
  }
  if (manifest.host && raw.type !== 'module') problems.push('a mod with a Node part needs "type": "module" in package.json');
  if (registry) {
    if (!manifest.manifest.version || !parse(manifest.manifest.version)) problems.push('version must be a version number like 1.0.0: the registry tells releases apart by it');
    if (!manifest.manifest.description) problems.push('description is empty: it is what the list shows');
    if (await exists(path.join(folder, 'node_modules'))) problems.push('node_modules is in the folder: list dependencies in package.json instead, they are fetched when it is installed');
  }

  return { ok: problems.length === 0, id, problems, ...describe({ id, raw, manifest }) };
}

export async function readSource(folder) {
  try {
    return JSON.parse(await fs.readFile(path.join(folder, SOURCE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function updateMod(id, options) {
  const folder = path.join(options.modsDir, id);
  const source = await readSource(folder);
  if (!source) throw new Error(`${id} was not installed from anywhere this can ask again (no ${SOURCE_FILE}); install it again from its source`);
  const before = (await discoverMods(options.modsDir)).find(m => m.name === id)?.manifest.version ?? null;
  const result = await installMod(source.spec, { ...options, replace: id });
  return { ...result, before, unchanged: before !== null && before === result.version };
}

export async function removeMod(id, { modsDir, purge = false, dataDir = MOD_DATA_DIR }) {
  const folder = path.join(modsDir, id);
  const file = `${folder}.js`;
  const isFolder = await exists(folder);
  if (!isFolder && !(await exists(file))) throw new Error(`there is no mod called "${id}" in ${modsDir}`);
  await fs.rm(isFolder ? folder : file, { recursive: true, force: true });
  let purged = false;
  if (purge && await exists(path.join(dataDir, id))) {
    await fs.rm(path.join(dataDir, id), { recursive: true, force: true });
    purged = true;
  }
  return { removed: isFolder ? folder : file, purged };
}

export async function listMods(modsDir) {
  const mods = await discoverMods(modsDir);
  return Promise.all(mods.map(async mod => {
    const source = mod.file.endsWith('package.json') ? await readSource(path.dirname(mod.file)) : null;
    return {
      id: mod.name,
      name: mod.manifest.name,
      version: mod.manifest.version,
      nodePart: mod.hostFile !== null,
      permissions: mod.permissions,
      requires: Object.keys(mod.requires),
      source: source ? `${source.type}: ${source.spec}` : 'local',
      problem: mod.loadError,
    };
  }));
}
