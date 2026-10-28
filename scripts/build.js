// node scripts/build.js — one exe: dist/modkit.exe
//
//   1. esbuild turns src/entry.js and everything it imports into one CommonJS script (a single
//      executable application must start from one file).
//   2. The framework scripts (src/runtime/) and the script of the exe's window (src/window.ps1) are
//      embedded beside it as assets. No mods are: the exe carries none, they are put in the app
//      folder's mods folder by whoever wants them.
//   3. node --experimental-sea-config makes the blob, and postject puts it into a copy of node.exe.
//   4. The result runs its own `selftest`, and the build fails if that does.
//
// The result is about the size of node.exe. Needs the devDependencies (npm install); using the
// exe needs nothing.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const exe = path.join(dist, 'modkit.exe');

// The sentinel postject looks for in node.exe: it is part of Node's single executable support.
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${result.status ?? result.error?.message})`);
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

console.log('bundle');
await build({
  entryPoints: [path.join(root, 'src', 'entry.js')],
  outfile: path.join(dist, 'modkit.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // `import.meta.url` does not exist in a CommonJS script. The few places that use it only compute
  // where the repository is, and a packaged program does not look there (see PROJECT_ROOT in paths.js).
  define: { 'import.meta.url': '"file:///C:/packaged/"' },
  logLevel: 'warning',
});

console.log('assets');
const assets = {};
for (const name of (await fs.readdir(path.join(root, 'src', 'runtime'))).filter(n => /\.js$/.test(n)).sort()) {
  assets[`runtime/${name}`] = path.join(root, 'src', 'runtime', name);
}
const indexFile = path.join(dist, 'index.json');
await fs.writeFile(indexFile, JSON.stringify(Object.keys(assets)));
assets['index.json'] = indexFile;
assets['window.ps1'] = path.join(root, 'src', 'window.ps1');

const seaConfig = path.join(dist, 'sea-config.json');
const blob = path.join(dist, 'sea-prep.blob');
await fs.writeFile(seaConfig, JSON.stringify({
  main: path.join(dist, 'modkit.cjs'),
  output: blob,
  disableExperimentalSEAWarning: true,
  assets,
}, null, 2));

console.log('blob');
run(process.execPath, ['--experimental-sea-config', seaConfig]);

console.log('exe');
await fs.copyFile(process.execPath, exe);
run(process.execPath, [path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SEA_FUSE]);

const { size } = await fs.stat(exe);
console.log(`built ${exe} (${(size / 1024 / 1024).toFixed(1)} MB)`);

console.log('selftest');
run(exe, ['selftest'], { cwd: dist });
