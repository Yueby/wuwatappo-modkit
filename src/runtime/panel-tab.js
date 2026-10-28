// Framework: the "MOD" entry in the settings panel, and the page behind it.
//
// This is NOT a mod. It is injected by the loader into every window before any mod
// runs (see discoverCore in src/lib/mods.js), so mods can rely on `window.modkit`
// existing and on the manager page being there. It lives outside mods/ on purpose:
// the manager lists the mods, so it must not be one of them, and deleting a mod must
// never be able to take the manager away.
//
// Two layers:
//
//   1. a tiny registry, window.modkit, present in every window. Mods add UI through
//      `mod.entry(...)`, which lands here and is removed again when the mod is
//      disposed (hot reload) — mods never touch the globals directly.
//   2. in the panel window only, a tab in the left navigation and the page it opens.
//
// The tab is a clone of a real tab button with only the icon and label replaced, so
// it inherits every style. The panel keeps its active tab in component state (not the
// URL) and the production build exposes no Vue instance, so the page is shown by
// hiding the app's module blocks; any click on a stock tab puts them back.

// --- 1. registry (every window) --------------------------------------------

const kit = (window.modkit ??= { entries: [], onChange: null });

kit.addEntry = entry => {
  kit.entries.push(entry);
  kit.changed();
};
kit.removeEntry = entry => {
  const i = kit.entries.indexOf(entry);
  if (i >= 0) kit.entries.splice(i, 1);
  kit.changed();
};
// Called when entries change and when a mod finishes installing (its status in
// window.__wuwaMods only becomes final after it returns).
kit.changed = () => { try { kit.onChange?.(); } catch (err) { console.warn('[modkit]', err); } };

if (!location.hash.includes('/panel')) return;

// --- 2. the panel tab and page ---------------------------------------------

const TAB_SELECTOR = '.tab-btn';
const BLOCK_SELECTOR = '.module-block';
const TAB_ID = 'modkit-tab';
const VIEW_ID = 'modkit-view';
const BODY_ID = 'modkit-view-body';
const CORE_PREFIX = '@core/';

// Two images, like the app's own icons: a light one for the unselected tab (it has to
// read on the dark sidebar) and a dark one for the selected tab (it sits on the bright
// pill). Filled in by the loader from src/lib/icon.js, sized and coloured from
// measurements of the stock icons.
const ICON_INACTIVE = '__MOD_ICON_INACTIVE__';
const ICON_ACTIVE = '__MOD_ICON_ACTIVE__';

// The app swaps the icon image for the selected tab with CSS
// (`.tab-btn--active:not(:last-of-type) .tab-btn__icon--bag { background-image: ... }`).
// Ours gets its own class and the same two-state treatment. Only the image is set here:
// size, position and the selected-state highlight (border, pill, label colour) all
// come from the stock rules, which apply to us because our button sits before 收起
// rather than last.
const ICON_CLASS = 'tab-btn__icon--mod';
const STYLE_ID = 'modkit-style';

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tab-btn__icon.${ICON_CLASS} {
      background-image: url("${ICON_INACTIVE}");
    }
    .tab-btn--active .tab-btn__icon.${ICON_CLASS} {
      background-image: url("${ICON_ACTIVE}");
    }
    /* Folded, the app drops every stock label (v-if) and shows icons only. Our button
       is not rendered by Vue, so its label stays in the DOM: hide it the same way. */
    .tab-bar--collapsed #${TAB_ID} .tab-btn__label {
      display: none;
    }
    #${VIEW_ID} .mk-section {
      font-size: 13px; color: #8e5e43; margin: 20px 0 8px;
    }
    #${VIEW_ID} .mk-card {
      background: rgba(255, 251, 244, .75); border: 1px solid rgba(180, 150, 120, .25);
      border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
    }
    #${VIEW_ID} .mk-title { font-size: 14px; color: #5a4030; }
    #${VIEW_ID} .mk-desc  { font-size: 12px; color: #a08a78; margin-top: 4px; }
    #${VIEW_ID} .mk-row   { display: flex; align-items: baseline; gap: 10px; padding: 6px 0; }
    #${VIEW_ID} .mk-row + .mk-row { border-top: 1px solid rgba(180, 150, 120, .18); }
    #${VIEW_ID} .mk-name  { font-size: 14px; color: #5a4030; flex: 0 0 auto; }
    #${VIEW_ID} .mk-state { font-size: 12px; margin-left: auto; }
    #${VIEW_ID} .mk-ok    { color: #5b8a4a; }
    #${VIEW_ID} .mk-bad   { color: #b4533c; }
    #${VIEW_ID} .mk-wait  { color: #a08a78; }
    #${VIEW_ID} .mk-err   { font-size: 12px; color: #b4533c; padding: 0 0 6px 0; word-break: break-all; }
    #${VIEW_ID} .mk-empty { color: #a08a78; font-size: 13px; }`;
  document.head.appendChild(style);
}

