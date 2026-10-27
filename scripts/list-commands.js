#!/usr/bin/env node
// Lists the backend commands the frontend calls.
//
// The bundle minifies `invoke` to a one-letter local alias per chunk, and the
// export name from the shared chunk changes between builds. So: read the export
// map from the entry chunk, follow each module's import of that name, then match
// calls of the resulting identifier.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_DIR = path.join(PROJECT_ROOT, 'work', 'assets', 'assets');

// The export that holds Tauri's `invoke`, from @tauri-apps/api/core.
const EXPORT_NAME = 'p';

export function listCommands(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const entry = files.find(f => /^index-.*\.js$/.test(f) && fs.statSync(path.join(dir, f)).size > 500_000);
  if (!entry) throw new Error(`no entry chunk found in ${dir}`);

  const entrySource = fs.readFileSync(path.join(dir, entry), 'utf8');
  const aliasesInEntry = exportedAliases(entrySource, EXPORT_NAME);
  const found = new Map();

  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const names = file === entry ? aliasesInEntry : importedAs(source, EXPORT_NAME, entry);
    for (const name of names) {
      for (const command of callsOf(source, name)) {
        if (!found.has(command)) found.set(command, new Set());
        found.get(command).add(file);
      }
    }
  }

  return [...found.entries()]
    .map(([command, sources]) => ({ command, sources: [...sources] }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

// export{a as p, b as q} -> the local names that map onto `exported`.
function exportedAliases(source, exported) {
  const names = new Set([exported]);
  for (const block of source.match(/export\{([^}]*)\}/g) ?? []) {
    for (const part of block.slice(7, -1).split(',')) {
      const [local, alias] = part.split(' as ').map(s => s.trim());
      if (alias === exported && local) names.add(local);
    }
  }
  return names;
}

// import{X as local} from "./entry.js" -> local names for `imported`.
function importedAs(source, imported, entryFile) {
  const names = new Set();
  const pattern = new RegExp(`import\\{([^}]*)\\}from"\\./${escapeRegExp(entryFile)}"`, 'g');
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const [original, alias] = part.split(' as ').map(s => s.trim());
      if (original && (alias ?? original) === imported || alias === imported) {
        names.add(alias ?? original);
      }
    }
  }
  return names;
}

function callsOf(source, identifier) {
  const pattern = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(identifier)}\\(\\s*"([^"]+)"`, 'g');
  return [...source.matchAll(pattern)].map(m => m[1]);
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir = DEFAULT_DIR] = process.argv.slice(2);
  const commands = listCommands(dir);
  console.log(`${commands.length} commands`);
  for (const { command, sources } of commands) {
    console.log(`  ${command.padEnd(42)} ${sources.join(', ')}`);
  }
}