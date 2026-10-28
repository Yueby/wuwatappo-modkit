// Loading scripts from disk: the framework runtime, and the user's mods.
//
//   src/runtime/*.js   framework — injected first, into every window, always
//   mods/*.js          user mods — injected after the framework
//
// They share one pipeline (same wrapper, same hot reload), but they are kept apart
// on purpose: the manager page lists the user's mods, so the code that draws that
// page must not be one of them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { iconDataUrls } from './icon.js';
import { MODS_DIR, RUNTIME_DIR } from './paths.js';

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

export function discoverMods(dir = MODS_DIR) {
  return readScripts(dir);
}

// Framework scripts may contain __MOD_ICON_INACTIVE__ / __MOD_ICON_ACTIVE__, replaced
// by the generated icons (src/lib/icon.js) before the script is hashed or injected, so
// the image is never a pasted blob that can drift from its generator.
export async function discoverCore() {
  const scripts = await readScripts(RUNTIME_DIR, { prefix: CORE_PREFIX, core: true });
  const icons = iconDataUrls();
  return scripts.map(script => {
    const code = script.code
      .replaceAll('__MOD_ICON_INACTIVE__', icons.inactive)
      .replaceAll('__MOD_ICON_ACTIVE__', icons.active);
    if (code === script.code) return script;
    const digest = `${code.length}:${hash(code)}`;
    return { ...script, code, version: digest, signature: digest };
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
