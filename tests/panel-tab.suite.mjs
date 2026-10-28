// Behavioural tests for the MOD tab in the settings panel, driven with real mouse events.
//
//   node tests/panel-tab.suite.mjs
//
// Needs the app running with the framework injected:  node src/cli.js lab, then run (or
// watch). It folds and unfolds the panel and clicks through the tabs, and leaves the
// panel as it found it. Each check is pass/fail; the exit code is the number failed (0/1).
//
// Cases here are ones that were once broken: returning to the tab that was already
// selected, folding while the MOD page is open, and building the tab while folded.

import { connect, sleep } from './panel-harness.mjs';
const t = await connect();
let failed = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`); };

console.log('main window considers the panel open:', await t.ensureOpen());

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

console.log('\n-- fold / unfold');
check('label shown when expanded', await modLabel(), 'shown');
await t.realClick('联机');
await t.realClick('MOD');
await toggleFold();
check('folded', await folded(), true);
check('highlight handed back on fold (icon-only tab bar)', (await activeNames()).join(','), '(icon)');
check('label hidden when folded', await modLabel(), 'hidden');
check('MOD page closed by folding', await t.q(`document.getElementById('modkit-view').style.display`), 'none');
await toggleFold();
check('unfolded', await folded(), false);
check('label shown again', await modLabel(), 'shown');
check('previous tab still highlighted after unfold', (await activeNames()).join(','), '联机');
await t.realClick('背包'); check('highlight works after unfold', (await activeNames()).join(','), '背包');

console.log('\n-- tab rebuilt while folded');
await toggleFold();
await t.q(`document.getElementById('modkit-tab').remove()`);
await sleep(900);
check('tab planted again while folded', await t.q(`document.querySelectorAll('#modkit-tab').length`), 1);
await toggleFold();
check('label exists after unfolding', await modLabel(), 'shown');
check('still exactly one tab', await t.q(`document.querySelectorAll('#modkit-tab').length`), 1);
await t.realClick('联机'); check('highlight works afterwards', (await activeNames()).join(','), '联机');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
t.close(); process.exit(failed ? 1 : 0);
