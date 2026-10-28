// node src/cli.js mods <browse | get <id> | list | install <source> | update [id] | remove <id> | check <folder>>
//
//   browse             the plugins in the registry (docs/REGISTRY.md), and which are installed here
//   get <id>           install one from the registry; says what it declares and asks first
//     --yes              do not ask (what a window that has asked already runs)
//   list               what is installed, where it came from, and whether it loads
//   install <source>   a folder, a .zip/.tgz, a git URL (add #branch), an npm package name, or a .js file
//     --force            replace one that is already installed
//     --no-deps          do not run npm install for the mod's dependencies
//     --allow-scripts    let those dependencies' install scripts run (they do not, by default)
//   update [id]        fetch an installed mod again from where it came from (all of them if no id)
//   remove <id>        delete it
//     --purge            also delete the files its Node part kept (<app folder>\moddata\<id>)
//   check <folder>     is this folder a mod that can be loaded (for authors; --registry: what the registry also needs)
//   --json             (browse, check) the answer as JSON, for other programs
//
// `install` has no prompt, because the command is the decision. `get` asks, because a plugin from the
// registry is somebody else's code and what it declares is worth reading first. A running `watch` /
// `start` picks a change up by itself.

import path from 'node:path';
import readline from 'node:readline/promises';
import { InstallDeclined, checkMod, installMod, listMods, readSource, removeMod, updateMod } from '../lib/install.js';
import { developing } from '../lib/devmode.js';
import { discoverMods } from '../lib/mods.js';
import { browse, getFromRegistry, updateFromRegistry } from '../lib/registry.js';
import { field, log, section, style } from '../lib/output.js';
import { parseOptions } from './options.js';

export default async function mods(argv) {
  const options = parseOptions(argv);
  const [action = 'list', ...rest] = options.positional;
  const common = { modsDir: options.modsDir };

  switch (action) {
    case 'list':
      return list(common.modsDir);

    case 'browse':
      return browseRegistry(common.modsDir, options);

    case 'get': {
      if (!rest[0]) throw new Error('get which? (node src/cli.js mods browse shows the names)');
      await refuseIfDeveloping([rest[0]], 'get');
      try {
        const result = await getFromRegistry(rest[0], {
          ...common,
          force: options.force,
          expect: options.expect,
          confirm: info => ask(info, options),
        });
        done(result, 'installed');
        return 0;
      } catch (err) {
        if (err instanceof InstallDeclined) {
          log('not installed');
          return 1;
        }
        throw err;
      }
    }

    case 'check':
      return check(rest[0], options);

    case 'install': {
      if (!rest[0]) throw new Error('install what? a folder, a .zip/.tgz, a git URL, an npm package name or a .js file');
      const result = await installMod(rest[0], {
        ...common,
        force: options.force,
        noDeps: options.noDeps,
        allowScripts: options.allowScripts,
        report: info => show('Installing', info),
      });
      done(result, 'installed');
      return 0;
    }

    case 'update': {
      await refuseIfDeveloping(rest, 'update');
      const ids = rest.length ? rest : (await installedFromSomewhere(common.modsDir)).filter(id => !developingNow.has(id));
      if (!ids.length) {
        log('nothing to update: no installed mod knows where it came from');
        return 0;
      }
      let failed = 0;
      for (const id of ids) {
        try {
          const result = await updateOne(id, common, options);
          if (result.unchanged) log(`${style.dim(id.padEnd(20))} already ${result.version}`);
          else log(`${style.green(id.padEnd(20))} ${result.before ?? '?'} → ${result.version ?? '?'}${result.warning ? `  ${style.yellow(result.warning)}` : ''}`);
        } catch (err) {
          failed += 1;
          log(`${style.red(id.padEnd(20))} ${err.message.split('\n')[0]}`);
        }
      }
      return failed ? 1 : 0;
    }

    case 'remove': {
      if (!rest[0]) throw new Error('remove which? (node src/cli.js mods list shows the names)');
      await refuseIfDeveloping([rest[0]], 'remove');
      const { removed, purged } = await removeMod(rest[0], { ...common, purge: options.purge });
      log(`removed ${removed}`);
      if (purged) log('and the files its Node part kept');
      log(style.dim('  Its settings are kept by the app (they are in its storage); they are used again if it is installed again.'));
      return 0;
    }

    default:
      throw new Error(`unknown action "${action}": use browse, get, list, install, update, remove or check`);
  }
}

// A plugin that is in use from a dev folder is not the installed copy: installing, updating or removing it here
// would be about a copy that is not the one in use. (The page is held to the same rule: lib/manager.js.)
let developingNow = new Set();
async function refuseIfDeveloping(ids, action) {
  developingNow = await developing();
  const found = ids.filter(id => developingNow.has(id));
  if (found.length) throw new Error(`${found.join(', ')} is in use from a dev folder, so it is not ${action === 'get' ? 'installed' : action === 'update' ? 'updated' : 'removed'} here: node src/cli.js dev off first`);
}

