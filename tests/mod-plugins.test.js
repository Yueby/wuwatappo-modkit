// The MOD page's plugins dialog as a person uses it: the 安装 button in the title row, the list from the
// registry, the question before anything is installed, and what happens after. Real mouse events, in the
// running app, against a registry that is a stand-in (a fetch that serves an index and a zip) and a temporary
// mods folder.
//
//   node --test tests/mod-plugins.test.js        (needs the app, with its DevTools port)
//
// Like mod-dialog.test.js it works on the panel window only (the one window it attaches to), and the real
// mods are taken out of the panel while it runs. Reloading the framework scripts in the panel also clears
// what a mod has that does not persist, in every window (it is shared storage): do not run it while
// something that was switched on by hand (auto-click) is running.
//
// The page talks to the loader through a binding the loader added. Here it is a binding of this test's own
// instead, so that the loader that is running for real never hears of any of it.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injector } from '../src/lib/injector.js';
import { ModManager } from '../src/lib/manager.js';
import { discoverAll, discoverCore } from '../src/lib/mods.js';
import { json, openWindows, sleep, until } from './app-helpers.js';
import { github, plugin, release } from './registry-helpers.js';

const BINDING = '__zzPluginsHost';

let app;
let tmp;
let modsDir;
let injector;
let manager;
let tabBefore;

const panel = expression => app.inWindow('panel', expression);

async function centreOf(selector, rowTitle = null) {
  const found = await panel(`(() => {
    const scope = ${json(rowTitle)}
      ? [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-title')?.textContent.includes(${json(rowTitle)}))
      : document;
    const node = scope?.querySelector(${json(selector)});
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
  })()`);
  return found ? JSON.parse(found) : null;
}

async function clickAt(x, y) {
  const session = app.session('panel');
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await sleep(150);
}

async function click(selector, rowTitle) {
  const at = await centreOf(selector, rowTitle);
  assert.ok(at && at.w > 0, `${selector}${rowTitle ? ` in "${rowTitle}"` : ''} is not on screen`);
  await clickAt(at.x, at.y);
}

const popupTitles = () => panel(`[...document.querySelectorAll('#modkit-popup-body .setting-title')].map(n => n.textContent.trim())`);
const popupOpen = () => panel(`!!document.getElementById('modkit-popup')`);
const overlayText = () => panel(`document.querySelector('#modkit-overlay .role-switch-emote-overlay__message')?.textContent ?? null`);
const overlayOpen = () => panel(`!!document.getElementById('modkit-overlay')`);
const toastText = () => panel(`document.querySelector('#modkit-toast .toast-text')?.textContent ?? null`);
const press = async key => {
  const session = app.session('panel');
  for (const type of ['keyDown', 'keyUp']) await session.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 13 });
  await sleep(200);
};
const rowTitled = text => panel(`!![...document.querySelectorAll('#modkit-popup-body .setting-title')].find(n => n.textContent.includes(${json(text)}))`);

before(async () => {
  app = await openWindows();
  const strip = await panel(`document.querySelectorAll('.tab-btn').length`);
  assert.ok(strip > 0, 'the panel has not rendered its tab strip: open the settings panel once, then run this');
  tabBefore = await panel(`[...document.querySelectorAll('.tab-btn')].findIndex(b => b.classList.contains('tab-btn--active'))`);

  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-plugins-'));
  modsDir = path.join(tmp, 'mods');
  await fs.mkdir(modsDir);

  // A registry with one plugin that has a Node part, so that the question has something to say.
  const folder = await plugin(tmp, 'zz-plugin', '1.0.0', { host: 'host.js', permissions: ['files'] });
  await fs.writeFile(path.join(folder, 'host.js'), 'export default () => {};');
  const raw = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ ...raw, type: 'module' }));
  const rel = await release(tmp, folder, { nodePart: true, permissions: ['files'] });

  manager = new ModManager({
    modsDir, dataDir: path.join(tmp, 'moddata'), fetch: github([rel]).fetch,
    app: { evaluate: (label, js) => app.inWindow(label, js) },
  });

  // The page's way to the loader, rerouted to this test's manager.
  const session = app.session('panel');
  await session.send('Runtime.addBinding', { name: BINDING });
  session.on(message => {
    if (message.method === 'Runtime.bindingCalled' && message.params.name === BINDING) manager.onPageMessage('panel', message.params.payload);
  });

  injector = new Injector({ port: 9222, only: ['panel'] });
  injector.setMods(await discoverCore());                         // the real mods are retired in the panel
  await injector.injectAll({ force: true });
  await panel(`(() => {
    window.__zzOriginal = { toHost: modkit.toHost, hostAlive: modkit.hostAlive };
    modkit.toHost = message => { window[${json(BINDING)}](JSON.stringify(message)); return true; };
    modkit.hostAlive = () => true;
  })()`);

  await click('#modkit-tab');
  await until('the MOD page is showing', () => panel(`getComputedStyle(document.getElementById('modkit-view')).display !== 'none'`));
});