// --- DOM lookups (always fresh: Vue may replace nodes) ----------------------

const tabButtons = () => [...document.querySelectorAll(TAB_SELECTOR)];

// The fold/unfold toggle is always the last stock button. It is found by position
// because its label is only there while the panel is expanded (folded, the app removes
// every label), so matching on text would find nothing exactly when it matters.
function collapseButton() {
  const stock = tabButtons().filter(b => !b.dataset.modkitOwn);
  return stock[stock.length - 1] ?? null;
}

// The flex column Vue renders module blocks into.
function moduleHost() {
  return document.querySelector('.module-content')
    ?? document.querySelector(BLOCK_SELECTOR)?.parentElement
    ?? null;
}

// --- the page ---------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildView() {
  const view = el('div');
  view.id = VIEW_ID;
  // .module-content stacks a .module-content__bg layer over its children, so the
  // page has to sit above it rather than merely being appended.
  view.style.cssText = `
    display: none; position: relative; z-index: 1;
    padding: 24px; overflow-y: auto; height: 100%; box-sizing: border-box;`;

  const heading = el('h2', null, 'MOD');
  heading.style.cssText = 'margin:0 0 4px;font-size:20px;color:#5a4030';
  const sub = el('p', null, '由 wuwa-modkit 注入，不属于原版界面。');
  sub.style.cssText = 'margin:0 0 4px;font-size:13px;color:#a08a78';

  const body = el('div');
  body.id = BODY_ID;
  view.append(heading, sub, body);
  return view;
}

// User mods only: framework scripts are not something the user installed.
function loadedMods() {
  return Object.entries(window.__wuwaMods ?? {})
    .filter(([name]) => !name.startsWith(CORE_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b));
}

function renderMods(body) {
  const mods = loadedMods();
  body.appendChild(el('div', 'mk-section', `已加载的 mod（${mods.length}）`));

  if (!mods.length) {
    body.appendChild(el('div', 'mk-empty', 'mods/ 里还没有 mod。'));
    return;
  }

  const card = el('div', 'mk-card');
  for (const [name, state] of mods) {
    const row = el('div', 'mk-row');
    row.appendChild(el('span', 'mk-name', name));

    const status = state?.status ?? 'unknown';
    const label = status === 'ok' ? '正常' : status === 'error' ? '出错' : '加载中';
    const cls = status === 'ok' ? 'mk-ok' : status === 'error' ? 'mk-bad' : 'mk-wait';
    row.appendChild(el('span', `mk-state ${cls}`, label));
    card.appendChild(row);

    if (status === 'error' && state.error) card.appendChild(el('div', 'mk-err', state.error));
  }
  body.appendChild(card);
}

