// node src/cli.js selftest — does this build work?
//
// Meant for the packaged exe, where "it built" says nothing about whether it can read what it carries,
// start a mod's Node part, and import a package for it. It touches nothing of the user's: everything
// happens in a temporary folder, against a stand-in for the app. The build runs it and fails if it does.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPackaged, runtimeScripts, windowScript } from '../lib/bundle.js';
import { HostManager } from '../lib/host.js';
import { ensureFolders } from '../lib/layout.js';
import { discoverCore, discoverMods } from '../lib/mods.js';
import { compileCore } from '../lib/page-scripts.js';
import { log, style } from '../lib/output.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}

export default async function selftest() {
  const results = [];
  const check = async (what, run) => {
    try {
      const detail = await run();
      results.push(true);
      log(`  ${style.green('ok  ')} ${what}${detail ? style.dim(`  ${detail}`) : ''}`);
    } catch (err) {
      results.push(false);
      log(`  ${style.red('FAIL')} ${what}: ${err.message ?? err}`);
    }
  };

  log(`${style.bold('selftest')}  ${isPackaged() ? `packaged: ${process.execPath}` : 'from the repository'}`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-selftest-'));

  try {
    await check('the framework scripts can be read, and are valid JavaScript for a page', async () => {
      const raw = await runtimeScripts();
      if (raw.length < 2) throw new Error(`only ${raw.length} framework script(s) found`);
      const core = await discoverCore();
      for (const script of core) new vm.Script(compileCore(script), { filename: script.name });
      return `${core.length} scripts`;
    });

    await check('the script of the window can be read, and is valid PowerShell', async () => {
      const text = await windowScript();
      if (!/ShowDialog/.test(text)) throw new Error('it is not the window script');
      if (process.platform !== 'win32') return 'not checked: not Windows';
      const file = path.join(dir, 'window.ps1');
      await fs.writeFile(file, String.fromCharCode(0xFEFF) + text);
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command',
        `$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$t, [ref]$e); $e | ForEach-Object { $_.Message }`], { windowsHide: true });
      if (stdout.trim()) throw new Error(stdout.trim());
    });

    await check('the folders are made empty, and a mod put in the mods folder is read and loads', async () => {
      const mods = path.join(dir, 'mods');
      const made = await ensureFolders({ dirs: [mods, path.join(dir, 'moddata')] });
      if (made.length !== 2) throw new Error(`made ${made.length} folders, not 2`);
      const empty = await discoverMods(mods);
      if (empty.length) throw new Error(`a new mods folder is not empty: ${empty.map(mod => mod.name).join(', ')}`);
      const mod = path.join(mods, 'selftest-page');
      await fs.mkdir(mod);
      await fs.writeFile(path.join(mod, 'package.json'), JSON.stringify({ name: 'selftest-page', version: '1.0.0' }));
      await fs.writeFile(path.join(mod, 'index.js'), 'mod.log("hi");');
      const loaded = await discoverMods(mods);
      const broken = loaded.filter(item => item.loadError);
      if (loaded.length !== 1 || broken.length) throw new Error(`found ${loaded.length}${broken.length ? `: ${broken[0].loadError}` : ''}`);
      await fs.rm(mod, { recursive: true });
    });

    await check('a mod\'s Node part starts, imports a package from its own node_modules, and answers', async () => {
      const mod = path.join(dir, 'mods', 'selftest-mod');
      await fs.mkdir(path.join(mod, 'node_modules', 'tiny'), { recursive: true });
      await fs.writeFile(path.join(mod, 'package.json'), JSON.stringify({ name: 'selftest-mod', type: 'module', modkit: { host: 'host.js' } }));
      await fs.writeFile(path.join(mod, 'node_modules', 'tiny', 'package.json'), '{"name":"tiny","version":"1.0.0","main":"index.js"}');
      await fs.writeFile(path.join(mod, 'node_modules', 'tiny', 'index.js'), 'module.exports = { answer: 42 };');
      await fs.writeFile(path.join(mod, 'host.js'), `
        import fs from 'node:fs';
        import tiny from 'tiny';
        export default host => host.handle('ask', () => ({ answer: tiny.answer, cwd: process.cwd(), data: fs.existsSync(host.dataDir) }));
      `);

      const replies = [];
      const manager = new HostManager({ dataDir: path.join(dir, 'moddata') });
      manager.connect({
        evaluate: async (window, expression) => { replies.push(expression); },
        evaluateAll: async () => {},
      });
      try {
        manager.setMods(await discoverMods(path.join(dir, 'mods')));
        manager.onPageMessage('main', JSON.stringify({ t: 'hello', mod: 'selftest-mod', window: 'main', enabled: true, config: {} }));
        if (!(await until(() => manager.states()['selftest-mod'] === 'ready'))) {
          throw new Error(`it did not start (${manager.states()['selftest-mod'] ?? 'never began'}): ${replies.filter(r => /hostReport|logFromHost/.test(r)).map(r => r.slice(0, 200)).join(' | ')}`);
        }
        manager.onPageMessage('main', JSON.stringify({ t: 'call', mod: 'selftest-mod', window: 'main', name: 'ask', arg: null, callId: 'selftest' }));
        if (!(await until(() => replies.some(r => r.includes('hostReply?.("selftest"'))))) throw new Error('it did not answer');
        const reply = replies.find(r => r.includes('hostReply?.("selftest"'));
        if (!reply.includes('"answer":42')) throw new Error(`unexpected answer: ${reply}`);
        if (!reply.includes('"data":true')) throw new Error(`its data folder was not made: ${reply}`);
      } finally {
        await manager.close();
      }
    });
  } finally {
    await sleep(200);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter(ok => !ok).length;
  log(failed ? style.red(`\n${failed} of ${results.length} failed`) : style.green(`\nall ${results.length} passed`));
  return failed ? 1 : 0;
}
