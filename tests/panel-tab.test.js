// Behavioural tests for the MOD tab in the settings panel, driven with real mouse events.
//
//   node tests/panel-tab.test.js
//
// Needs the app running with the framework injected:  node src/cli.js lab, then run (or
// watch). It folds and unfolds the panel and clicks through the tabs, and leaves the
// panel as it found it. Each check is pass/fail; the exit code is the number failed (0/1).
//
// Cases here are ones that were once broken: returning to the tab that was already
// selected, folding while the MOD page is open, and building the tab while folded.

import { connect, sleep } from './panel-harness.js';
const t = await connect();
let failed = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`); };

// Everything below assumes the main window considers the panel open (see the harness).
// If that cannot be established, stop: running on would only produce failures that look
// like bugs in the code under test.
if (!(await t.ensureOpen())) {
  console.error('ABORT: could not get the main window to treat the panel as open; nothing was tested.');
  t.close(); process.exit(2);
}
console.log('main window considers the panel open: true');

const toggleFold = async () => {
  const pos = JSON.parse(await t.q(`(() => { const b=[...document.querySelectorAll('.tab-btn')].filter(x=>!x.dataset.modkitOwn).pop(); const r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}); })()`));
  for (const type of ['mousePressed','mouseReleased']) await t.panel.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(800);
};
const folded = () => t.q(`!!document.querySelector('.tab-bar--collapsed')`);
const activeNames = () => t.q(`[...document.querySelectorAll('.tab-btn--active')].map(b => b.id === 'modkit-tab' ? 'MOD' : b.querySelector('.tab-btn__label')?.textContent ?? '(icon)')`);
const modLabel = () => t.q(`(() => { const l = document.querySelector('#modkit-tab .tab-btn__label'); return !l ? 'MISSING' : getComputedStyle(l).display === 'none' ? 'hidden' : 'shown'; })()`);

check('exactly one framework instance owns the tab', await t.q(`document.querySelectorAll('#modkit-tab').length`), 1);
if (await folded()) await toggleFold();

console.log('\n-- highlight round trips');
for (const [name, want] of [['设置','设置'],['MOD','MOD'],['设置','设置'],['背包','背包'],['MOD','MOD'],['背包','背包'],['MOD','MOD'],['联机','联机'],['MOD','MOD'],['MOD','MOD'],['联机','联机']]) {
  await t.realClick(name); check(`click ${name}`, (await activeNames()).join(','), want);
}

console.log('\n-- fold / unfold: neither the page nor the selection may change');
// What is on screen: our page, or the names of the stock blocks that are visible.
const page = () => t.q(`(() => {
  const v = document.getElementById('modkit-view');
  if (v && v.style.display !== 'none') return 'MOD';
  return [...document.querySelectorAll('.module-block')]
    .filter(b => b.id !== 'modkit-view' && getComputedStyle(b).display !== 'none')
    .map(b => b.className.replace('module-block', '').trim()).join(',');
})()`);
// Folded, stock labels are gone, so a selected stock tab shows up as '(icon)'.
const selection = async () => (await activeNames()).map(n => (n === '(icon)' ? '<native>' : n)).join(',');

// A native page first: the baseline the MOD page has to match.
await t.realClick('设置');
const nativePage = await page();
await toggleFold();
check('native: folded', await folded(), true);
check('native: same page after folding', await page(), nativePage);
check('native: a tab is still selected', await selection(), '<native>');
await toggleFold();
check('native: same page after unfolding', await page(), nativePage);
check('native: 设置 still selected', (await activeNames()).join(','), '设置');

// The same sequence with the MOD page open.
check('label shown when expanded', await modLabel(), 'shown');
await t.realClick('MOD');
check('MOD page is showing', await page(), 'MOD');
await toggleFold();
check('MOD: folded', await folded(), true);
check('MOD: page is still the MOD page', await page(), 'MOD');
check('MOD: MOD is still the selected tab', await selection(), 'MOD');
check('MOD: label hidden when folded', await modLabel(), 'hidden');
await toggleFold();
check('MOD: unfolded', await folded(), false);
check('MOD: page is still the MOD page', await page(), 'MOD');
check('MOD: MOD is still the selected tab', await selection(), 'MOD');
check('MOD: label shown again', await modLabel(), 'shown');
await t.realClick('背包');
check('leaving MOD after a fold still works', (await activeNames()).join(','), '背包');
check('a native page is showing again', (await page()) !== 'MOD', true);

console.log('\n-- tab rebuilt while folded');
await toggleFold();
await t.q(`document.getElementById('modkit-tab').remove()`);
await sleep(900);
check('tab planted again while folded', await t.q(`document.querySelectorAll('#modkit-tab').length`), 1);
await toggleFold();
check('label exists after unfolding', await modLabel(), 'shown');
check('still exactly one tab', await t.q(`document.querySelectorAll('#modkit-tab').length`), 1);
await t.realClick('联机');
check('highlight works afterwards', (await activeNames()).join(','), '联机');

console.log('\n-- tab rebuilt while the MOD page is open');
await t.realClick('MOD');
await t.q(`document.getElementById('modkit-tab').remove()`);
await sleep(900);
check('rebuilt tab is selected, matching the page', (await activeNames()).join(','), 'MOD');
check('page is still the MOD page', await page(), 'MOD');
await t.realClick('联机');
check('can still leave', (await activeNames()).join(','), '联机');

console.log('\n-- closed with its own button while the MOD page is open, and opened again');
// The app draws its pages again when the panel is closed this way: they are new, and were showing together with ours.
const blocksShowing = () => t.q(`[...document.querySelectorAll('.module-block')].filter(b => getComputedStyle(b).display !== 'none').length`);
await t.realClick('MOD');
const star = JSON.parse(await t.q(`(() => { const r = document.querySelector('.panel-close').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
for (const type of ['mousePressed', 'mouseReleased']) await t.panel.send('Input.dispatchMouseEvent', { type, x: star.x, y: star.y, button: 'left', clickCount: 1 });
await sleep(1500);
check('the panel is closed', await t.q(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible', { label: 'panel' })`).catch(() => null) ?? false, false);
await t.ensureOpen();                                                       // opened again from the pet's button
await sleep(1200);
check('opened again: the MOD page is showing', await page(), 'MOD');
check('opened again: MOD is the selected tab', (await activeNames()).join(','), 'MOD');
check('opened again: nothing else is showing with it', await blocksShowing(), 1);
await t.realClick('联机');
check('and it can still be left', (await activeNames()).join(','), '联机');
check('and the app\'s page shows then', (await page()) !== 'MOD', true);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
t.close(); process.exit(failed ? 1 : 0);
