// Loading scripts from disk: the framework runtime, and the user's mods.
//
//   src/runtime/*.js   framework — injected first, into every window, always
//   mods/              user mods (single files or folders) — injected after the framework
//
// They share one pipeline (same wrapper, same hot reload), but they are kept apart
// on purpose: the manager page lists the user's mods, so the code that draws that
// page must not be one of them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { iconDataUrls } from './icon.js';
import { ManifestError, parseManifest } from './manifest.js';
import { satisfies } from './semver.js';
import { runtimeScripts } from './bundle.js';
import { MODS_DIR } from './paths.js';

// Framework scripts are registered under this prefix so they can never collide with a
// user mod's name, and so the manager can tell them apart.
export const CORE_PREFIX = '@core/';

// Files starting with "_" or "." are helpers/fragments and are not loaded.
const SCRIPT_FILE = /\.(m?js)$/i;
const IGNORED = /^[_.]/;

async function readScripts(dir, { prefix = '', core = false } = {}) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const files = entries
    .filter(e => e.isFile() && SCRIPT_FILE.test(e.name) && !IGNORED.test(e.name))
    .map(e => e.name)
    .sort();

  const scripts = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const code = await fs.readFile(fullPath, 'utf8');
    const digest = `${code.length}:${hash(code)}`;
    scripts.push({
      name: prefix + path.basename(file, path.extname(file)),
      file: fullPath,
      code,
      core,
      // `version` is what the page compares against to decide whether a change is a
      // no-op retry or a genuine reload of a modified file.
      version: digest,
      signature: digest,
    });
  }
  return scripts;
}

// User mods come in two shapes, and both end up as the same record:
//
//   mods/name.js              a single script, runs in every window, no settings
//   mods/name/package.json    a package: manifest + one script per window (see manifest.js)
//   mods/name/<scripts>       (package.json may be left out if there is an index.js)
//
// { name, manifest, scripts: { <window|'*'>: code }, hostFile?, hostVersion?, loadError?, signature, core: false }
//
// A package that cannot be read or fails validation is still returned, with `loadError`, so
// it shows up on the MOD page as broken instead of vanishing.
export async function discoverMods(dir = MODS_DIR) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const mods = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED.test(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && SCRIPT_FILE.test(entry.name)) {
      mods.push(await readSingleFile(fullPath));
    } else if (entry.isDirectory()) {
      const mod = await readPackage(fullPath);
      if (mod) mods.push(mod);
    }
  }
  return checkRequirements(mods);
}

async function readSingleFile(file) {
  const id = path.basename(file, path.extname(file));
  const code = await fs.readFile(file, 'utf8');
  return makeMod({
    name: id,
    file,
    manifest: { id, name: id, version: null, description: null, defaultEnabled: true, settings: [] },
    scripts: { '*': code },
  });
}

async function readPackage(folder) {
  const id = path.basename(folder);
  const manifestFile = path.join(folder, 'package.json');

  let raw = {};
  let hasManifest = true;
  try {
    raw = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return brokenMod(id, manifestFile, `package.json: ${err.message}`);
    hasManifest = false;
  }
  // Without a manifest a folder is only a mod if it has the default script; otherwise it
  // is just a folder (assets, notes) and not our business.
  if (!hasManifest && !await exists(path.join(folder, 'index.js'))) return null;

  let parsed;
  try {
    parsed = parseManifest(raw, id);
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    return brokenMod(id, manifestFile, `package.json: ${err.message}`);
  }

  const scripts = {};
  for (const [windowName, relative] of Object.entries(parsed.windows)) {
    try {
      scripts[windowName] = await fs.readFile(path.join(folder, relative), 'utf8');
    } catch (err) {
      return brokenMod(id, manifestFile, `modkit.windows.${windowName}: cannot read ${relative} (${err.code ?? err.message})`);
    }
  }

  // The Node part: it has to exist, and what decides whether it is restarted is every file of
  // the folder it could import from, other than the page scripts (editing those must not
  // restart it).
  let hostFile = null;
  let hostVersion = null;
  if (parsed.host) {
    hostFile = path.join(folder, parsed.host);
    if (!await exists(hostFile)) return brokenMod(id, manifestFile, `modkit.host: cannot read ${parsed.host}`);
    hostVersion = await fingerprint(folder, new Set(Object.values(parsed.windows).map(f => path.normalize(f))));
  }
  return makeMod({
    name: id,
    file: manifestFile,
    manifest: parsed.manifest,
    scripts,
    hostFile,
    hostVersion,
    requires: parsed.requires,
    permissions: parsed.permissions,
    engines: parsed.engines,
  });
}

// Changes whenever a source file under `folder` is added, removed or modified. Size and
// modification time, not contents: this runs every second while watching.
async function fingerprint(folder, skip) {
  const parts = [];
  const walk = async (dir, prefix) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (/.(m?js|cjs|json)$/i.test(entry.name) && !skip.has(relative)) {
        const stat = await fs.stat(path.join(dir, entry.name));
        parts.push(`${relative}:${stat.size}:${Math.round(stat.mtimeMs)}`);
      }
    }
  };
  await walk(folder, '');
  return hash(parts.sort().join('|'));
}