// One installed mod, fetched again from where it came from: the registry, or what it was installed from.
async function updateOne(id, common, options) {
  const source = await readSource(path.join(common.modsDir, id));
  if (source?.type === 'registry') {
    return updateFromRegistry(id, { ...common, expect: options.expect, confirm: info => ask(info, options, { updating: true }) });
  }
  return updateMod(id, { ...common, noDeps: options.noDeps, allowScripts: options.allowScripts, report: () => {} });
}

async function installedFromSomewhere(modsDir) {
  const ids = [];
  for (const mod of await discoverMods(modsDir)) {
    if (mod.file.endsWith('package.json') && await readSource(path.dirname(mod.file))) ids.push(mod.name);
  }
  return ids;
}

async function list(modsDir) {
  const rows = await listMods(modsDir);
  if (!rows.length) {
    log(`no mods in ${modsDir}`);
    return 0;
  }
  section(`Mods in ${modsDir}`);
  for (const row of rows) {
    const flags = [row.nodePart ? 'Node' : null, ...row.permissions].filter(Boolean).join(', ');
    log(`  ${style.bold(row.id.padEnd(20))} ${(row.version ?? '-').padEnd(8)} ${row.problem ? style.red('broken') : style.green('ok    ')}  ${style.dim(row.source)}`);
    if (row.name !== row.id) log(`  ${' '.repeat(20)} ${row.name}`);
    if (flags) log(`  ${' '.repeat(20)} ${style.dim(flags)}`);
    if (row.requires.length) log(`  ${' '.repeat(20)} ${style.dim(`needs ${row.requires.join(', ')}`)}`);
    if (row.problem) log(`  ${' '.repeat(20)} ${style.red(row.problem.split('\n')[0])}`);
  }
  return 0;
}

async function browseRegistry(modsDir, options) {
  const { entries, problems } = await browse({ modsDir });
  if (options.json) {
    log(JSON.stringify({ mods: entries, problems }));
    return 0;
  }
  if (!entries.length) {
    log('the registry has no plugins yet');
    return 0;
  }
  section('Plugins in the registry');
  for (const entry of entries) {
    const state = entry.update ? style.yellow(`update ${entry.installedVersion ?? '?'} → ${entry.version}`)
      : entry.installed ? style.green(`installed ${entry.installedVersion ?? ''}`.trim())
        : style.dim('not installed');
    log(`  ${style.bold(entry.id.padEnd(20))} ${entry.version.padEnd(8)} ${state}`);
    if (entry.description) log(`  ${' '.repeat(20)} ${entry.description}`);
    const flags = [entry.nodePart ? 'Node part' : null, ...entry.permissions].filter(Boolean).join(', ');
    if (flags) log(`  ${' '.repeat(20)} ${style.dim(flags)}`);
  }
  for (const problem of problems) log(style.yellow(`  skipped: ${problem}`));
  log(style.dim('\n  node src/cli.js mods get <name>   installs one'));
  return 0;
}

async function check(folder, options) {
  if (!folder) throw new Error('check which folder?');
  const result = await checkMod(folder, { registry: options.registry });
  if (options.json) {
    log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    log(`${style.green('ok')}  ${result.id} ${result.version ?? ''}`.trim());
    return 0;
  }
  log(`${style.red('not a mod that can be loaded')}  ${result.id}`);
  for (const problem of result.problems) log(`  - ${problem}`);
  return 1;
}

// What a plugin declares, shown, and the question. Without --yes a terminal is asked; anything else is
// refused, so that a script cannot install somebody's code by forgetting to say it has looked.
async function ask(info, options, { updating = false } = {}) {
  show(updating ? 'Updating' : 'Installing', info);
  if (options.yes) return true;
  if (!process.stdin.isTTY) throw new Error('this needs a yes: run it in a terminal, or add --yes once you have read what it declares');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`\n${updating ? 'Update' : 'Install'} it? [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

// What the mod says about itself, before it is put in place.
function show(title, info) {
  section(`${title} ${info.name}`);
  field('id', info.id);
  if (info.version) field('version', info.version);
  if (info.description) field('about', info.description);
  field('Node part', info.nodePart ? style.yellow('yes: it runs as ordinary Node, with the rights of your account') : 'no');
  if (info.permissions.length) field('declares', info.permissions.join(', '));
  if (Object.keys(info.requires).length) field('needs mods', Object.entries(info.requires).map(([k, v]) => `${k} ${v}`).join(', '));
  if (info.dependencies.length) field('npm packages', info.dependencies.join(', '));
}

function done(result, verb) {
  if (result.warning) log(`\n${style.yellow('note')}  ${result.warning}\n  It is installed, and listed as broken until that is put right.`);
  if (result.installedDependencies) log(`  npm packages installed (their install scripts were not run; --allow-scripts if one needs them)`);
  log(`\n${style.green(verb)}  ${result.target}${result.replaced ? style.dim('  (replaced the old one)') : ''}`);
  log(style.dim('  A running watch / start picks it up by itself; otherwise: node src/cli.js watch'));
}
