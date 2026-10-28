// A mod's Node part against the running app: the real CDP binding, the real heartbeat, the real
// panel window. Only the panel window is attached to, so nothing that runs in main (a real mod
// acting on the account, say) is touched or restarted.
//
//   node --test tests/modkit-host.test.js        (needs the app, started with `lab`)
//
// It installs one throwaway mod with a Node part, and removes it, its stored values and the
// binding it left in the window afterwards.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostManager } from '../src/lib/host.js';
import { Injector } from '../src/lib/injector.js';
import { discoverAll, discoverCore, discoverMods } from '../src/lib/mods.js';
import { json, openWindows, sleep, until, write } from './app-helpers.js';

const ID = 'zz-host-live';

let app;
let tmpDir;
let injector;
let hosts;

const panel = expression => app.inWindow('panel', expression);

before(async () => {
  app = await openWindows();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-host-live-'));

  await write(path.join(tmpDir, ID, 'package.json'), json({
    type: 'module',
    displayName: 'Host live test',
    modkit: {
      host: 'host.js',
      windows: { panel: 'main.js' },
      settings: [
        { key: 'n', type: 'number', title: 'N', default: 5, min: 0, max: 99 },
        { key: 'shown', type: 'value', title: 'Shown', default: '-' },
      ],
    },
  }));
  await write(path.join(tmpDir, ID, 'host.js'), `export default function (host) {
    host.log('host says hi');
    host.live('shown', 'from node');
    host.handle('double', n => n * 2);
    host.handle('inpanel', () => host.evaluate('panel', '1 + 1'));
    host.handle('n', () => host.config.get('n'));
  }`);
  // The page half asks as soon as it runs, while the Node part is still starting.
  await write(path.join(tmpDir, ID, 'main.js'), `
    mod.log('page says hi');
    window.__answer = await mod.host.call('double', 21);
  `);

  const logs = [];
  hosts = new HostManager({ dataDir: path.join(tmpDir, 'data'), log: line => logs.push(line) });
  injector = new Injector({ port: 9222, only: ['panel'] });
  hosts.connect(injector);
  injector.onHostMessage = (window, text) => hosts.onPageMessage(window, text);

  injector.setMods([...await discoverCore(), ...await discoverMods(tmpDir)]);   // real mods are retired from the panel
  hosts.setMods(await discoverMods(tmpDir));
  await injector.injectAll({ force: true });

  const present = JSON.parse(await panel(`JSON.stringify([...modkit.mods.keys()])`));
  assert.ok(present.length && present.every(id => id.startsWith('zz-')), `real mods are still in the panel: ${present}`);
});

after(async () => {
  await hosts?.close();
  if (injector) {
    injector.onHostMessage = null;
    injector.setMods(await discoverAll());
    await injector.injectAll();
    injector.close();
  }
  if (app) {
    await panel(`(() => {
      for (const key of Object.keys(localStorage)) if (/^modkit:[a-z]+:zz-/.test(key)) localStorage.removeItem(key);
      delete window.__modkitHost;       // a binding outlives the session that added it
      delete window.__answer;
    })()`).catch(() => {});
    app.close();
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

test('the page half reaches the Node part through the real binding, even while it is starting', async () => {
  await until('the answer came back', async () => (await panel('window.__answer')) === 42);
  assert.equal(await panel(`typeof window.__modkitHost`), 'function', 'the loader added its binding to the window');
  assert.equal(hosts.states()[ID], 'ready');
  assert.deepEqual(JSON.parse(await panel(`JSON.stringify(modkit.stateOf(${json(ID)}))`)), { status: 'ok' });
});

test('the Node part can run JavaScript in a window and read the settings', async () => {
  assert.equal(await panel(`modkit.hostCall(${json(ID)}, 'inpanel', null, 'panel')`), 2);
  assert.equal(await panel(`modkit.hostCall(${json(ID)}, 'n', null, 'panel')`), 5);

  await panel(`modkit.setConfig(${json(ID)}, 'n', 12)`);
  await until('the Node part sees 12', async () => (await panel(`modkit.hostCall(${json(ID)}, 'n', null, 'panel')`)) === 12);
});

test('what it logged and published is on the page', async () => {
  const lines = JSON.parse(await panel(`JSON.stringify(modkit.logs.filter(e => e.mod === ${json(ID)}).map(e => [e.source, e.level, e.text]))`));
  assert.ok(lines.some(l => l[0] === 'panel' && l[2] === 'page says hi'), 'the page half, from the panel window');
  assert.ok(lines.some(l => l[0] === 'node' && l[2] === 'host says hi'), 'the Node part, marked as node');
  assert.equal(await panel(`modkit.live.get(${json(ID)})?.get('shown')`), 'from node');
});

test('switching the mod off stops it; a call then fails at once, with the reason', async () => {
  await panel(`modkit.setEnabled(${json(ID)}, false)`);
  await until('stopped', () => Object.keys(hosts.states()).length === 0);
  assert.equal(await panel(`modkit.live.get(${json(ID)})?.get('shown') ?? null`), null, 'its figures are withdrawn');
  await assert.rejects(panel(`modkit.hostCall(${json(ID)}, 'double', 1, 'panel')`), /not running/);

  await panel(`modkit.setEnabled(${json(ID)}, true)`);
  await until('started again', () => hosts.states()[ID] === 'ready');
  assert.equal(await panel(`modkit.hostCall(${json(ID)}, 'double', 4, 'panel')`), 8);
});

test('when the loader goes, the binding stays but a call fails within seconds instead of waiting 30', async () => {
  await hosts.close();                     // no more heartbeats
  injector.onHostMessage = null;
  injector.close();
  assert.equal(await panel(`typeof window.__modkitHost`), 'function', 'the function outlives the session (as measured)');

  await sleep(7000);                       // a page treats the loader as gone after 6 s without a beat
  const began = Date.now();
  await assert.rejects(panel(`modkit.hostCall(${json(ID)}, 'double', 1, 'panel')`), /not running/);
  assert.ok(Date.now() - began < 2000, 'at once, not after the 30 s timeout');
});