// A mod that could not be loaded. It has no scripts and a manifest with just a name, so the
// page can list it and say why.
function brokenMod(id, file, loadError) {
  return makeMod({
    name: id,
    file,
    manifest: { id, name: id, version: null, description: null, defaultEnabled: true, settings: [] },
    scripts: {},
    loadError,
  });
}

// `hostFile` / `hostVersion`: the Node part's entry (absolute) and what decides a restart of it.
// `requires` { mod: range }, `permissions` [word], `engines` the Node range it needs: what the loader
// reads (the page is not sent them).
function makeMod({
  name, file, manifest, scripts, loadError = null, hostFile = null, hostVersion = null,
  requires = {}, permissions = [], engines = null,
}) {
  const digest = hash(JSON.stringify([manifest, scripts, loadError, hostVersion]));
  return {
    name, file, core: false, manifest, scripts, loadError, hostFile, hostVersion, requires, permissions, engines,
    version: digest, signature: digest,
  };
}

// What can only be checked once every mod is known: the Node it needs, and the mods it requires
// (there, in a version that will do, and not in a loop). A mod that fails any of it is returned as
// broken, with the reason, and so is whatever required it, in turn.
export function checkRequirements(mods, nodeVersion = process.versions.node) {
  const result = [...mods];
  const byName = () => new Map(result.map(m => [m.name, m]));
  const fail = (mod, message) => {
    result[result.indexOf(mod)] = brokenMod(mod.name, mod.file, message);
    return true;
  };

  for (let changed = true; changed;) {
    changed = false;
    const known = byName();

    for (const mod of result) {
      if (mod.loadError) continue;
      if (mod.engines && !satisfies(nodeVersion, mod.engines)) {
        changed = fail(mod, `需要 Node ${mod.engines}，现在是 ${nodeVersion}`);
        continue;
      }
      for (const [dependency, range] of Object.entries(mod.requires)) {
        const found = known.get(dependency);
        if (!found) changed = fail(mod, `需要 mod「${dependency}」，但没有安装`);
        else if (found.loadError) changed = fail(mod, `需要的 mod「${dependency}」没有装好：${found.loadError}`);
        else if (!satisfies(found.manifest.version, range)) {
          changed = fail(mod, `需要 mod「${dependency}」${range}，装的是 ${found.manifest.version ?? '没有版本号'}`);
        }
        if (changed) break;
      }
    }

    // A loop: following "requires" from a mod leads back to it.
    const looping = new Set();
    for (const mod of result) {
      if (mod.loadError) continue;
      const stack = [[mod.name, [mod.name]]];
      const seen = new Set();
      while (stack.length) {
        const [name, trail] = stack.pop();
        for (const next of Object.keys(byName().get(name)?.requires ?? {})) {
          if (next === mod.name) { trail.forEach(n => looping.add(n)); continue; }
          if (!seen.has(next)) { seen.add(next); stack.push([next, [...trail, next]]); }
        }
      }
    }
    for (const mod of result) {
      if (looping.has(mod.name) && !mod.loadError) changed = fail(mod, `依赖成环：${[...looping].join('、')} 互相需要`);
    }
  }
  return result;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// What one window gets of a mod: always the manifest (the panel draws the settings from it
// even though the code runs elsewhere), and the code written for that window, if any.
// `version` covers exactly those two, so editing main.js leaves the panel's copy alone.
export function unitFor(mod, label) {
  const code = mod.scripts[label] ?? mod.scripts['*'] ?? null;
  return {
    name: mod.name,
    manifest: mod.manifest,
    code,
    loadError: mod.loadError,
    version: hash(JSON.stringify([mod.manifest, code, mod.loadError])),
  };
}

// Framework scripts may contain __MOD_ICON_INACTIVE__ / __MOD_ICON_ACTIVE__, replaced
// by the generated icons (src/lib/icon.js) before the script is hashed or injected, so
// the image is never a pasted blob that can drift from its generator.
export async function discoverCore() {
  const icons = iconDataUrls();
  return (await runtimeScripts()).map(({ name, code: raw }) => {
    const code = raw
      .replaceAll('__MOD_ICON_INACTIVE__', icons.inactive)
      .replaceAll('__MOD_ICON_ACTIVE__', icons.active);
    const digest = `${code.length}:${hash(code)}`;
    return {
      name: CORE_PREFIX + path.basename(name, path.extname(name)),
      file: `runtime/${name}`,
      code,
      core: true,
      version: digest,
      signature: digest,
    };
  });
}

// Everything to inject, in the order to inject it: framework first.
export async function discoverAll(modsDir = MODS_DIR) {
  return [...await discoverCore(), ...await discoverMods(modsDir)];
}

// FNV-1a; we only need change detection, not cryptographic strength.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function modsSignature(mods) {
  return mods.map(m => `${m.name}@${m.signature}`).join('|');
}
