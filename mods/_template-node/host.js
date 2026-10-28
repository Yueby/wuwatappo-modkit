// The Node part of a mod: an ES module that runs in the loader's process (only while `watch` is
// running), in a thread of its own. Anything Node can do is available here: files, sockets,
// child processes, packages installed with `npm install` in this folder.
//
// It is stopped when the mod is switched off or edited, and started again from a clean module
// graph, so it does not have to guard against being reloaded.
//
// "type": "module" in package.json is what makes this file an ES module; leave it in.

import fs from 'node:fs/promises';
import path from 'node:path';

export default async function (host) {
  const file = path.join(host.dataDir, 'entries.json');       // dataDir is this mod's own folder, and it exists

  const read = () => fs.readFile(file, 'utf8').then(JSON.parse, () => []);
  const write = entries => fs.writeFile(file, JSON.stringify(entries, null, 2));

  // Called by the page: mod.host.call('add', text). Whatever is returned goes back to it.
  host.handle('add', async text => {
    const entries = [...await read(), { at: new Date().toISOString(), text: String(text) }];
    const kept = entries.slice(-host.config.get('keep'));     // the same setting the MOD page shows
    await write(kept);
    host.emit('count', kept.length);                          // heard by mod.host.on('count', fn)
    return kept.length;
  });

  host.handle('list', read);

  host.log('started, keeping', host.config.get('keep'), 'entries in', file);

  // Optional: return a function to run when the part is stopped.
  return () => host.log('stopped');
}
