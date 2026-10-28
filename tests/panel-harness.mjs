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

  async function ensureOpen() {
    for (let i = 0; i < 3; i++) {
      if (await mainAnswers()) return true;
      await main.evaluate('document.querySelector(".settings-btn")?.click()');
      await sleep(1200);
    }
    return mainAnswers();
  }

  const active = () => q('[...document.querySelectorAll(".tab-btn--active")].map(b=>b.querySelector(".tab-btn__label")?.textContent).join(",")||"(none)"');

  async function realClick(name) {
    const pos = JSON.parse(await q(`(() => { const b=[...document.querySelectorAll(".tab-btn")].find(x=>x.querySelector(".tab-btn__label")?.textContent===${JSON.stringify(name)}); const r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}); })()`));
    for (const type of ['mousePressed', 'mouseReleased']) await panel.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await sleep(500);
  }

  const close = () => { panel.close(); main.close(); };
  return { panel, main, q, ensureOpen, active, realClick, close };
}
