// Framework: the "MOD" entry in the settings panel, and the page behind it.
//
// Not a mod. The loader injects it before any mod runs (see discoverCore in src/lib/mods.js),
// and it lives outside mods/ on purpose: the page lists the mods, so it must not be one of
// them, and deleting a mod must never be able to take the page away.
//
// It draws what modkit-registry.js collects. That file is loaded first (file-name order) and
// defines window.modkit in every window; this one only does anything in the panel window.
//
// The tab is built from the stock tab's structure (two spans, four class names) and sits just
// before 收起. The panel keeps its active tab in component state, not in the URL, and the
// production build exposes no Vue instance to hook, so this is a pure DOM extension: our page
// is shown by hiding the app's module blocks, and a click on a stock tab puts them back.

if (!location.hash.includes('/panel')) return;

const kit = window.modkit;
if (!kit) throw new Error('window.modkit is missing: modkit-registry.js must be injected first');


const TAB_SELECTOR = '.tab-btn';
const BLOCK_SELECTOR = '.module-block';
const TAB_ID = 'modkit-tab';
const VIEW_ID = 'modkit-view';
const BODY_ID = 'modkit-view-body';

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
    /* Nothing here: the page is built entirely from the app's own classes, so fonts,
       sizes and colours all come from the app (its palette has no red or green, and its
       settings page has no section headings, so neither is invented here). */`;
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
//
// Built from the app's own settings markup, so it looks like one of its pages and not
// like something laid over it:
//
//   div.module-block.settings-module        outer shell: padding, column layout
//     div.panel-content                      the scrolling area, with the app's scrollbar
//       div.setting-item                     one row
//         div.setting-label
//           div.setting-title                18px, #8e5e43
//           div.setting-sub                  14px, #8e7b6a   (optional)
//         div.setting-content                the control: .setting-switch, .setting-btn,
//                                            .setting-input, .setting-value, ...
//
// These classes are global (no data-v scoping), so using them is enough.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildView() {
  const view = el('div', 'module-block settings-module');
  view.id = VIEW_ID;
  view.style.display = 'none';

  const scroller = el('div', 'panel-content');
  scroller.id = BODY_ID;
  view.appendChild(scroller);
  return view;
}

// --- rows --------------------------------------------------------------------

// A row in the app's own layout: title (+ subtitle) on the left, `control` on the right
// (one element, or several: the app spaces them with the gap its .setting-content has).
function row({ title, description, control }) {
  const item = el('div', 'setting-item');

  const label = el('div', 'setting-label');
  label.appendChild(el('div', 'setting-title', title ?? '(未命名)'));
  if (description) label.appendChild(el('div', 'setting-sub', description));
  item.appendChild(label);

  const content = el('div', 'setting-content');
  content.append(...[control].flat().filter(Boolean));
  // The panel starts dragging the window on any mousedown inside it (module-panel's
  // onMousedown), which is why the app's own controls all stop the event. Without this a
  // number box cannot be clicked into.
  content.addEventListener('mousedown', event => event.stopPropagation());
  item.appendChild(content);
  return item;
}

// Every field of an entry may be a plain value or a function returning one. The page is
// redrawn from the entry each time, so a mod passes functions for anything that changes
// (`value: () => enabled`) and the redraw picks up the current state.
const resolve = x => (typeof x === 'function' ? x() : x);

// Controls the app already has a class for. A mod describes one declaratively and the
// framework builds it, so no mod needs to know the markup.
const controls = {
  // { toggle: { value: boolean, onChange(next: boolean) } }
  toggle({ value, onChange }) {
    const wrap = el('label', 'setting-switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!resolve(value);
    input.addEventListener('change', () => onChange?.(input.checked));
    wrap.append(input, el('span', 'setting-slider'));
    return wrap;
  },
  // { button: { label, onClick, disabled? } }
  button({ label, onClick, disabled }) {
    const b = el('button', 'setting-btn', resolve(label));
    b.type = 'button';
    b.disabled = !!resolve(disabled);
    b.addEventListener('click', () => onClick?.());
    return b;
  },
  // { value: 'text' }  read-only figure, like "累计点击数  43524"
  value(text) {
    return el('span', 'setting-value', String(resolve(text)));
  },
  // { number: { value, min?, max?, step?, onChange(next: number) } }
  number({ value, min, max, step, onChange }) {
    const input = el('input', 'setting-input');
    input.type = 'number';
    input.value = resolve(value) ?? '';
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    if (step != null) input.step = step;
    input.style.minWidth = '120px';
    input.style.maxWidth = '140px';
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      // The box is still focused now, and a redraw does not pull a focused box from under the
      // user, so what was typed would stay on screen while something else was stored.
      input.value = clamped;
      onChange?.(clamped);
    });
    return input;
  },
};

function controlFor(entry) {
  for (const kind of ['toggle', 'button', 'number']) {
    if (entry[kind]) return controls[kind](entry[kind]);
  }
  if (entry.value != null) return controls.value(entry.value);
  if (typeof entry.render === 'function') return entry.render();   // anything else: the mod builds it
  return null;
}

// --- sections ----------------------------------------------------------------

// User mods only (kit.mods never holds framework scripts), by the name the user sees.
function loadedMods() {
  return [...kit.mods.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
}

// The page title is the room page's own header (div.room-info), which is the one place
// the app puts a title next to a count: 房间（3/5）, with the room number as a quieter line
// under it. Ours reads MOD（3） with the overall state underneath. 20px / 18px, colours and
// line heights all come from those classes.
function renderHeader(body, mods) {
  const failed = mods.filter(([id]) => kit.stateOf(id).status === 'error').length;
  const head = el('div', 'room-info');
  head.appendChild(el('div', 'room-qty', `MOD（${mods.length}）`));
  head.appendChild(el('div', 'room-number',
    !mods.length ? '把脚本放进 mods/ 文件夹，保存后自动加载'
      : failed ? `${failed} 个出错`
        : '全部正常'));
  // The room page puts 28px between this header and its list (.room-members margin-top).
  head.style.marginBottom = '28px';
  body.appendChild(head);
}

// The page is a list: one row per mod — name, what it does (or the error), a 设置 button when
// the mod has anything to set, and the master switch. The settings themselves open in a
// dialog (below), so the list stays one line per mod however many settings there are.
// A failure replaces the subtitle with its message; it is said in words, not colour,
// because the app's palette has no red or green to borrow.
function renderMod(body, id, manifest) {
  const state = kit.stateOf(id);
  const controlsOfRow = [];

  if (hasSettings(id, manifest)) {
    const open = el('button', 'setting-btn', '设置');
    open.type = 'button';
    open.addEventListener('click', () => openSettings(id));
    controlsOfRow.push(open);
  }
  controlsOfRow.push(controls.toggle({ value: kit.isEnabled(id), onChange: on => kit.setEnabled(id, on) }));

  body.appendChild(row({
    title: manifest.name,
    description: state.status === 'error' ? `出错：${state.error}` : manifest.description,
    control: controlsOfRow,
  }));
}

// The way into the log, after the mods: a row like theirs, with a button where theirs has a 设置.
function renderLogEntry(body) {
  const open = el('button', 'setting-btn', '查看');
  open.type = 'button';
  open.addEventListener('click', openLog);
  body.appendChild(row({ title: '日志', description: 'mod 和它们的 Node 部分输出的内容', control: open }));
}

// --- the dialog ----------------------------------------------------------------
//
// The panel already has a dialog: the one the 合成 page opens for the atlas. It is a layer
// over the whole panel, dimmed, leaving the tab strip visible (the left padding is
// --synthesis-atlas-pop-left), with a card in the middle and the app's own close button,
// and a click on the dimmed part closes it. Those classes are global, so this one is built
// from them and looks like the app's.

const POPUP_ID = 'modkit-popup';
const POPUP_BODY_ID = 'modkit-popup-body';

// What the dialog is showing: { kind: 'settings', id } for one mod's settings, { kind: 'log' }
// for the log, or null while it is closed.
let dialog = null;

const entriesOf = id => kit.entries.filter(e => e.owner === id);
const hasSettings = (id, manifest) => manifest.settings.length > 0 || entriesOf(id).length > 0;

function buildPopup() {
  const layer = el('div', 'synthesis-atlas-pop');
  layer.id = POPUP_ID;
  // The app stops mousedown here for the same reason as above, and closes on a click.
  layer.addEventListener('mousedown', event => event.stopPropagation());
  layer.addEventListener('click', closeDialog);

  const card = el('div', 'synthesis-atlas-pop-content');
  card.addEventListener('click', event => event.stopPropagation());

  const close = el('button', 'popup-close');
  close.type = 'button';
  close.addEventListener('click', closeDialog);

  // The card has a fixed size and its own padding; the list inside it scrolls, with the
  // app's thin scrollbar (the one .settings-module gives the settings page).
  const scroller = el('div', 'panel-content common-scrollbar2');
  scroller.id = POPUP_BODY_ID;
  scroller.style.height = '100%';
  scroller.style.overflowY = 'auto';

  card.append(close, scroller);
  layer.appendChild(card);
  return layer;
}

function onDialogKey(event) {
  if (event.key === 'Escape') closeDialog();
}

function openDialog(next) {
  const host = document.querySelector('.module-panel');   // the popup's variables live there
  if (!host) return;
  dialog = next;
  if (!document.getElementById(POPUP_ID)) {
    host.appendChild(buildPopup());
    document.addEventListener('keydown', onDialogKey);
  }
  renderPopup();
  if (dialog?.kind === 'log') {                            // a log is read from the end
    const body = document.getElementById(POPUP_BODY_ID);
    body.scrollTop = body.scrollHeight;
  }
}

const openSettings = id => openDialog({ kind: 'settings', id });
const openLog = () => openDialog({ kind: 'log' });

function closeDialog() {
  dialog = null;
  document.getElementById(POPUP_ID)?.remove();
  document.removeEventListener('keydown', onDialogKey);
}

function renderPopup() {
  if (dialog?.kind === 'log') renderLogDialog();
  else if (dialog?.kind === 'settings') renderSettingsDialog();
}

// Same header as the MOD page (name, and what it does under it), then the rows.
function renderSettingsDialog() {
  const body = document.getElementById(POPUP_BODY_ID);
  if (!body) return;
  const manifest = kit.mods.get(dialog.id);
  if (!manifest) return closeDialog();   // the mod was unloaded while its settings were open

  redraw(body, next => {
    const head = el('div', 'room-info');
    head.appendChild(el('div', 'room-qty', manifest.name));
    if (manifest.description) head.appendChild(el('div', 'room-number', manifest.description));
    head.style.marginBottom = '28px';
    next.appendChild(head);

    for (const def of manifest.settings) next.appendChild(settingRow(dialog.id, def));
    for (const entry of entriesOf(dialog.id)) next.appendChild(entryRow(entry));
  });
}

// --- the log ---------------------------------------------------------------------
//
// What mods write with mod.log / mod.warn, and a Node part with host.log (src/runtime/
// modkit-registry.js collects it from every window). One block in the settings page's own row
// style, a line each in its subtitle text; there is no red or green to mark a warning with, so
// the line says so in words.

const pad = n => String(n).padStart(2, '0');

function logLine(entry) {
  const at = new Date(entry.t);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  const name = kit.mods.get(entry.mod)?.name ?? entry.mod;
  const where = entry.source === 'node' ? 'Node' : entry.source;
  const level = entry.level === 'warn' ? '警告：' : entry.level === 'error' ? '错误：' : '';
  return `${time}  ${name}（${where}）  ${level}${entry.text}`;
}

function renderLogDialog() {
  const body = document.getElementById(POPUP_BODY_ID);
  if (!body) return;

  // Following the end, unless the user has scrolled up to read something.
  const following = body.scrollHeight - body.scrollTop - body.clientHeight < 12;
  redraw(body, next => {
    const head = el('div', 'room-info');
    head.appendChild(el('div', 'room-qty', `日志（${kit.logs.length}）`));
    head.appendChild(el('div', 'room-number', '最近 500 条，新的在下面'));
    head.style.marginBottom = '28px';
    next.appendChild(head);

    const clear = el('button', 'setting-btn', '清空');
    clear.type = 'button';
    clear.addEventListener('click', () => kit.clearLogs());
    next.appendChild(row({ title: '清空日志', description: '各窗口记下的都会清掉', control: clear }));

    const block = el('div', 'setting-item');
    const lines = el('div', 'setting-label');
    if (!kit.logs.length) lines.appendChild(el('div', 'setting-sub', '还没有日志。mod 用 mod.log / host.log 写的内容会出现在这里'));
    for (const entry of kit.logs) lines.appendChild(el('div', 'setting-sub', logLine(entry)));
    block.appendChild(lines);
    next.appendChild(block);
  });
  if (following) body.scrollTop = body.scrollHeight;
}

// Lines can come many at a time; draw once per 50 ms. (A timer, not a frame: a hidden window
// draws no frames, and the log should be current when it is shown.)
let logTimer = 0;
kit.onLog = () => {
  if (dialog?.kind !== 'log' || logTimer) return;
  logTimer = setTimeout(() => {
    logTimer = 0;
    renderLogDialog();
  }, 50);
};

// A row for something the mod declared in its package.json. Values are read and written through the
// framework, which is what makes them persist and reach the window the mod runs in.
function settingRow(id, def) {
  let control;
  if (def.type === 'toggle') {
    control = controls.toggle({
      value: () => kit.getConfig(id, def.key),
      onChange: next => kit.setConfig(id, def.key, next),
    });
  } else if (def.type === 'number') {
    control = controls.number({
      value: () => kit.getConfig(id, def.key),
      min: def.min, max: def.max, step: def.step,
      onChange: next => kit.setConfig(id, def.key, next),
    });
  } else {
    control = controls.value(liveText(id, def));
    control.dataset.modkitId = id;
    control.dataset.modkitKey = def.key;
  }
  return row({ title: def.title, description: def.description, control });
}

const liveText = (id, def) => String(kit.live.get(id)?.get(def.key) ?? def.default ?? '—');

// A figure a running mod publishes changes often; patch just that text instead of redrawing
// the page, which would also take focus away from an input the user is typing in.
kit.onLive = (id, key) => {
  const manifest = kit.mods.get(id);
  const def = manifest?.settings.find(s => s.key === key);
  if (!def) return;
  for (const node of document.querySelectorAll('#' + POPUP_BODY_ID + ' [data-modkit-id]')) {
    if (node.dataset.modkitId === id && node.dataset.modkitKey === key) node.textContent = liveText(id, def);
  }
};

// Draw into `body` without disturbing what did not change. The app's switches animate: the
// slider is moved by a CSS transition (.3s), which only plays on an element that stays in the
// page while its state changes. Replacing the row on every change, as an earlier version did,
// made every switch jump. So the new rows are built off to the side first, and if they are
// the same markup as what is showing (a switch's on/off is a property, not markup), only the
// state of the inputs is carried over and the nodes stay. Anything else replaces the content.
function redraw(body, build) {
  const next = document.createElement('div');
  build(next);

  if (body.innerHTML === next.innerHTML) {
    const showing = body.querySelectorAll('input');
    next.querySelectorAll('input').forEach((fresh, i) => {
      const old = showing[i];
      if (!old || old === document.activeElement) return;   // never pull a box from under typing
      if (old.type === 'checkbox') old.checked = fresh.checked;
      else old.value = fresh.value;
    });
    return;
  }

  const scrolled = body.scrollTop;
  body.textContent = '';
  body.append(...next.childNodes);
  body.scrollTop = scrolled;
}

function entryRow(entry) {
  let control = null;
  let failure = null;
  try {
    control = controlFor(entry);
  } catch (err) {
    failure = `渲染失败：${err.message ?? err}`;
    console.warn('[modkit] entry render failed', entry.title, err);
  }
  const item = row({
    title: resolve(entry.title),
    description: failure ?? resolve(entry.description),
    control,
  });
  item.dataset.entry = entry.serial;   // see redraw(): a re-registered row must not reuse the old one's handlers
  return item;
}

function renderView() {
  const view = document.getElementById(VIEW_ID);
  const body = document.getElementById(BODY_ID);
  if (!view || !body || view.style.display === 'none') return; // nothing to update while hidden
  renderPopup();   // no-op unless a dialog is open

  const mods = loadedMods();
  redraw(body, next => {
    renderHeader(next, mods);
    for (const [id, manifest] of mods) renderMod(next, id, manifest);
    renderLogEntry(next);
  });
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
  // Not 'block': the app's .module-block is a flex column, and an inline display would
  // replace that layout. Dropping the inline value lets the app's own rule apply.
  view.style.removeProperty('display');
  renderView();
  kit.hello();   // the windows running the mods answer with their state, which redraws
}

function hideModView() {
  closeDialog();
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
mod.onDispose(() => { kit.onChange = null; kit.onLive = null; });
mod.onDispose(closeDialog);
mod.onDispose(() => { kit.onLog = null; clearTimeout(logTimer); });
mod.onDispose(() => document.getElementById(TAB_ID)?.remove());
mod.onDispose(() => document.getElementById(VIEW_ID)?.remove());
mod.onDispose(() => document.getElementById(STYLE_ID)?.remove());

installStyle();
ensureTab();
