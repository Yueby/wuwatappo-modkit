// node src/cli.js mods <list | install <source> | update [id] | remove <id>>
//
//   install <source>   a folder, a .zip/.tgz, a git URL (add #branch), an npm package name, or a .js file
//     --force            replace one that is already installed
//     --no-deps          do not run npm install for the mod's dependencies
//     --allow-scripts    let those dependencies' install scripts run (they do not, by default)
//   update [id]        fetch an installed mod again from where it came from (all of them if no id)
//   remove <id>        delete it
//     --purge            also delete the files its Node part kept (<app folder>\moddata\<id>)
//   list               what is installed, where it came from, and whether it loads
//
// Reading what a mod declares comes before putting it in place; there is no prompt, because the
// command is the decision. A running `watch` / `start` picks the change up by itself.

import { installMod, listMods, readSource, removeMod, updateMod } from '../lib/install.js';
import { discoverMods } from '../lib/mods.js';
import path from 'node:path';
import { field, log, section, style } from '../lib/output.js';
import { parseOptions } from './options.js';

export default async function mods(argv) {
  const options = parseOptions(argv);
  const [action = 'list', ...rest] = options.positional;
  const common = { modsDir: options.modsDir };

  switch (action) {
    case 'list':
      return list(common.modsDir);

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
      const ids = rest.length ? rest : await installedFromSomewhere(common.modsDir);
      if (!ids.length) {
        log('nothing to update: no installed mod knows where it came from');
        return 0;
      }
      let failed = 0;
      for (const id of ids) {
        try {
          const result = await updateMod(id, {
            ...common,
            noDeps: options.noDeps,
            allowScripts: options.allowScripts,
            report: () => {},
          });
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
      const { removed, purged } = await removeMod(rest[0], { ...common, purge: options.purge });
      log(`removed ${removed}`);
      if (purged) log('and the files its Node part kept');
      log(style.dim('  Its settings are kept by the app (they are in its storage); they are used again if it is installed again.'));
      return 0;
    }

    default:
      throw new Error(`unknown action "${action}": use list, install, update or remove`);
  }
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
