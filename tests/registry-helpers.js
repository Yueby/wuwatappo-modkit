// What the tests of the registry and of the MOD page's manager both need: a plugin as an author writes it,
// its zip as the registry's automation makes it, and a GitHub that serves them.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { REGISTRY_REPO, indexUrl } from '../src/lib/registry.js';
import { write } from './app-helpers.js';

const exec = promisify(execFile);
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
const REPO = REGISTRY_REPO;

// A plugin's folder, as an author would write it.
export async function plugin(dir, id, version = '1.0.0', modkit = {}) {
  const folder = path.join(dir, 'src', id);
  await write(path.join(folder, 'package.json'), JSON.stringify({
    name: id, version, displayName: `The ${id}`, description: `what ${id} does`, modkit: { windows: { main: 'main.js' }, ...modkit },
  }));
  await write(path.join(folder, 'main.js'), 'return 1;');
  return folder;
}

// A zip of it, the way the registry's automation makes one, and the index entry that goes with it.
export async function release(dir, folder, extra = {}) {
  const id = path.basename(folder);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const zip = path.join(dir, `${id}-${manifest.version}.zip`);
  await exec(tar, ['-a', '-cf', zip, '-C', folder, '.']);
  const bytes = await fs.readFile(zip);
  const entry = {
    id, name: manifest.displayName, description: manifest.description, version: manifest.version,
    nodePart: false, permissions: [], requires: {}, dependencies: [],
    url: `https://github.com/${REPO}/releases/download/${id}-v${manifest.version}/${id}-${manifest.version}.zip`,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    ...extra,
  };
  return { entry, bytes };
}

// What GitHub would answer: the index, and the files the entries point at.
export function github(releases, { indexText = null } = {}) {
  const files = new Map(releases.map(({ entry, bytes }) => [entry.url, bytes]));
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    if (url === indexUrl(REPO)) return new Response(indexText ?? JSON.stringify({ formatVersion: 1, mods: releases.map(r => r.entry) }));
    if (files.has(url)) return new Response(files.get(url), { headers: { 'content-length': String(files.get(url).length) } });
    return new Response('', { status: 404 });
  };
  return { fetch, asked };
}

