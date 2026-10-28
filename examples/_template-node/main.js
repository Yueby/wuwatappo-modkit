// The page part: runs in the main window. It talks to host.js through mod.host.
// "windows" in package.json says which window runs this file.

// What the Node part sends: shown in the "已记录" row of the MOD page.
mod.host.on('count', n => mod.live('count', `${n} 条`));

// mod.host.call rejects if the Node part is not running (the loader only runs it under `watch`).
window.__templateNodeAdd = text => mod.host.call('add', text);

try {
  const entries = await mod.host.call('list');
  mod.live('count', `${entries.length} 条`);
} catch (err) {
  mod.warn(err.message);
}
