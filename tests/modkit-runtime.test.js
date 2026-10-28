// The framework's runtime behaviour, in the running app: settings that persist and reach
// other windows, the master switch, persist:false, and a broken mod not taking others down.
//
//   node --test tests/modkit-runtime.test.js        (needs the app, started with `lab`)
//
// It installs three throwaway mods next to the real ones (so nothing real is retired), and
// removes them and their stored values afterwards. It never touches a real mod's settings:
// the one thing it checks about auto-click is that it is NOT running, and it stops there.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injector } from '../src/lib/injector.js';
import { discoverAll, discoverMods } from '../src/lib/mods.js';
import { windowLabel } from '../src/lib/targets.js';
import { json, openWindows, until, write } from './app-helpers.js';

const GOOD = 'zz-modkit-test';
const SYNTAX = 'zz-modkit-syntax';
const THROWS = 'zz-modkit-throws';

let tmpDir;
let injector;
let app;                       // openWindows()
let windows;
const inWindow = (label, expression) => app.inWindow(label, expression);

before(async () => {
  app = await openWindows();
  windows = app.windows;

  // Precondition, read-only: never run this while a plugin that acts on the account (auto-click,
  // auto-chest) is switched on: the master switch is the only switch it has, and this test reloads the scripts.
  const on = await inWindow('main', `JSON.stringify(['auto-click', 'auto-chest'].filter(id => window.modkit?.mods.has(id) && modkit.isEnabled(id)))`);
  assert.deepEqual(JSON.parse(on), [], 'a plugin that acts on the account is switched on: switch it off before running this test');

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-runtime-'));

  await write(path.join(tmpDir, GOOD, 'package.json'), json({
    displayName: 'Test',
    modkit: {
      windows: { main: 'main.js' },
      settings: [
        { key: 'flag', type: 'toggle', title: 'Flag', default: false },
        { key: 'temp', type: 'toggle', title: 'Temp', default: false, persist: false },
        { key: 'n', type: 'number', title: 'N', default: 5, min: 1, max: 9 },
        { key: 'shown', type: 'value', title: 'Shown', default: '-' },
      ],
    },
  }));
  await write(path.join(tmpDir, GOOD, 'main.js'), `
    const seen = (window.__zzTest = { starts: (window.__zzTest?.starts ?? 0) + 1, log: window.__zzTest?.log ?? [] });
    mod.config.onChange('n', v => seen.log.push('n=' + v));
    mod.live('shown', 'hello');
    mod.onDispose(() => seen.log.push('disposed'));
  `);

  await write(path.join(tmpDir, SYNTAX, 'package.json'), json({ modkit: { windows: { main: 'main.js' } } }));
  await write(path.join(tmpDir, SYNTAX, 'main.js'), 'let = ;');

  await write(path.join(tmpDir, THROWS, 'package.json'), json({ modkit: { windows: { main: 'main.js' } } }));
  await write(path.join(tmpDir, THROWS, 'main.js'), `
    mod.entry({ title: 'half-built row', value: '1' });
    mod.css('body { outline: 0 }');
    throw new Error('boom');
  `);

  injector = new Injector({ port: 9222 });
  injector.setMods([...await discoverAll(), ...await discoverMods(tmpDir)]);
  await injector.injectAll({ force: true });
});