function renderEntries(body) {
  if (!kit.entries.length) return;
  body.appendChild(el('div', 'mk-section', '功能'));

  for (const entry of kit.entries) {
    const card = el('div', 'mk-card');
    card.appendChild(el('div', 'mk-title', entry.title ?? '(未命名)'));
    if (entry.description) card.appendChild(el('div', 'mk-desc', entry.description));

    if (typeof entry.render === 'function') {
      try {
        const extra = entry.render();
        if (extra) {
          extra.style.marginTop = '10px';
          card.appendChild(extra);
        }
      } catch (err) {
        card.appendChild(el('div', 'mk-err', `渲染失败：${err.message ?? err}`));
        console.warn('[modkit] entry render failed', entry.title, err);
      }
    }
    body.appendChild(card);
  }
}

function renderView() {
  const view = document.getElementById(VIEW_ID);
  const body = document.getElementById(BODY_ID);
  if (!view || !body || view.style.display === 'none') return; // nothing to update while hidden

  body.textContent = '';
  renderMods(body);
  renderEntries(body);
}

kit.onChange = renderView;

// --- switching between our page and the app's pages -------------------------

// Whether our page is showing. See leaveModView for what leaving has to hand back.
let modOpen = false;

const stockTabs = () => tabButtons().filter(b => !b.dataset.modkitOwn);

function showModView() {
  const host = moduleHost();
  if (!host) return;

  modOpen = true;

  for (const block of host.querySelectorAll(BLOCK_SELECTOR)) {
    if (block.id === VIEW_ID) continue;
    block.dataset.modkitHidden = '1';
    block.style.display = 'none';
  }

  let view = host.querySelector('#' + VIEW_ID);
  if (!view) {
    view = buildView();
    host.appendChild(view);
  }
  view.style.display = 'block';
  renderView();
}

function hideModView() {
  document.getElementById(VIEW_ID)?.style.setProperty('display', 'none');

  const host = moduleHost();
  if (!host) return;
  for (const block of host.querySelectorAll(BLOCK_SELECTOR)) {
    if (block.id === VIEW_ID || block.dataset.modkitHidden !== '1') continue;
    block.style.removeProperty('display');
    delete block.dataset.modkitHidden;
  }
}

// --- the tab ----------------------------------------------------------------

function buildTab() {
  // Built from the stock structure, not cloned from a stock button. A stock button is a
  // different shape depending on the panel's state when it is copied — folded, the app
  // replaces the label with an empty comment node — so a clone taken while folded stays
  // label-less after the panel is unfolded. The structure is just two spans and four
  // class names, none of it tied to Vue internals (the stock markup carries no
  // data-v-* attributes), so there is nothing to drift.
  if (!tabButtons().length) return null;   // the strip has not rendered yet

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = TAB_ID;
  btn.className = 'tab-btn';
  btn.dataset.modkitOwn = '1';

  const icon = document.createElement('span');
  icon.className = `tab-btn__icon ${ICON_CLASS}`;

  // Always present; folded, CSS hides it (see installStyle) the way the app drops its
  // own labels.
  const label = document.createElement('span');
  label.className = 'tab-btn__label';
  label.textContent = 'MOD';

  btn.append(icon, label);

  btn.addEventListener('click', () => {
    // The app will not mark a button it does not know about, so the one-active-tab
    // invariant is ours to keep: take the highlight from the stock tab, give it to us.
    for (const other of tabButtons()) other.classList.toggle('tab-btn--active', other === btn);
    showModView();
  });

  return btn;
}

// Leave our page and hand the highlight to the stock tab the user pressed (`clicked`),
// or to nobody when something else, the app itself, switched tabs.
//
// Entering our page removes .tab-btn--active from the stock tab that carried it. The
// app puts it back only when the main window reports a change of selected tab. Going
// back to the tab that was already selected is not a change, so nothing is reported and
// that tab would stay unhighlighted for good — the symptom was: select 设置, open MOD,
// click 设置, and no tab lit up. So set it here. When the user picked a different tab
// the app's report still arrives and repaints both tabs, to the same result.
function leaveModView(clicked) {
  if (!modOpen) return;
  modOpen = false;

  document.getElementById(TAB_ID)?.classList.remove('tab-btn--active');
  hideModView();
  clicked?.classList.add('tab-btn--active');
}

