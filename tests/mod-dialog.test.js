// The MOD page as a person uses it: a list with a 设置 button and a switch per mod, and a
// dialog for the settings. Real mouse and keyboard events, in the running app.
//
//   node --test tests/mod-dialog.test.js        (needs the app, started with `lab`)
//
// What it needs of the panel: the tab strip must be rendered (the panel window has been
// opened at least once). It does not need the main window to consider the panel open, since
// it never asks the app for anything; it only drives our own page.
//
// This test clicks around a panel that also lists the user's real mods, one of which acts on
// their account. So for its duration the real mods are taken out (only the framework and the
// throwaway ones stay), and put back afterwards, which starts them fresh with every
// persist:false switch off. It also refuses to run while such a switch is on.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injector } from '../src/lib/injector.js';
import { discoverAll, discoverCore, discoverMods } from '../src/lib/mods.js';
import { json, openWindows, sleep, until, write } from './app-helpers.js';

const ID = 'zz-dialog-test';
const NAME = 'Dialog test';

let app;
let tmpDir;
let injector;
let tabBefore;     // which tab the panel had selected, to hand it back

const panel = expression => app.inWindow('panel', expression);

// Page coordinates of the centre of the first element matching `selector` (scoped to the
// row titled `rowTitle` when given).
async function centreOf(selector, rowTitle = null) {
  const found = await panel(`(() => {
    const scope = ${json(rowTitle)}
      ? [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-title')?.textContent === ${json(rowTitle)})
      : document;
    const node = scope?.querySelector(${json(selector)});
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
  })()`);
  return found ? JSON.parse(found) : null;
}

async function click(selector, rowTitle) {
  const at = await centreOf(selector, rowTitle);
  assert.ok(at && at.w > 0, `${selector}${rowTitle ? ` in "${rowTitle}"` : ''} is not on screen`);
  await clickAt(at.x, at.y);
}

async function clickAt(x, y) {
  const session = app.session('panel');
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await sleep(150);
}

const titles = () => panel(`[...document.querySelectorAll('#modkit-popup-body .setting-title')].map(n => n.textContent)`);
const popupOpen = () => panel(`!!document.getElementById('modkit-popup')`);
const config = (key) => app.inWindow('main', `modkit.getConfig(${json(ID)}, ${json(key)})`);

before(async () => {
  app = await openWindows();

  const strip = await panel(`document.querySelectorAll('.tab-btn').length`);
  assert.ok(strip > 0, 'the panel has not rendered its tab strip: open the settings panel once, then run this');
  tabBefore = await panel(`[...document.querySelectorAll('.tab-btn')].findIndex(b => b.classList.contains('tab-btn--active'))`);

  const live = await panel(`JSON.stringify([...modkit.mods].flatMap(([id, m]) => m.settings
    .filter(s => s.type === 'toggle' && s.persist === false && modkit.getConfig(id, s.key)).map(s => id + '.' + s.key)))`);
  assert.deepEqual(JSON.parse(live), [], 'a mod has a persist:false switch on: not clicking around the panel now');

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit-dialog-'));
  await write(path.join(tmpDir, ID, 'package.json'), json({
    displayName: NAME, description: 'what it does',
    modkit: {
      windows: { main: 'main.js' },
      settings: [
        { key: 'flag', type: 'toggle', title: 'Flag', default: false },
        { key: 'n', type: 'number', title: 'Number', default: 5, min: 1, max: 9 },
        { key: 'shown', type: 'value', title: 'Shown', default: '-' },
      ],
    },
  }));
  await write(path.join(tmpDir, ID, 'main.js'), `mod.live('shown', 'first'); window.__zzPublish = v => mod.live('shown', v);`);
  await write(path.join(tmpDir, 'zz-plain.js'), 'return 1;');   // a single file: no settings, so no button

  injector = new Injector({ port: 9222 });
  injector.setMods([...await discoverCore(), ...await discoverMods(tmpDir)]);   // the real mods are retired
  await injector.injectAll({ force: true });

  await click('#modkit-tab');
  await until('the MOD page is showing', () => panel(`getComputedStyle(document.getElementById('modkit-view')).display !== 'none'`));
});

