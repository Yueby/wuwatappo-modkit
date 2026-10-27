// Loading mods from disk.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_MODS_DIR = path.join(PROJECT_ROOT, 'mods');

// Files starting with "_" are helpers/fragments and are not loaded.
const MOD_FILE = /\.(m?js)$/i;
const IGNORED = /^[_.]/;

export async function discoverMods(dir = DEFAULT_MODS_DIR) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const files = entries
    .filter(e => e.isFile() && MOD_FILE.test(e.name) && !IGNORED.test(e.name))
    .map(e => e.name)
    .sort();

  const mods = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const code = await fs.readFile(fullPath, 'utf8');
    const digest = hash(code);
    mods.push({
      name: path.basename(file, path.extname(file)),
      file: fullPath,
      code,
      // `version` is what the page compares against to decide whether a change
      // is a no-op retry or a genuine reload of a modified file.
      version: `${code.length}:${digest}`,
      signature: `${code.length}:${digest}`,
    });
  }
  return mods;
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