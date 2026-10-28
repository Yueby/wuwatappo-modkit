// The plugin registry: a GitHub repository (REGISTRY_REPO) that people send plugins to and that is
// reviewed by hand, and what this program takes from it.
//
// The repository's own automation (docs/REGISTRY.md) packs each plugin version into a zip, attaches it
// to a release, and keeps one file, index.json, as an asset of a release called `index`:
//
//   { "formatVersion": 1, "mods": [ { id, name, description, version, author?, nodePart, permissions,
//       requires, dependencies, url, sha256, size } ] }
//
// What is trusted, and what is not: the index says which file belongs to which plugin and what it must
// hash to, and a download that does not match is thrown away. The address in an entry must be a release
// asset of the registry's own repository, so an entry cannot send this program anywhere else. What the
// plugin then declares is read from the package itself and compared with the index before anything is
// put in place, and shown to the person, who says yes or no (see installMod's `confirm`).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InstallDeclined, installMod, listMods, readSource } from './install.js';
import { compareVersions, downloadVerified } from './release.js';
import { parse } from './semver.js';

export const REGISTRY_REPO = 'Yueby/wuwatappo-mods';
export const indexUrl = (repo = REGISTRY_REPO) => `https://github.com/${repo}/releases/download/index/index.json`;

const ID = /^[a-z0-9][a-z0-9._-]*$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const FORMAT_VERSION = 1;

const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');

// What is wrong with one entry, or null.
function problemWith(entry, repo) {
  if (entry === null || typeof entry !== 'object') return 'is not an object';
  if (typeof entry.id !== 'string' || !ID.test(entry.id)) return 'has no usable id';
  if (typeof entry.name !== 'string' || !entry.name.trim()) return 'has no name';
  if (typeof entry.version !== 'string' || !parse(entry.version)) return `has version "${entry.version}", which is not one`;
  if (typeof entry.nodePart !== 'boolean') return 'does not say whether it has a Node part';
  if (!strings(entry.permissions)) return 'permissions must be a list of words';
  if (!strings(entry.dependencies)) return 'dependencies must be a list of names';
  if (entry.requires === null || typeof entry.requires !== 'object' || Array.isArray(entry.requires)) return 'requires must be an object';
  if (entry.description != null && typeof entry.description !== 'string') return 'description must be text';
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) return 'has no SHA-256';
  if (!Number.isInteger(entry.size) || entry.size <= 0) return 'has no size';
  const prefix = `https://github.com/${repo}/releases/download/`;
  if (typeof entry.url !== 'string' || !entry.url.startsWith(prefix) || /[\s"<>\\]/.test(entry.url) || entry.url.includes('..')) {
    return `its address is not a release asset of ${repo}`;
  }
  return null;
}

// The entries that are fit to use, and what was wrong with the rest (one bad entry does not hide the others).
export function parseIndex(text, { repo = REGISTRY_REPO } = {}) {
  let index;
  try {
    index = JSON.parse(text);
  } catch (err) {
    throw new Error(`the plugin index is not JSON: ${err.message}`);
  }
  if (index?.formatVersion !== FORMAT_VERSION || !Array.isArray(index.mods)) {
    throw new Error(`the plugin index is not in a format this program knows (formatVersion ${index?.formatVersion}; it knows ${FORMAT_VERSION}): update the program`);
  }

  const entries = [];
  const problems = [];
  const seen = new Set();
  for (const entry of index.mods) {
    const problem = problemWith(entry, repo);
    if (problem) problems.push(`${entry?.id ?? '(no id)'}: ${problem}`);
    else if (seen.has(entry.id.toLowerCase())) problems.push(`${entry.id}: listed twice`);
    else {
      seen.add(entry.id.toLowerCase());
      entries.push({ ...entry, description: entry.description ?? '', author: entry.author ?? null });
    }
  }
  return { entries, problems };
}

export async function fetchIndex({ repo = REGISTRY_REPO, fetch = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetch(indexUrl(repo), { headers: { 'user-agent': 'wuwatappo-modkit' }, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`could not reach the plugin registry (${repo}): ${err.message}`);
  }
  if (response.status === 404) throw new Error(`the plugin registry (${repo}) has no index yet`);
  if (!response.ok) throw new Error(`the plugin registry answered ${response.status}`);
  return parseIndex(await response.text(), { repo });
}

// The registry's plugins, each with what is known of it here: installed or not, from the registry or from
// somewhere else, and whether the registry has a newer version.
export async function browse({ modsDir, repo = REGISTRY_REPO, fetch, index = null }) {
  const { entries, problems } = index ?? await fetchIndex({ repo, fetch });
  const here = new Map((await listMods(modsDir)).map(mod => [mod.id.toLowerCase(), mod]));

  const merged = await Promise.all(entries.map(async entry => {
    const mod = here.get(entry.id.toLowerCase());
    const source = mod ? await readSource(path.join(modsDir, mod.id)) : null;
    const fromRegistry = source?.type === 'registry';
    return {
      ...entry,
      installed: Boolean(mod),
      installedVersion: mod?.version ?? null,
      fromRegistry,
      update: Boolean(mod) && fromRegistry && (mod.version === null || compareVersions(entry.version, mod.version) > 0),
    };
  }));
  return { entries: merged, problems };
}

// Download a plugin and install it. `confirm(info)` is asked with what the package itself declares, after
// it has been checked against the index, and before it is put in place. `replace` is for an update.
export async function getFromRegistry(id, { modsDir, repo = REGISTRY_REPO, fetch, index = null, confirm = null, force = false, replace = null, tools }) {
  const { entries } = index ?? await fetchIndex({ repo, fetch });
  const entry = entries.find(candidate => candidate.id.toLowerCase() === String(id).toLowerCase());
  if (!entry) throw new Error(`the registry has no plugin called "${id}"`);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-registry-'));
  try {
    const zip = path.join(temp, `${entry.id}.zip`);
    await downloadVerified(entry.url, zip, { expected: entry.sha256, size: entry.size, fetch });

    return await installMod(zip, {
      modsDir, force, replace, tools,
      source: { type: 'registry', spec: entry.id },
      confirm: async info => {
        // The index is a claim, the package is the fact: the two have to agree on who it is.
        if (info.id !== entry.id) throw new Error(`the package is called "${info.id}", not "${entry.id}" as the index says: it was not installed`);
        if (info.version !== entry.version) throw new Error(`the package is version ${info.version}, not ${entry.version} as the index says: it was not installed`);
        return confirm ? confirm({ ...info, entry }) : true;
      },
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

// An installed plugin that came from the registry, fetched again if the registry has a newer version.
// Resolves with { unchanged: true, version } when it is current.
export async function updateFromRegistry(id, { modsDir, ...options }) {
  const folder = path.join(modsDir, id);
  const source = await readSource(folder);
  if (source?.type !== 'registry') throw new Error(`${id} did not come from the registry, so there is nothing to ask there`);

  const index = options.index ?? await fetchIndex(options);
  const entry = index.entries.find(candidate => candidate.id === source.spec);
  const mod = (await listMods(modsDir)).find(candidate => candidate.id === id);
  if (!entry) throw new Error(`the registry no longer has a plugin called "${source.spec}"`);
  if (mod?.version && compareVersions(entry.version, mod.version) <= 0) return { unchanged: true, version: mod.version };

  const done = await getFromRegistry(entry.id, { modsDir, ...options, index, replace: id });
  return { ...done, before: mod?.version ?? null, unchanged: false };
}

export { InstallDeclined };
