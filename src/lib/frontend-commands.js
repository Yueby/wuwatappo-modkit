// Lists the backend commands the frontend calls.
//
// The bundle is minified and re-hashed on every build, so nothing about `invoke` can be
// assumed from a previous build: its local name differs in each chunk, and so does the
// name the entry chunk exports it under. So both are discovered from the bundle itself:
//
//   1. in the entry chunk, find the function that forwards to
//      window.__TAURI_INTERNALS__.invoke — that is Tauri's `invoke`;
//   2. read the entry chunk's export list to learn what that function is exported as;
//   3. in every chunk, follow its import of that name to the local alias;
//   4. match calls of the alias whose first argument is a string literal.
//
// An earlier version hard-coded the export name found in one build; it kept working on
// the next build only by coincidence.

import fs from 'node:fs';
import path from 'node:path';

export function listCommands(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const entry = files.find(f => /^index-.*\.js$/.test(f) && fs.statSync(path.join(dir, f)).size > 500_000);
  if (!entry) throw new Error(`no entry chunk found in ${dir}`);

  const entrySource = fs.readFileSync(path.join(dir, entry), 'utf8');
  const invokeName = findInvokeFunction(entrySource);
  if (!invokeName) throw new Error(`could not find Tauri's invoke in ${entry}`);

  const exportedAs = exportName(entrySource, invokeName);
  const aliasesInEntry = new Set([invokeName]);
  const found = new Map();

  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const names = file === entry ? aliasesInEntry : importedAs(source, exportedAs, entry);
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

// `function invoke$1(e,t={},n){return window.__TAURI_INTERNALS__.invoke(e,t,n)}` -> "invoke$1"
function findInvokeFunction(source) {
  const match = /function\s+([\w$]+)\s*\(([^)]*)\)\s*\{\s*return\s+window\.__TAURI_INTERNALS__\.invoke\(/.exec(source);
  return match ? match[1] : null;
}

// export{a as p, b as q} with local === `local` -> the name it is exported as ("p").
function exportName(source, local) {
  for (const block of source.match(/export\{([^}]*)\}/g) ?? []) {
    for (const part of block.slice(7, -1).split(',')) {
      const [name, alias] = part.split(' as ').map(s => s.trim());
      if (name === local) return alias ?? name;
    }
  }
  return local;
}

// import{p as e, q} from "./entry.js" -> the local names that `exported` is imported as.
function importedAs(source, exported, entryFile) {
  const names = new Set();
  const pattern = new RegExp(`import\\{([^}]*)\\}from"\\./${escapeRegExp(entryFile)}"`, 'g');
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const [original, alias] = part.split(' as ').map(s => s.trim());
      if (original === exported) names.add(alias ?? original);
    }
  }
  return names;
}

function callsOf(source, identifier) {
  const pattern = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(identifier)}\\(\\s*"([^"]+)"`, 'g');
  return [...source.matchAll(pattern)].map(m => m[1]);
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