after(async () => {
  if (app) {
    await panel(`(() => { if (window.__zzOriginal) { modkit.toHost = window.__zzOriginal.toHost; modkit.hostAlive = window.__zzOriginal.hostAlive; delete window.__zzOriginal; } })()`).catch(() => {});
    await app.session('panel').send('Runtime.removeBinding', { name: BINDING }).catch(() => {});
  }
  if (injector) {
    injector.setMods(await discoverAll());
    await injector.injectAll();
    injector.close();
  }
  if (app) {
    if (tabBefore >= 0) {
      const at = JSON.parse(await panel(`(() => { const r = document.querySelectorAll('.tab-btn')[${tabBefore}]?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null) })()`).catch(() => 'null'));
      if (at) await clickAt(at.x, at.y).catch(() => {});
    }
    app.close();
  }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

test('the title row has 日志 in the corner and 安装 beside it, both inside the row and not on top of each other', async () => {
  const geometry = JSON.parse(await panel(`(() => {
    const head = document.querySelector('#modkit-view-body .room-info');
    const [log, install] = [...head.querySelectorAll('button')];
    const h = head.getBoundingClientRect(), a = log.getBoundingClientRect(), b = install.getBoundingClientRect();
    return JSON.stringify({ labels: [log.textContent, install.textContent], classes: install.className,
      gap: Math.round(a.left - b.right), within: b.top >= h.top - 1 && b.bottom <= h.bottom + 1 && b.left >= h.left, right: Math.round(h.right - a.right) });
  })()`));
  assert.deepEqual(geometry.labels, ['日志', '安装']);
  assert.equal(geometry.classes, 'common-btn leave-room-btn', 'the app\'s own button');
  assert.equal(geometry.right, 0, '日志 is flush with the right edge, as before');
  assert.ok(geometry.gap >= 8, `the buttons do not touch (gap ${geometry.gap}px)`);
  assert.ok(geometry.within, 'inside the title row');
});

test('安装 opens the dialog with the registry\'s plugins, and the plugin has a button of its own', async () => {
  await click('#modkit-view-body .room-info .leave-room-btn:nth-of-type(2)');
  await until('the dialog is open', popupOpen);
  await until('the list is there', () => rowTitled('zz-plugin') || rowTitled('The zz-plugin'));
  const heading = await panel(`document.querySelector('#modkit-popup .room-qty').textContent`);
  assert.equal(heading, '插件');
  assert.equal(await panel(`!!document.querySelector('#modkit-popup-body .setting-btn')`), true);
});

test('pressing 安装 on a plugin asks first, over the list: what it declares, nothing on disk until yes', async () => {
  await click('.setting-btn', 'zz-plugin');
  await until('the question is shown', overlayOpen);
  const asked = await overlayText();
  for (const part of ['安装「', '1.0.0', 'Node 部分：有', '没有沙盒', '它声明要用：files', '网页脚本会在软件的窗口里运行']) {
    assert.ok(asked.includes(part), `the question says "${part}":\n${asked}`);
  }
  assert.equal(await rowTitled('zz-plugin'), true, 'the list is still there under it: the page did not change');
  assert.deepEqual(await fs.readdir(modsDir), [], 'asked, not done');
});

test('取消 leaves nothing installed and takes the prompt away, and Escape does the same before it closes the dialog', async () => {
  await click('#modkit-overlay .role-switch-emote-overlay__cancel');
  await until('the prompt is gone', async () => !(await overlayOpen()));
  assert.equal(await popupOpen(), true, 'the dialog stays');
  assert.deepEqual(await fs.readdir(modsDir), []);

  await click('.setting-btn', 'zz-plugin');
  await until('the question is shown', overlayOpen);
  await press('Escape');
  await until('the prompt is gone', async () => !(await overlayOpen()));
  assert.equal(await popupOpen(), true, 'the first Escape only said no to the question');
  assert.deepEqual(await fs.readdir(modsDir), [], 'and no is no');
});

test('安装 then yes installs it, a bubble says so and goes by itself, and the row now says it is installed', async () => {
  await click('.setting-btn', 'zz-plugin');
  await until('the question is shown', overlayOpen);
  await click('#modkit-overlay .role-switch-emote-overlay__confirm');
  await until('it is installed', async () => (await fs.readdir(modsDir)).includes('zz-plugin'), 8000);
  await until('the bubble says so', async () => /已安装 zz-plugin/.test((await toastText()) ?? ''));
  await until('the prompt is gone', async () => !(await overlayOpen()));
  assert.equal(await panel(`document.querySelector('#modkit-popup-body').textContent.includes('已装 1.0.0')`), true, 'the row says it is installed');
  await until('the bubble has gone by itself', async () => (await toastText()) === null, 6000);
});

test('卸载 asks (with the box for its data), and removes it; the bubble says so', async () => {
  await click('.setting-btn', 'zz-plugin');                                    // the row now has 卸载
  await until('asked', overlayOpen);
  assert.match(await overlayText(), /卸载「/);
  assert.equal(await panel(`!!document.querySelector('#modkit-overlay .role-switch-emote-overlay__checkbox input')`), true, 'the box for the plugin\'s data');
  await click('#modkit-overlay .role-switch-emote-overlay__confirm');
  await until('it is gone', async () => !(await fs.readdir(modsDir)).includes('zz-plugin'), 8000);
  await until('the bubble says so', async () => /已卸载 zz-plugin/.test((await toastText()) ?? ''));
});

test('closing the dialog while it is asking is a no', async () => {
  await until('the bubble has gone', async () => (await toastText()) === null, 6000);
  await click('.setting-btn', 'zz-plugin');
  await until('the question is shown', overlayOpen);
  await press('Escape');                                                       // the prompt
  await press('Escape');                                                       // the dialog
  await until('closed', async () => !(await popupOpen()));
  await sleep(500);
  assert.deepEqual(await fs.readdir(modsDir), [], 'nothing was installed by closing');
});