after(async () => {
  if (injector) {
    // Back to just the real mods: the test mods are retired from every window.
    injector.setMods(await discoverAll());
    await injector.injectAll();
    injector.close();
  }
  if (windows?.length) {
    await inWindow('main', `(() => {
      for (const key of Object.keys(localStorage)) if (/^modkit:[a-z]+:zz-modkit-/.test(key)) localStorage.removeItem(key);
      delete window.__zzTest;
    })()`).catch(() => {});
    app.close();
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

test('every window knows the mod, only the one it names runs it', async () => {
  for (const { target } of windows) {
    const label = windowLabel(target);
    assert.equal(await inWindow(label, `modkit.mods.has(${json(GOOD)})`), true, `${label} has the manifest`);
    const ran = await inWindow(label, `window.__zzTest?.starts ?? 0`);
    assert.equal(ran, label === 'main' ? 1 : 0, `${label} ran it ${ran} time(s)`);
  }
});

test('run state and live figures reach the panel from the window that runs the mod', async () => {
  await until('panel sees the mod as ok', () => inWindow('panel', `modkit.stateOf(${json(GOOD)}).status === 'ok'`));
  await until('panel sees the live figure', () => inWindow('panel', `modkit.live.get(${json(GOOD)})?.get('shown')`));
  assert.equal(await inWindow('panel', `modkit.live.get(${json(GOOD)}).get('shown')`), 'hello');
});

test('a setting written in the panel reaches the mod in main, is clamped, and is shared by every window', async () => {
  assert.equal(await inWindow('panel', `modkit.getConfig(${json(GOOD)}, 'n')`), 5, 'default before any write');

  await inWindow('panel', `modkit.setConfig(${json(GOOD)}, 'n', 7)`);
  await until('main reads 7', async () => (await inWindow('main', `modkit.getConfig(${json(GOOD)}, 'n')`)) === 7);
  await until('the mod was told', async () => (await inWindow('main', `window.__zzTest.log`)).includes('n=7'));

  assert.equal(await inWindow('panel', `modkit.setConfig(${json(GOOD)}, 'n', 99)`), 9, 'clamped to max');
  assert.equal(await inWindow('toast', `modkit.getConfig(${json(GOOD)}, 'n')`), 9, 'another window sees it');
});

test('a key the manifest does not declare is an error, not a silent default', async () => {
  const message = await inWindow('main', `(() => { try { modkit.getConfig(${json(GOOD)}, 'nope'); return 'no error'; } catch (e) { return e.message; } })()`);
  assert.match(message, /not a setting/);
});

test('the master switch stops and restarts the mod; persist:false resets, persisted values stay', async () => {
  await inWindow('panel', `modkit.setConfig(${json(GOOD)}, 'temp', true)`);
  await until('main sees temp on', async () => (await inWindow('main', `modkit.getConfig(${json(GOOD)}, 'temp')`)) === true);

  await inWindow('panel', `modkit.setEnabled(${json(GOOD)}, false)`);
  await until('the mod was disposed in main', async () => (await inWindow('main', `window.__zzTest.log`)).includes('disposed'));
  await until('panel sees it off', () => inWindow('panel', `modkit.stateOf(${json(GOOD)}).status === 'off'`));
  assert.equal(await inWindow('panel', `modkit.live.get(${json(GOOD)})?.get('shown') ?? null`), null, 'its live figures are cleared');

  await inWindow('panel', `modkit.setEnabled(${json(GOOD)}, true)`);
  await until('main started it again', async () => (await inWindow('main', `window.__zzTest.starts`)) === 2);
  assert.equal(await inWindow('main', `modkit.getConfig(${json(GOOD)}, 'temp')`), false, 'persist:false went back to its default');
  assert.equal(await inWindow('main', `modkit.getConfig(${json(GOOD)}, 'n')`), 9, 'a persisted value survived');
  await until('panel sees it ok again', () => inWindow('panel', `modkit.stateOf(${json(GOOD)}).status === 'ok'`));
});

test('the master switch is remembered', async () => {
  await inWindow('panel', `modkit.setEnabled(${json(GOOD)}, false)`);
  assert.equal(await inWindow('toast', `modkit.isEnabled(${json(GOOD)})`), false);
  await inWindow('panel', `modkit.setEnabled(${json(GOOD)}, true)`);
});

test('a mod that does not compile is listed as broken, with the reason', async () => {
  const state = await until('panel sees the syntax error', async () => {
    const s = await inWindow('panel', `modkit.stateOf(${json(SYNTAX)})`);
    return s.status === 'error' ? s : null;
  });
  assert.match(state.error, /Syntax|Unexpected/i);
});

test('a mod that throws is undone, listed as broken, and the others are unaffected', async () => {
  const state = await until('panel sees the failure', async () => {
    const s = await inWindow('panel', `modkit.stateOf(${json(THROWS)})`);
    return s.status === 'error' ? s : null;
  });
  assert.match(state.error, /boom/);
  assert.equal(await inWindow('main', `modkit.entries.filter(e => e.owner === ${json(THROWS)}).length`), 0, 'its half-built row is gone');
  assert.equal(await inWindow('main', `document.querySelectorAll('style[data-wuwa-mod=${json(THROWS)}]').length`), 0, 'its style is gone');
  assert.equal(await inWindow('panel', `modkit.stateOf(${json(GOOD)}).status`), 'ok');
});