after(async () => {
  if (injector) {
    injector.setMods(await discoverAll());
    await injector.injectAll();
    injector.close();
  }
  if (app) {
    await app.inWindow('main', `(() => {
      for (const key of Object.keys(localStorage)) if (/^modkit:[a-z]+:zz-/.test(key)) localStorage.removeItem(key);
      delete window.__zzPublish;
    })()`).catch(() => {});
    // Hand the tab back: the click on MOD took the highlight from it.
    if (tabBefore >= 0) {
      const at = JSON.parse(await panel(`(() => { const r = document.querySelectorAll('.tab-btn')[${tabBefore}]?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null) })()`).catch(() => 'null'));
      if (at) await clickAt(at.x, at.y).catch(() => {});
    }
    app.close();
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

test('the list has one row per mod; only a mod with settings has a 设置 button, to the left of its switch', async () => {
  const rows = JSON.parse(await panel(`JSON.stringify([...document.querySelectorAll('#modkit-view-body .setting-item')].map(r => ({
    title: r.querySelector('.setting-title').textContent,
    button: r.querySelector('.setting-btn')?.textContent ?? null,
    buttonX: r.querySelector('.setting-btn')?.getBoundingClientRect().left ?? null,
    switchX: r.querySelector('.setting-switch')?.getBoundingClientRect().left ?? null,
  })))`));
  const mine = rows.find(r => r.title === NAME);
  assert.equal(mine.button, '设置');
  assert.ok(mine.buttonX < mine.switchX, 'the button sits left of the switch');
  assert.equal(rows.find(r => r.title === 'zz-plain').button, null, 'no settings, no button');
  assert.equal(rows.length, (await panel(`modkit.mods.size`)), 'one row per mod, no settings rows in the list');
});

test('the 设置 button opens the app\'s own dialog, with the mod\'s settings in manifest order', async () => {
  await click('.setting-btn', NAME);
  await until('the dialog is open', popupOpen);

  const shape = JSON.parse(await panel(`JSON.stringify({
    insidePanel: !!document.querySelector('.module-panel > #modkit-popup.synthesis-atlas-pop'),
    card: !!document.querySelector('#modkit-popup > .synthesis-atlas-pop-content'),
    close: !!document.querySelector('#modkit-popup .popup-close'),
    heading: document.querySelector('#modkit-popup .room-qty')?.textContent,
  })`));
  assert.deepEqual(shape, { insidePanel: true, card: true, close: true, heading: NAME });
  assert.deepEqual(await titles(), ['Flag', 'Number', 'Shown']);
  assert.equal(await panel(`document.querySelector('#modkit-popup-body .setting-value').textContent`), 'first');
});

test('a number can be typed into the dialog (the panel does not swallow the click), and is stored clamped', async () => {
  await click('.setting-input', 'Number');
  assert.equal(await panel(`document.activeElement?.classList.contains('setting-input')`), true, 'the box took focus');

  await panel(`document.activeElement.select()`);
  await app.session('panel').send('Input.insertText', { text: '42' });
  await app.session('panel').send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await app.session('panel').send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await panel(`document.activeElement.blur()`);

  await until('main sees 9 (42 clamped to max)', async () => (await config('n')) === 9);
  assert.equal(await panel(`document.querySelector('#modkit-popup-body .setting-input').value`), '9', 'the box shows what was stored');
});

test('a switch in the dialog changes the setting', async () => {
  assert.equal(await config('flag'), false);
  await click('.setting-slider', 'Flag');
  await until('main sees flag on', async () => (await config('flag')) === true);
  assert.equal(await panel(`document.querySelector('#modkit-popup-body .setting-switch input').checked`), true);
});

// The app moves a switch's knob with a CSS transition (.3s). That only plays on an element that
// stays in the page while its state changes, so a redraw that replaces the row makes the knob
// jump. Flip a switch with a real click and sample the knob on the way: a knob that is
// animating is neither where it started nor where it ends up.
const rowOf = (scope, title) => `[...document.querySelectorAll(${json(scope + ' .setting-item')})].find(r => r.querySelector('.setting-title').textContent === ${json(title)})`;
const knobX = (scope, title) => panel(`new DOMMatrixReadOnly(getComputedStyle(${rowOf(scope, title)}.querySelector('.setting-slider'), '::before').transform).m41`);

async function assertSwitchAnimates(scope, title) {
  await panel(`window.__sw = ${rowOf(scope, title)}.querySelector('.setting-switch input')`);
  const from = await knobX(scope, title);

  await click('.setting-slider', title);            // returns about 150 ms after the press
  const during = await knobX(scope, title);
  await sleep(500);
  const to = await knobX(scope, title);

  assert.notEqual(to, from, 'the switch changed');
  assert.ok(during !== from && during !== to, `caught the knob mid-way (${from} -> ${during} -> ${to}): it animated`);
  assert.equal(await panel(`window.__sw === ${rowOf(scope, title)}.querySelector('.setting-switch input')`), true, 'the same element: nothing was rebuilt');

  await click('.setting-slider', title);            // put it back
  await sleep(500);
  await panel(`delete window.__sw`);
}

test('a switch in the dialog animates when it is flipped', () => assertSwitchAnimates('#modkit-popup-body', 'Flag'));

test('a live figure updates in place, without rebuilding the dialog', async () => {
  await panel(`window.__keep = document.querySelector('#modkit-popup-body .setting-value')`);
  await app.inWindow('main', `window.__zzPublish('second')`);
  await until('the figure changed', async () => (await panel(`document.querySelector('#modkit-popup-body .setting-value').textContent`)) === 'second');
  assert.equal(await panel(`window.__keep === document.querySelector('#modkit-popup-body .setting-value')`), true, 'same node: nothing was redrawn');
  await panel(`delete window.__keep`);
});

test('the dialog closes with Escape, with the close button, and with a click on the dimmed part, not on the card', async () => {
  const session = app.session('panel');
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until('closed by Escape', async () => !(await popupOpen()));

  await click('.setting-btn', NAME);
  await until('reopened', popupOpen);
  await click('#modkit-popup .popup-close');
  await until('closed by the close button', async () => !(await popupOpen()));

  await click('.setting-btn', NAME);
  await until('reopened again', popupOpen);
  await click('#modkit-popup-body .room-qty');                 // on the card: stays open
  assert.equal(await popupOpen(), true, 'a click on the card does not close it');
  const card = JSON.parse(await panel(`(() => { const r = document.querySelector('#modkit-popup .synthesis-atlas-pop-content').getBoundingClientRect(); return JSON.stringify({ right: r.right, mid: r.top + r.height / 2 }) })()`));
  await clickAt(card.right + 20, card.mid);                    // on the dimmed part
  await until('closed by the dimmed part', async () => !(await popupOpen()));
});

test('the master switch in the list animates when it is flipped', () => assertSwitchAnimates('#modkit-view-body', NAME));

test('the master switch in the list turns the mod off and on, and the 设置 button stays', async () => {
  await click('.setting-slider', NAME);
  await until('off', async () => (await app.inWindow('main', `modkit.isEnabled(${json(ID)})`)) === false);
  assert.equal(await centreOf('.setting-btn', NAME) !== null, true);

  await click('.setting-slider', NAME);
  await until('on again', async () => (await app.inWindow('main', `modkit.isEnabled(${json(ID)})`)) === true);
});

test('leaving the MOD page closes an open dialog', async () => {
  await click('.setting-btn', NAME);
  await until('open', popupOpen);
  await panel(`document.querySelector('.tab-btn:not(#modkit-tab)').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await until('closed', async () => !(await popupOpen()));
  await click('#modkit-tab');                                   // back to MOD for the cleanup
});
