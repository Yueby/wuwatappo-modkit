// Shared helpers for panel tests. The precondition that matters: the MAIN window must
// consider the panel open, otherwise tab clicks produce no snapshot and nothing
// re-highlights. Check that by asking it, not by looking at the panel's DOM.
import { CDPSession } from '../src/lib/cdp.js';
import { targetList, windowLabel } from '../src/lib/targets.js';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function connect() {
  const wins = await targetList();
  const panel = await CDPSession.connect(wins.find(x => windowLabel(x) === 'panel'));
  const main = await CDPSession.connect(wins.find(x => windowLabel(x) === 'main'));
  await panel.enable(['Page', 'Runtime']); await main.enable(['Runtime']);
  const q = e => panel.evaluate(e);

  const mainAnswers = async () => {
    await q(`window.__s = 0; if (!window.__sl) { window.__sl = true; const T = window.__TAURI_INTERNALS__;
      T.invoke('plugin:event|listen', { event: 'cat-panel-state', target: { kind: 'Any' }, handler: T.transformCallback(() => { window.__s++; }) }); }`);
    await q(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'cat-panel-action', payload: { type: 'ready' } })`);
    await sleep(600);
    return (await q('window.__s')) > 0;
  };

  // The panel is rendered from a snapshot the main window sends. Right after we (re)open
  // it, or right after a hot reload, the tab strip can exist before any tab is marked
  // selected; clicking in that window gives answers that look like bugs and are not.
  async function settle() {
    for (let waited = 0; waited < 4000; waited += 200) {
      if (await q('document.querySelectorAll(".tab-btn--active").length > 0')) break;
      await sleep(200);
    }
    await sleep(400);
  }

  // Make the main window consider the panel open. The pet's settings button TOGGLES, so
  // a click is only safe when the panel is known to be closed; deciding that from one
  // quick probe can be wrong (a slow answer reads as "closed"), and then the click would
  // close a panel that was open. So: probe generously, click at most once per round, and
  // confirm with a fresh probe before believing the result.
  async function ensureOpen() {
    for (let round = 0; round < 3; round++) {
      if (await mainAnswers() || await mainAnswers()) { await settle(); return true; }   // two probes before concluding "closed"
      await main.evaluate('document.querySelector(".settings-btn")?.click()');
      await sleep(1500);
    }
    return false;
  }

  const active = () => q('[...document.querySelectorAll(".tab-btn--active")].map(b=>b.querySelector(".tab-btn__label")?.textContent).join(",")||"(none)"');

  // Press a tab by its label. Folded, stock tabs have no label, so this only works
  // expanded; say so instead of failing inside the page with "undefined".
  async function realClick(name) {
    const found = await q(`(() => { const b=[...document.querySelectorAll(".tab-btn")].find(x=>x.querySelector(".tab-btn__label")?.textContent===${JSON.stringify(name)}); if (!b) return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}); })()`);
    if (!found) throw new Error(`no tab labelled "${name}" (is the panel folded? stock labels are absent then)`);
    const pos = JSON.parse(found);
    for (const type of ['mousePressed', 'mouseReleased']) await panel.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await sleep(500);
  }

  const close = () => { panel.close(); main.close(); };
  return { panel, main, q, ensureOpen, active, realClick, close };
}