// Clicking any stock tab returns to the app's own content.
//
// "Already bound" is tracked here, per instance, not with a marker on the element: a
// marker survives a hot reload of this script, so the new instance would see it, skip
// the button, and the old instance's handler (which belongs to disposed state) would be
// the only one left on it.
const boundTabs = new Map();   // button -> handler

function bindStockTabs() {
  for (const btn of stockTabs()) {
    if (boundTabs.has(btn)) continue;
    const handler = () => {
      // The fold toggle changes the sidebar's width and nothing else: the page beside
      // it, and so the selected tab, stay exactly as they are (measured: content width
      // unchanged, same blocks shown). Leaving our page here would switch the user to
      // another page just because they narrowed the sidebar — which is not what
      // happens to a stock page when the sidebar is folded.
      if (btn === collapseButton()) return;
      leaveModView(btn);
    };
    boundTabs.set(btn, handler);
    btn.addEventListener('click', handler);
  }
}

// The app can also switch tabs without a click on the strip (e.g. "open bag" from the
// pet's menu). If a stock tab becomes selected while our page is open, our page is
// stale: close it, or two tabs would look selected and the wrong page would show.
const classWatcher = new MutationObserver(() => {
  if (modOpen && stockTabs().some(b => b.classList.contains('tab-btn--active'))) leaveModView(null);
});

let watchedBar = null;

function watchTabClasses() {
  const bar = document.querySelector('.tab-bar');
  if (!bar || bar === watchedBar) return;
  classWatcher.disconnect();
  watchedBar = bar;
  classWatcher.observe(bar, { attributes: true, attributeFilter: ['class'], subtree: true });
}

// The tab strip is a flex column and the app highlights whatever carries
// .tab-btn--active. Our button goes immediately before 收起 so that 收起 stays the last
// .tab-btn, and so our node sits next to a stable landmark rather than wedged among
// the index-keyed stock buttons (inserting there made Vue's class updates land on the
// wrong element, leaving no tab highlighted).
let planting = false;

function ensureTab() {
  if (planting) return;
  const collapse = collapseButton();
  const bar = collapse?.parentElement;
  if (!bar?.classList.contains('tab-bar')) return;

  planting = true;
  try {
    bindStockTabs();
    watchTabClasses();
    const tab = document.getElementById(TAB_ID) ?? buildTab();
    if (!tab) return;
    // A rebuilt tab starts unselected; if our page is still showing it must not lose
    // its highlight.
    if (modOpen) tab.classList.add('tab-btn--active');
    // Re-seat on every pass: Vue may have moved the strip around.
    if (tab.nextElementSibling !== collapse) bar.insertBefore(tab, collapse);
  } finally {
    planting = false;
  }
}

const observer = new MutationObserver(() => requestAnimationFrame(ensureTab));
observer.observe(document.body, { childList: true, subtree: true });

// The panel renders only while the main window considers it open, so the tab strip
// may not exist yet (or for a long time). The observer above catches it whenever it
// appears; this poll just covers the case where it is already there at injection.
let attempts = 0;
const retry = setInterval(() => {
  ensureTab();
  if (document.getElementById(TAB_ID) || ++attempts > 50) clearInterval(retry);
}, 200);

// Disposers run in reverse order, so this one runs last: by then our page is gone, and
// all that is left to undo is the app's own blocks we hid while it was open.
mod.onDispose(hideModView);
mod.onDispose(() => observer.disconnect());
mod.onDispose(() => classWatcher.disconnect());
mod.onDispose(() => { for (const [btn, handler] of boundTabs) btn.removeEventListener('click', handler); boundTabs.clear(); });
mod.onDispose(() => clearInterval(retry));
mod.onDispose(() => { kit.onChange = null; });
mod.onDispose(() => document.getElementById(TAB_ID)?.remove());
mod.onDispose(() => document.getElementById(VIEW_ID)?.remove());
mod.onDispose(() => document.getElementById(STYLE_ID)?.remove());

installStyle();
ensureTab();
