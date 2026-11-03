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

// The text under a title shares its line with these buttons (they are drawn over its right end), so it
// has to stay short: 18px, and about 450px before the first button. Longer is hidden behind them.
// The title row has room for the app's one button in its corner (.leave-room-btn is "position: absolute;
// right: 0; bottom: 0", and .common-btn is 135px wide). The second sits one button and a gap from the edge.
const INSTALL_BUTTON_RIGHT = 147;
const STYLE_ID = 'modkit-style';
const FOOT_ID = 'modkit-foot';

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
       settings page has no section headings, so neither is invented here). The version line at the
       foot and its bar are the one thing the app has no class for in this window: they take the app's
       own update dialog's colours (.app-update-overlay__progress, which this window does not load). */
    #${FOOT_ID} {
      flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 14px;
      padding: 8px 27px 14px; font-size: 14px; color: #8e7b6a; min-height: 28px;
    }
    #${FOOT_ID} .modkit-foot-text { max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .modkit-bar { width: 220px; height: 8px; border-radius: 4px; background: #ebce9b; overflow: hidden; flex: none; }
    .modkit-bar > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #c88865, #995e3f); transition: width .2s ease; }
    .modkit-bar > div.modkit-bar--wait { width: 40% !important; animation: modkit-bar-wait 1.2s ease-in-out infinite; }
    @keyframes modkit-bar-wait { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
    /* A new version is waiting: a dot on the tab, where the app puts its own marks (the corner of the icon). */
    #${TAB_ID}[data-update]::after {
      content: ''; position: absolute; top: 9px; left: 46px; width: 14px; height: 14px; box-sizing: border-box;
      border-radius: 50%; background: #ff9f3a; border: 2px solid #fff6dc; pointer-events: none;
    }
    /* The page of plugins: two tabs (the installed ones, and the registry's), and cards two to a line, with the app's colours. */
    .modkit-tabs { display: flex; align-items: center; gap: 28px; margin: 0 0 16px; border-bottom: 2px solid rgba(142, 94, 67, .16); }
    .modkit-tabs .modkit-tab {
      position: relative; margin: 0; padding: 6px 2px 10px; border: 0; background: none; cursor: pointer;
      font: inherit; font-size: 20px; color: #a89580;
    }
    .modkit-tabs .modkit-tab[aria-selected="true"] { color: #8e5e43; }
    .modkit-tabs .modkit-tab[aria-selected="true"]::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -2px; height: 3px; border-radius: 2px; background: #c88865;
    }
    .modkit-tabs .modkit-tab .modkit-count { margin-left: 6px; font-size: 14px; color: #a89580; }
    .modkit-tabs .modkit-tabs-end { margin: 0 0 6px auto; display: flex; align-items: center; gap: 10px; }
    .modkit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: stretch; margin: 0 0 14px; }
    .modkit-card {
      position: relative; display: flex; flex-direction: column; gap: 6px; min-height: 148px; box-sizing: border-box;
      padding: 14px 18px 16px; border-radius: 12px; background: #fbedd5;
    }
    .modkit-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .modkit-card-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; color: #8e5e43; }
    .modkit-chip { flex: none; padding: 0 9px; border-radius: 10px; line-height: 20px; font-size: 13px; color: #8e5e43; background: #f3dcb5; }
    .modkit-chip--ok { background: #fed291; }
    .modkit-chip--warn { background: #e3b59f; }
    .modkit-card-desc {
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 44px;
      font-size: 14px; line-height: 22px; color: #8e7b6a;
    }
    .modkit-card-author { font-size: 13px; line-height: 20px; color: #a89580; }
    .modkit-card-actions { display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 8px; }
    .modkit-btn {
      display: block; box-sizing: border-box; min-width: 72px; height: 28px; margin: 0; padding: 0 18px; border: 1px solid #e7b77c; border-radius: 20px;
      font: inherit; font-size: 16px; line-height: 26px; text-align: center; color: #8e5e43; background: #fed291; cursor: pointer; filter: drop-shadow(0 2px 0 #e7b77c);
      transition: transform .09s ease-out, filter .09s ease-out;
    }
    .modkit-btn--wide { flex: 1; }
    .modkit-btn--quiet { background: #f0d9b3; border-color: #e6cba0; color: #a89580; filter: none; cursor: default; }
    .modkit-btn:disabled { cursor: default; filter: none; }
    .modkit-btn:not(.modkit-btn--quiet):not(.modkit-new):active { transform: translateY(1px); filter: none; }
    /* the page does not scroll: the title and the tabs stay, and the cards of a tab scroll under them, with the app's thin scrollbar */
    #${BODY_ID} { display: flex; flex-direction: column; overflow: hidden !important; }
    #${BODY_ID} .modkit-scroll { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; margin-right: -10px; padding-right: 10px; }
    /* the switch is the app's (.setting-item .setting-switch), whose rules stop at a settings row: the same, here */
    .modkit-card .setting-switch { position: relative; display: inline-block; }
    .modkit-card .setting-switch input { opacity: 0; width: 0; height: 0; display: none; }
    .modkit-card .setting-switch .setting-slider {
      position: relative; width: 36px; height: 14px; padding: 2px; background: #fed291; border: 2px solid #E7B77C; border-radius: 20px;
      filter: drop-shadow(0 2px 0 #E7B77C); cursor: pointer; transition: .3s; transition-delay: var(--tdelay, 0ms); display: flex; align-items: center; justify-content: flex-start;
    }
    .modkit-card .setting-switch .setting-slider:before { position: relative; display: block; content: ""; height: 14px; width: 14px; background: #fff3dd; border-radius: 50%; transition: .3s; transition-delay: var(--tdelay, 0ms); }
    .modkit-card .setting-switch input:checked + .setting-slider { background: #c88865; border-color: #995e3f; filter: drop-shadow(0 2px 0 #995E3F); }
    .modkit-card .setting-switch input:checked + .setting-slider:before { transform: translate(22px); }
    .modkit-power { display: flex; align-items: center; gap: 10px; margin: 0; cursor: pointer; }
    .modkit-switch-text { font-size: 15px; color: #8e7b6a; }
    .modkit-card-badges { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
    .modkit-card-actions-end { display: flex; align-items: center; gap: 10px; margin-left: auto; }
    .modkit-btn.modkit-new {
      min-width: 0; height: 20px; padding: 0 10px; border: 0; border-radius: 10px; font-size: 13px; line-height: 20px; color: #fff6dc; background: #ff9f3a;
      filter: none; flex: none;
    }
    .modkit-btn.modkit-new:hover { background: #f08a1f; }
    .modkit-menu {
      position: absolute; right: 14px; bottom: 52px; z-index: 5; min-width: 150px; padding: 6px; border: 1px solid #e7b77c; border-radius: 12px;
      background: #fff6e4; box-shadow: 0 4px 14px rgba(90, 50, 20, .2);
    }
    .modkit-menu button { display: block; width: 100%; margin: 0; padding: 8px 12px; border: 0; border-radius: 8px; background: none; text-align: left; font: inherit; font-size: 16px; color: #8e5e43; cursor: pointer; }
    .modkit-menu button:hover { background: #fbedd5; }
    .modkit-menu hr { margin: 4px 8px; border: 0; border-top: 1px solid rgba(142, 94, 67, .18); }
    .modkit-note { margin: 0 0 14px; font-size: 14px; line-height: 22px; color: #a89580; }`;
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
  const foot = el('div');
  foot.id = FOOT_ID;
  foot.addEventListener('mousedown', event => event.stopPropagation());     // as in row(): the panel would drag the window
  view.appendChild(foot);
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
    const b = el('button', 'modkit-btn', resolve(label));
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
// A button at the right end of a title row, the way the room page puts its 离开房间: the app's
// own button (common-btn) with the class that places it (leave-room-btn is only "absolute, right
// 0, bottom 0" inside .room-info). The empty space beside a title is used, not a row of the list.
// `beside`: how far from the right edge, in px, when another button already has the corner.
function headerButton(label, onClick, beside = 0) {
  const button = el('button', 'modkit-btn leave-room-btn', label);
  button.type = 'button';
  if (beside) button.style.right = `${beside}px`;
  button.addEventListener('click', onClick);
  return button;
}

function renderHeader(body, mods) {
  const failed = mods.filter(([id]) => kit.stateOf(id).status === 'error').length;
  const head = el('div', 'room-info');
  head.appendChild(el('div', 'room-qty', 'MOD（' + mods.length + '）'));
  head.appendChild(el('div', 'room-number',
    !mods.length ? '还没有插件，到“插件市场”获取'
      : failed ? failed + ' 个出错'
        : '全部正常'));
  head.appendChild(headerButton('日志', openLog));
  head.style.marginBottom = '20px';
  body.appendChild(head);
  const notice = selfNotice();
  if (notice) body.appendChild(notice);
}

// --- this program: its version, and a newer one --------------------------------------------
//
// The loader (src/lib/updater.js) knows the version and asks GitHub; this page shows both. Where it shows:
//   the foot of the page   the version, and 检查更新 / 更新 (and, while it is taken, the bar and the step)
//   the top of the list    a row that says a new version is there, with 更新, while there is one
//   the MOD tab            a dot, so that it is seen without opening the page
// A check is made by itself when the panel opens (and every half hour while it stays), without a word if it fails.
// Taking the update downloads it, checks it, puts it in place, patches again and starts the app again: the loader
// says each step (`progress` events), and the last one is the end of this window, which is closed with the app.

const SELF_RECHECK_MS = 30 * 60_000;
// phase: 'idle' (not asked yet) | 'checking' | 'current' | 'newer' | 'updating' | 'restarting' | 'error'
const self = { phase: 'idle', current: null, latest: null, canUpdate: true, stage: '', received: 0, total: 0, message: '', at: 0, tried: 0 };

const selfBusy = () => ['checking', 'updating', 'restarting'].includes(self.phase);
const selfMarked = () => ['newer', 'updating', 'restarting'].includes(self.phase);
const marked = () => selfMarked() || found.list.length > 0;
const megabytes = bytes => (bytes / 1024 / 1024).toFixed(1);

// What the person is told while it goes on.
function selfProgressText() {
  if (self.phase === 'restarting' || self.stage === 'restart') return '正在重新打补丁并重启应用…';
  if (self.stage === 'verify') return '正在校验…';
  if (self.stage === 'install') return '正在安装…';
  const of = self.total ? ` / ${megabytes(self.total)} MB（${Math.floor((self.received * 100) / self.total)}%）` : ' MB';
  return `正在下载 v${self.latest}　${megabytes(self.received)}${of}`;
}

function selfBar() {
  const bar = el('div', 'modkit-bar');
  const fill = el('div');
  const known = self.phase === 'updating' && self.stage === 'download' && self.total > 0;
  if (known) fill.style.width = `${Math.min(100, (self.received * 100) / self.total)}%`;
  else fill.className = 'modkit-bar--wait';
  bar.appendChild(fill);
  return bar;
}

// The row at the top of the list.
function selfNotice() {
  if (!selfMarked()) return null;
  const waiting = self.phase === 'newer';
  return row({
    title: `框架有新版本 v${self.latest}`,
    description: waiting
      ? (self.canUpdate ? `当前 v${self.current}。更新会重新打补丁并重启应用。` : `当前 v${self.current}。这是从源码运行的开发版，请在仓库里 git pull。`)
      : selfProgressText(),
    control: waiting && self.canUpdate ? controls.button({ label: '更新', onClick: updateSelf }) : null,
  });
}

function renderFoot() {
  const foot = document.getElementById(FOOT_ID);
  if (!foot) return;
  const next = document.createElement('div');
  const version = self.current ? `框架 v${self.current}${self.canUpdate ? '' : '（开发版）'}` : '框架';
  const text = (value, title) => {
    const node = el('span', 'modkit-foot-text', value);
    if (title) node.title = title;
    next.appendChild(node);
  };
  const check = (label = '检查更新') => next.appendChild(controls.button({ label, onClick: () => checkSelf({ force: true }), disabled: selfBusy() }));

  switch (self.phase) {
    case 'checking':
      text(`${version}　正在检查更新…`);
      check();
      break;
    case 'current':
      text(`${version}　已是最新`);
      check();
      break;
    case 'newer':
      // A copy run from the repository cannot take it: it says so, and has no button that does nothing. A check stays, either
      // way: the loader may have been replaced since, and the page would otherwise keep saying what it was told before.
      text(self.canUpdate ? `${version}　新版本 v${self.latest}` : `${version}　新版本 v${self.latest}，开发版请用 git pull 更新`);
      check();
      if (self.canUpdate) next.appendChild(controls.button({ label: '更新', onClick: updateSelf }));
      break;
    case 'updating':
    case 'restarting':
      text(selfProgressText());
      next.appendChild(selfBar());
      break;
    case 'error':
      text(`${version}　${self.message}`, self.message);
      check('重试');
      break;
    default:
      text(version);
      check();
  }
  if (foot.innerHTML === next.innerHTML) return;
  foot.textContent = '';
  foot.append(...next.childNodes);
}

function renderSelf() {
  document.getElementById(TAB_ID)?.toggleAttribute('data-update', marked());
  renderFoot();
  renderView();
}

// `quiet`: nobody asked (the panel opened): nothing is said, whatever comes of it.
function checkSelf({ force = false, quiet = false } = {}) {
  if (selfBusy()) return;
  const before = self.phase;
  self.tried = Date.now();
  if (!quiet) {
    self.phase = 'checking';
    renderSelf();
  }
  kit.manage('self-check', { force }).done.then(result => {
    self.current = result.current;
    self.latest = result.latest;
    self.canUpdate = result.canUpdate !== false;
    self.at = Date.now();
    self.phase = result.newer ? 'newer' : 'current';
    if (result.updating) followUpdate(result.updating);
    renderSelf();
  }, err => {
    self.phase = quiet ? before : 'error';
    if (!quiet) self.message = `检查更新失败：${err.message}`;
    renderSelf();
  });
}

// The update was started by a page that is gone (the panel was closed and opened again, or the page was loaded again) and the
// loader is still at it: this page shows how far it is, asking once a second, until it is over.
let following = 0;
function followUpdate(progress) {
  Object.assign(self, { phase: progress.stage === 'restart' ? 'restarting' : 'updating', stage: progress.stage, received: Number(progress.received) || 0, total: Number(progress.total) || 0 });
  self.latest = progress.version ?? self.latest;
  if (following) return;
  following = setInterval(() => {
    kit.manage('self-check').done.then(result => {
      if (result.updating) {
        Object.assign(self, { phase: result.updating.stage === 'restart' ? 'restarting' : 'updating', stage: result.updating.stage, received: Number(result.updating.received) || 0, total: Number(result.updating.total) || 0 });
      } else {
        clearInterval(following);
        following = 0;
        self.phase = result.newer ? 'newer' : 'current';
      }
      renderSelf();
    }, () => { /* the loader is being replaced: the app is restarted, and this page with it */ });
  }, 1000);
}

function autoCheckSelf() {
  if (selfBusy() || Date.now() - self.tried < SELF_RECHECK_MS) return;
  checkSelf({ quiet: true });
}

function updateSelf() {
  if (self.phase !== 'newer' || !self.canUpdate) return;
  Object.assign(self, { phase: 'updating', stage: 'download', received: 0, total: 0, message: '' });
  renderSelf();
  kit.manage('self-update', {}, {
    onProgress: event => {
      self.stage = event.stage;
      if (event.stage === 'download') Object.assign(self, { received: Number(event.received) || 0, total: Number(event.total) || 0 });
      if (event.stage === 'restart') self.phase = 'restarting';
      renderSelf();
    },
  }).done.then(() => {}, err => {
    if (self.phase === 'restarting') return;               // the app is being closed: nothing more is heard
    Object.assign(self, { phase: 'error', message: `更新失败：${err.message}` });
    renderSelf();
  });
}

// --- plugins with a newer version -----------------------------------------------------------------------
//
// The registry's list says, for each plugin installed from it, whether there is a newer one (the loader works it out:
// `browse`). It is asked when the panel opens and every half hour, without a word if it fails; what it finds is shown the same
// ways as a newer framework is: the dot on the tab, a row at the top of the list (with 查看, which goes to the plugin market, where
// each one is updated after the person has seen what it declares), and a line on the plugin's own card. The list is also
// taken from the market whenever that is read, so it is right after an update.

const found = { list: [], tried: 0 };       // [{ id, name, from, to }]

const updatesOf = entries => (entries ?? []).filter(p => p.update && !p.dev && p.installed)
  .map(p => ({ id: p.id, name: p.name, from: p.installedVersion, to: p.version }));

function noteUpdates(entries) {
  market.plugins = entries ?? [];
  market.phase = 'list';
  market.loadedAt = Date.now();
  found.list = updatesOf(entries);
  found.tried = Date.now();
  renderSelf();
}

function pluginNotice() {
  if (!found.list.length) return null;
  const names = found.list.map(u => `${u.name} ${u.from ?? ''}${u.from ? ' → ' : ''}${u.to}`);
  return row({
    title: `有 ${found.list.length} 个插件可以更新`,
    description: names.join('、'),
    control: controls.button({ label: '查看', onClick: () => openPlugins() }),
  });
}

function autoCheckPlugins() {
  if (Date.now() - found.tried < SELF_RECHECK_MS) return;
  found.tried = Date.now();
  kit.manage('browse').done.then(result => { market.problems = result.problems ?? []; noteUpdates(result.mods); }, () => { /* nothing to say: the list is asked for again when it is opened */ });
}

// The page is a list: one row per mod — name, what it does (or the error), a 设置 button when
// the mod has anything to set, and the master switch. The settings themselves open in a
// dialog (below), so the list stays one line per mod however many settings there are.
// A failure replaces the subtitle with its message; it is said in words, not colour,
// because the app's palette has no red or green to borrow.
// What the page is showing: the tab ('installed' or 'market') and the card whose menu (更多) is open.
const ui = { tab: 'installed', menu: null };

// The registry's list, kept here and not in a dialog: it is read when the panel opens (to know what has a newer version) and
// shown in the other tab. `op` is what is being asked or waited for (see the prompt below), or null.
const market = { phase: 'idle', plugins: [], problems: [], message: '', loadedAt: 0, loading: false, op: null, requestId: null, cancelled: false };

const MARKET_STALE_MS = 5 * 60_000;

function setTab(name) {
  ui.tab = name;
  ui.menu = null;
  renderView();
  document.querySelector('#' + VIEW_ID + ' .modkit-scroll')?.scrollTo(0, 0);
  if (name === 'market' && (market.phase !== 'list' || Date.now() - market.loadedAt > MARKET_STALE_MS)) loadMarket();
}

const openPlugins = () => setTab('market');

function loadMarket() {
  if (market.loading) return;
  market.loading = true;
  if (!market.plugins.length) market.phase = 'loading';
  renderView();
  kit.manage('browse').done.then(result => {
    market.problems = result.problems ?? [];
    noteUpdates(result.mods);
  }, err => {
    if (market.plugins.length) notify(`没能刷新插件列表：${err.message}`);
    else Object.assign(market, { phase: 'error', message: err.message });
  }).finally(() => {
    market.loading = false;
    renderView();
  });
}

// --- the tabs and the cards -------------------------------------------------------------------------------

const chip = (text, kind) => el('span', `modkit-chip${kind ? ` modkit-chip--${kind}` : ''}`, text);

function button(label, onClick, kind = '') {
  const node = el('button', `modkit-btn ${kind}`.trim(), label);
  node.type = 'button';
  node.addEventListener('click', event => {
    event.stopPropagation();                  // a click anywhere else closes the menu of a card
    onClick(event);
  });
  return node;
}

function tabBar(mods) {
  const bar = el('div', 'modkit-tabs');
  bar.setAttribute('role', 'tablist');
  const make = (name, label, count) => {
    const tab = el('button', 'modkit-tab', label);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(ui.tab === name));
    if (count) tab.appendChild(el('span', 'modkit-count', String(count)));
    tab.addEventListener('click', () => setTab(name));
    return tab;
  };
  bar.append(make('installed', '已安装', mods.length), make('market', '插件市场', found.list.length ? `有 ${found.list.length} 个可更新` : 0));
  if (ui.tab === 'market') {
    const end = el('div', 'modkit-tabs-end');
    end.appendChild(button('刷新', loadMarket));
    bar.appendChild(end);
  }
  return bar;
}

// Words for where a plugin stands: said in words, because the app's palette has no red or green to say it with.
const STATUS_TEXT = { ok: '正常', idle: '正常', error: '出错', off: '已关闭', waiting: '等待中', loading: '启动中' };

// The page is drawn again at every change, and a card with it, so the switch that was pressed is gone as it starts to move and the new
// one would be born at the end of its way. What each was last drawn as is kept, and a switch that is drawn anew is drawn where the
// one before it was, and set to its new place a frame later: it goes the same way as the app's own (the settings dialog's, which is
// never drawn anew). When it is drawn anew again while it is on its way (a plugin that starts says "starting", then "running"), it
// goes on from where it had got to: a transition that has a negative delay begins that far in.
const powerDrawn = new Map();       // plugin -> { shown, from, at }
const POWER_MS = 300;               // the app's switch takes .3 s

function powerSwitch(id, enabled) {
  const sw = controls.toggle({ value: enabled, onChange: on => kit.setEnabled(id, on) });
  const input = sw.querySelector('input');
  const now = performance.now();
  const before = powerDrawn.get(id);
  let start = enabled;
  let elapsed = 0;
  if (!before) {
    powerDrawn.set(id, { shown: enabled, from: enabled, at: -1e9 });
  } else if (before.shown !== enabled) {
    powerDrawn.set(id, { shown: enabled, from: before.shown, at: now });
    start = before.shown;
  } else if (now - before.at < POWER_MS) {
    start = before.from;
    elapsed = now - before.at;
  }
  if (start !== enabled) {
    input.checked = start;
    sw.style.setProperty('--tdelay', `-${Math.round(elapsed)}ms`);
    requestAnimationFrame(() => requestAnimationFrame(() => { input.checked = enabled; }));
  }
  return sw;
}

function installedCard(id, manifest) {
  const state = kit.stateOf(id);
  const enabled = kit.isEnabled(id);
  const known = market.plugins.find(p => p.id === id);
  const update = found.list.find(u => u.id === id);
  const plugin = { id, name: manifest.name };

  const card = el('div', 'modkit-card');
  const head = el('div', 'modkit-card-head');
  const title = el('div', 'modkit-card-title', manifest.name);
  title.title = manifest.name;
  head.appendChild(title);
  // A newer version is a badge right beside the name, and it is the way to take it: pressing it updates the plugin.
  if (update) {
    const badge = button(`新版本 ${update.to}`, () => pluginRequest('update', plugin), 'modkit-new');
    badge.title = `${update.from ? `${update.from} → ` : ''}${update.to}，点击更新`;
    head.appendChild(badge);
  }
  const rest = el('div', 'modkit-card-badges');
  if (manifest.version) rest.appendChild(chip(`v${manifest.version}`));
  rest.appendChild(chip(STATUS_TEXT[state.status] ?? state.status, state.status === 'error' ? 'warn' : state.status === 'off' ? '' : 'ok'));
  head.appendChild(rest);
  card.appendChild(head);

  card.appendChild(el('div', 'modkit-card-desc',
    state.status === 'error' ? `出错：${state.error}`
      : state.status === 'waiting' ? state.error
        : [manifest.dev ? '开发中' : null, manifest.description].filter(Boolean).join(' · ')));
  if (known?.author) card.appendChild(el('div', 'modkit-card-author', `作者：${known.author}`));

  const actions = el('div', 'modkit-card-actions');
  // The master switch is a switch, the app's own: off means the plugin does not run at all.
  const power = el('label', 'modkit-power');
  power.append(powerSwitch(id, enabled), el('span', 'modkit-switch-text', enabled ? '已启用' : '已关闭'));
  actions.appendChild(power);
  const right = el('div', 'modkit-card-actions-end');
  if (hasSettings(id, manifest)) right.appendChild(button('设置', () => openSettings(id)));

  // 更多: only for what came from the registry, which is what can be checked and taken away from here
  if (known?.fromRegistry && !known.dev) {
    right.appendChild(button('更多', () => { ui.menu = ui.menu === id ? null : id; renderView(); }));
    if (ui.menu === id) {
      const menu = el('div', 'modkit-menu');
      const item = (label, onClick) => {
        const entry = el('button', null, label);
        entry.type = 'button';
        entry.addEventListener('click', event => { event.stopPropagation(); ui.menu = null; onClick(); });
        return entry;
      };
      menu.append(
        item('检查更新', () => pluginRequest('update', plugin)),
        el('hr'),
        item('卸载', () => setOp(market, { type: 'confirm-remove', plugin, purge: false })),
      );
      card.appendChild(menu);
    }
  }
  actions.appendChild(right);
  card.appendChild(actions);
  return card;
}

function marketCard(plugin) {
  const card = el('div', 'modkit-card');
  const head = el('div', 'modkit-card-head');
  const title = el('div', 'modkit-card-title', plugin.name);
  title.title = plugin.name;
  head.appendChild(title);
  head.appendChild(chip(`v${plugin.version}`));
  card.appendChild(head);

  const note = plugin.dev ? '开发中：用的是本地文件夹'
    : plugin.installed && !plugin.fromRegistry ? '已有同名插件（不是从这里安装的）'
      : null;
  card.appendChild(el('div', 'modkit-card-desc', [plugin.description, plugin.nodePart ? '带后台程序' : null, note].filter(Boolean).join(' · ')));
  if (plugin.author) card.appendChild(el('div', 'modkit-card-author', `作者：${plugin.author}`));

  const actions = el('div', 'modkit-card-actions');
  let main;
  if (plugin.dev || (plugin.installed && !plugin.fromRegistry)) main = button(plugin.dev ? '开发中' : '已有同名插件', () => {}, 'modkit-btn--wide modkit-btn--quiet');
  else if (!plugin.installed) main = button('安装', () => pluginRequest('get', plugin), 'modkit-btn--wide');
  else if (plugin.update) main = button(`更新到 v${plugin.version}`, () => pluginRequest('update', plugin), 'modkit-btn--wide');
  else main = button('已安装', () => {}, 'modkit-btn--wide modkit-btn--quiet');
  if (plugin.dev || plugin.installed && !plugin.fromRegistry || (plugin.installed && !plugin.update)) main.disabled = true;
  actions.appendChild(main);
  card.appendChild(actions);
  return card;
}

// The bottom of the cards is not cut by the foot: the foot is under the scrolling part, not over it.
function renderInstalled(body, mods) {
  const plugins = pluginNotice();
  if (plugins) body.appendChild(plugins);
  if (!mods.length) {
    body.appendChild(row({ title: '还没有插件', description: '到“插件市场”获取。', control: controls.button({ label: '去插件市场', onClick: openPlugins }) }));
    return;
  }
  const grid = el('div', 'modkit-grid');
  for (const [id, manifest] of mods) grid.appendChild(installedCard(id, manifest));
  body.appendChild(grid);
}

function renderMarket(body) {
  if (market.phase === 'loading' || (market.phase === 'idle' && !market.plugins.length)) {
    body.appendChild(el('p', 'modkit-note', '正在读取插件列表…'));
    return;
  }
  if (market.phase === 'error') {
    body.appendChild(row({ title: '没能读取插件列表', description: market.message, control: controls.button({ label: '重试', onClick: loadMarket }) }));
    return;
  }
  if (!market.plugins.length) {
    body.appendChild(el('p', 'modkit-note', '仓库里还没有插件'));
    return;
  }
  // what has a newer version first, then what is not installed, then the rest, each in the registry's order
  const rank = p => (p.update ? 0 : !p.installed ? 1 : 2);
  const sorted = market.plugins.map((p, order) => ({ p, order })).sort((a, b) => rank(a.p) - rank(b.p) || a.order - b.order).map(x => x.p);
  const grid = el('div', 'modkit-grid');
  for (const plugin of sorted) grid.appendChild(marketCard(plugin));
  body.appendChild(grid);
  if (market.problems.length) body.appendChild(el('p', 'modkit-note', `有 ${market.problems.length} 个条目格式不对，已跳过：${market.problems.join('；')}`));
}

// --- the dialog ----------------------------------------------------------------
//
// Every dialog here has one look, the app's own confirm dialog (.role-switch-emote-overlay: a layer over the
// whole window, dimmed, and a panel with the parchment background, a brown border and 48px corners), and
// one place, the middle of the window, which is where the About dialog opens. The settings page's
// card (.synthesis-atlas-pop-content: cream, 30px corners, beside the tab strip) is not used: one app
// should not have two sizes of corner. They come in and go with a fade and a slight zoom, 0.2 s, the
// length of the app's own .fade-enter-active / .fade-leave-active.
//
// These classes are global (no data-v scoping), so using them is enough.

const POPUP_ID = 'modkit-popup';
const POPUP_BODY_ID = 'modkit-popup-body';
const FADE_MS = 200;

// What the dialog is showing: { kind: 'settings', id } for one mod's settings, { kind: 'log' } for the log,
// or null while it is closed. (The plugins are a page, not a dialog.)
let dialog = null;

const entriesOf = id => kit.entries.filter(e => e.owner === id);
const hasSettings = (id, manifest) => manifest.settings.length > 0 || entriesOf(id).length > 0;

// The layer and the panel every dialog is made of. `wide`: a panel for a list, which scrolls, not for a
// question. (A timer, not a frame, in what follows: a hidden window draws no frames.)
function frame({ id, wide = false }) {
  const layer = el('div', 'role-switch-emote-overlay');
  layer.id = id;
  // The class leaves room for the tab strip on the left, as the atlas dialog does. These are in the middle.
  layer.style.padding = '24px';
  // The app starts dragging the window on any mousedown in the panel, which is why its own dialogs stop it.
  layer.addEventListener('mousedown', event => event.stopPropagation());

  const panel = el('div', 'role-switch-emote-overlay__panel');
  if (wide) {
    panel.style.width = 'min(780px, 100%)';
    panel.style.height = 'min(560px, 100%)';
    panel.style.padding = '32px 14px 32px 36px';
    panel.style.display = 'flex';
  }
  layer.appendChild(panel);
  return { layer, panel };
}

// In: from invisible and a little small to as it is. Out: the other way, and then gone.
function appear(layer) {
  const panel = layer.firstElementChild;
  layer.classList.add('fade-enter', 'fade-enter-active');
  panel.style.transform = 'scale(0.94)';
  panel.style.transition = `transform ${FADE_MS}ms ease-out`;
  setTimeout(() => {
    layer.classList.remove('fade-enter');
    panel.style.transform = '';
    setTimeout(() => {
      layer.classList.remove('fade-enter-active');
      panel.style.transition = '';
    }, FADE_MS);
  }, 30);
}

function disappear(layer) {
  if (!layer) return;
  layer.removeAttribute('id');                       // it is on its way out: nothing should find it now
  layer.style.pointerEvents = 'none';
  layer.firstElementChild.style.transition = `transform ${FADE_MS}ms ease-in`;
  layer.firstElementChild.style.transform = 'scale(0.94)';
  layer.classList.add('fade-leave-active', 'fade-leave-to');
  setTimeout(() => layer.remove(), FADE_MS);
}

function buildPopup() {
  const { layer, panel } = frame({ id: POPUP_ID, wide: true });
  layer.addEventListener('click', closeDialog);       // a click on the dimmed part closes it
  panel.addEventListener('click', event => event.stopPropagation());

  const close = el('button', 'popup-close');          // the app's own: the star that turns round when pointed at
  close.type = 'button';
  close.addEventListener('click', closeDialog);

  // The list scrolls inside the panel, with the app's thin scrollbar.
  const scroller = el('div', 'panel-content common-scrollbar2');
  scroller.id = POPUP_BODY_ID;
  scroller.style.flex = '1';
  scroller.style.minWidth = '0';
  scroller.style.overflowY = 'auto';

  panel.append(close, scroller);
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
    const layer = buildPopup();
    host.appendChild(layer);
    appear(layer);
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
  disappear(document.getElementById(POPUP_ID));
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

// --- plugins: the registry's list, and installing, updating, removing ---------------------------
//
// The page cannot touch the disk or the network; the loader does (src/lib/manager.js), and checks every
// download against the registry's index. What this page adds is the order of things: an install fetches the
// plugin, then stops to say what it declares, and nothing is put in place until the person says yes here.
//
// What happens to a plugin is not another page of it: a question, a wait, a failure is a prompt laid over the
// page (the app's own confirm dialog, .role-switch-emote-overlay), and "installed" / "removed" is a bubble
// (the app's own toast, .toast-wrapper) that goes by itself. So the cards never jump.

// --- the prompt over the list --------------------------------------------------------------------------
//
// market.op is what is being asked or waited for, or null:
//   { type: 'busy', text }                          waiting for the loader; nothing to press
//   { type: 'confirm', info }                       an install or an update, with what the package declares
//   { type: 'confirm-remove', plugin, purge }       a removal
//   { type: 'error', verb, message }                it did not work; 好 closes it

const OVERLAY_ID = 'modkit-overlay';
const TOAST_ID = 'modkit-toast';
const TOAST_MS = 2400;
let toastTimer = 0;

// A bubble in the middle, the app's own, that goes by itself. Above the dialog (z-index 99) and the prompt.
function notify(text) {
  clearTimeout(toastTimer);
  document.getElementById(TOAST_ID)?.remove();
  const body = el('p', 'toast-body');
  body.appendChild(el('span', 'toast-text', text));
  const content = el('div', 'toast-content');
  content.appendChild(body);
  const wrapper = el('div', 'toast-wrapper locale-zh');
  wrapper.id = TOAST_ID;
  wrapper.style.zIndex = '100001';
  wrapper.appendChild(content);
  (document.querySelector('.module-panel') ?? document.body).appendChild(wrapper);
  toastTimer = setTimeout(() => wrapper.remove(), TOAST_MS);
}

// What a permission word in a plugin's package.json is called to the person. Anything else is shown as it is.
const PERMISSION_LABELS = { files: '读写文件', network: '联网', clipboard: '读写剪贴板', run: '运行其他程序', 'app-internals': '读取并改动应用内部状态（桌宠的位置）', page: '往应用的页面里加内容、改页面样式', 'app-commands': '向应用发出命令（比如进入房间）', 'app-state': '读取应用的账号和点击数等数据' };
const permissionText = list => list.map(word => PERMISSION_LABELS[word] ?? word).join('、');

// What each kind of prompt says and has to press: { title, body, checkbox, buttons }. The title is what is
// being asked; the body is what the person needs to know to answer, each item a paragraph, or [label, text]
// for a fact. Plain words: it is read by someone deciding whether to let somebody's code onto their computer.
function promptFor(op) {
  if (op.type === 'busy') return { title: op.text, body: [], buttons: [] };

  if (op.type === 'error') {
    return { title: `${op.verb}没有成功`, body: [op.message], buttons: [{ label: '好', kind: 'confirm', onClick: () => setOp(market, null) }] };
  }

  if (op.type === 'confirm-remove') {
    return {
      title: `卸载「${op.plugin.name}」？`,
      body: ['会删除它的文件夹。它在软件里保存的设置会保留，以后再装回来还能用。'],
      checkbox: { label: '同时删除它保存的数据', checked: op.purge, onChange: on => { op.purge = on; } },
      buttons: [
        { label: '取消', kind: 'cancel', onClick: () => setOp(market, null) },
        { label: '卸载', kind: 'confirm', onClick: () => pluginRequest('remove', op.plugin, { purge: op.purge }) },
      ],
    };
  }

  const info = op.info;
  const name = info.name ?? info.id;
  const update = Boolean(info.before);
  const title = update ? `将「${name}」从 ${info.before} 更新到 ${info.version}？` : `安装「${name}」${info.version ?? ''}？`;
  const body = [];
  if (info.description) body.push(info.description);
  body.push(['作者声明的权限', info.permissions.length ? permissionText(info.permissions) : '没有声明需要特别的权限']);
  body.push(['后台程序', info.nodePart ? '有。作为独立程序在电脑上运行，权限和当前用户一样，不受限制。' : '无']);
  const requires = Object.entries(info.requires ?? {}).map(([required, range]) => `${required} ${range}`);
  if (requires.length) body.push(['需要先装好', requires.join('、')]);
  if (info.dependencies.length) body.push([`会一并下载 ${info.dependencies.length} 个组件`, info.dependencies.join('、')]);
  if (info.warning) body.push(['提示', info.warning]);
  body.push('插件的脚本会在软件窗口里运行，软件能做的它都能做。请只安装信得过的插件。');
  return {
    title,
    body,
    buttons: [
      { label: '取消', kind: 'cancel', onClick: () => answerPlugin(false) },
      { label: update ? '更新' : '安装', kind: 'confirm', onClick: () => answerPlugin(true) },
    ],
  };
}

// The words of a prompt: the title bold and in the middle, and under it, smaller, in the plain face and the paler brown, set
// from the left, as the About dialog sets its own, but in the sizes of this page (its cards are 14 to 18 px; the About dialog's
// 30 and 20 px are for a dialog that has nothing else on it, and a question about a plugin is asked over a page of small
// print). A wait ("正在获取…") has no body, and is a small card.
const TITLE_FONT = '"975MaruSC-Bold", "975MaruSC", "Microsoft YaHei", sans-serif';
const BOLD_BROWN = 'rgb(142, 94, 67)';
const BODY_BROWN = 'rgb(142, 123, 106)';

function promptText({ title, body }) {
  const text = el('div', 'modkit-prompt');
  const heading = el('h2', null, title);
  const wait = body.length === 0;
  Object.assign(heading.style, {
    margin: wait ? '0' : '0 0 14px', fontFamily: TITLE_FONT, fontSize: wait ? '18px' : '22px', lineHeight: wait ? '26px' : '30px',
    fontWeight: '700', color: BOLD_BROWN, textAlign: 'center',
  });
  text.appendChild(heading);
  for (const item of body) {
    const paragraph = el('p');
    Object.assign(paragraph.style, { margin: '0 0 8px', fontSize: '15px', lineHeight: '24px', color: BODY_BROWN, textAlign: 'left' });
    if (Array.isArray(item)) {
      const label = el('span', null, `${item[0]}：`);
      Object.assign(label.style, { fontFamily: TITLE_FONT, fontWeight: '700', color: BOLD_BROWN });
      paragraph.append(label, item[1]);
    } else {
      paragraph.textContent = item;
    }
    text.appendChild(paragraph);
  }
  if (!wait) text.lastElementChild.style.marginBottom = '18px';   // room before the buttons or the box
  return text;
}

// Put the prompt for market.op on screen, or take it away. Built again only when what it says changes, so
// that a box the person has ticked is not unticked by a redraw of the list.
function syncOverlay() {
  const op = market.op;
  const existing = document.getElementById(OVERLAY_ID);
  if (!op) {
    disappear(existing);
    return;
  }
  const key = JSON.stringify([op.type, op.text, op.message, op.info?.id, op.plugin?.id]);
  if (existing?.dataset.key === key) return;
  existing?.remove();                                // replaced in place: it does not fade out and in again

  const prompt = promptFor(op);
  const { layer, panel: card } = frame({ id: OVERLAY_ID });
  layer.dataset.key = key;
  if (!prompt.body.length) {                          // a wait: a small card, not a dialog
    Object.assign(card.style, { width: 'auto', minWidth: '260px', maxWidth: '420px', height: 'auto', padding: '20px 36px' });
  } else {                                            // a question: narrower than the app's own, which has one short line in it
    Object.assign(card.style, { width: 'min(500px, 100%)', padding: '26px 32px 28px' });
  }
  card.appendChild(promptText(prompt));

  if (prompt.checkbox) {
    const label = el('label', 'role-switch-emote-overlay__checkbox');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!prompt.checkbox.checked;
    box.addEventListener('change', () => prompt.checkbox.onChange(box.checked));
    label.append(box, el('span', null, prompt.checkbox.label));
    card.appendChild(label);
  }

  if (prompt.buttons.length) {
    const actions = el('div', 'role-switch-emote-overlay__actions');
    for (const { label, kind, onClick } of prompt.buttons) {
      const button = el('button', `role-switch-emote-overlay__${kind}`, label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      actions.appendChild(button);
    }
    card.appendChild(actions);
  }

  (document.querySelector('.module-panel') ?? document.body).appendChild(layer);
  if (!existing) appear(layer);                      // one that was not there before comes in; the next one just replaces it
}

// Set what is being asked, and draw it.
function setOp(state, op) {
  state.op = op;
  syncOverlay();
  renderPopup();
  renderView();
}

// Escape: the prompt first, when there is one that can be said no to; the dialog after (it hears the key later).
function cancelPrompt() {
  const op = market.op;
  if (!op || op.type === 'busy') return false;
  if (op.type === 'confirm') answerPlugin(false);
  else setOp(market, null);
  return true;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && market.op && cancelPrompt()) event.stopImmediatePropagation();
}, true);

// What was being asked when the page is left is a no, and not something left hanging in the loader.
function cancelMarketOp() {
  if (market.op?.type === 'confirm') {
    market.cancelled = true;
    kit.manageAnswer(market.requestId, false);
  }
  if (market.op && market.op.type !== 'busy') setOp(market, null);
}

// --- one request to the loader -----------------------------------------------------------------------------

const DONE_TEXT = {
  installed: (r, name) => `已安装「${name}」${r.version ? ` ${r.version}` : ''}`,
  updated: (r, name) => `已将「${name}」更新到 ${r.version ?? '新版本'}`,
  current: (r, name) => `「${name}」已经是最新版${r.version ? `（${r.version}）` : ''}`,
  removed: (r, name) => `已卸载「${name}」${r.purged ? '，保存的数据也已删除' : ''}`,
};

const VERB = { get: '安装', update: '更新', remove: '卸载' };

// One request about a plugin. A plugin waiting for its yes gets a no if the page is left meanwhile.
function pluginRequest(action, plugin, args = {}) {
  const mine = market;
  mine.cancelled = false;
  // Before the question it is only fetching; "installing" starts once the person has said yes.
  setOp(mine, { type: 'busy', text: action === 'remove' ? '正在卸载「' + plugin.name + '」…' : '正在获取「' + plugin.name + '」…' });
  const { id, done } = kit.manage(action, { mod: plugin.id, ...args }, {
    onConfirm: info => setOp(mine, { type: 'confirm', info }),
  });
  mine.requestId = id;
  done.then(result => {
    const said = DONE_TEXT[result.done]?.(result, plugin.name);
    if (said) notify(said);
    if (result.mods) {
      mine.problems = result.problems ?? [];
      noteUpdates(result.mods);
    }
    setOp(mine, null);
  }, err => {
    if (mine.cancelled) return;
    setOp(mine, { type: 'error', verb: VERB[action], message: err.message });
  });
}

function answerPlugin(ok) {
  const state = market;
  kit.manageAnswer(state.requestId, ok);
  if (!ok) {
    state.cancelled = true;
    setOp(state, null);
    return;
  }
  const { info } = state.op;
  setOp(state, { type: 'busy', text: '正在' + (info.before ? '更新' : '安装') + '「' + (info.name ?? info.id) + '」…' });   // until the loader says it is done
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
    head.appendChild(headerButton('清空', () => kit.clearLogs()));      // in every window
    head.style.marginBottom = '28px';
    next.appendChild(head);

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
  const inner = body.querySelector('.modkit-scroll')?.scrollTop ?? 0;
  body.textContent = '';
  body.append(...next.childNodes);
  body.scrollTop = scrolled;
  const again = body.querySelector('.modkit-scroll');
  if (again) again.scrollTop = inner;
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
    next.appendChild(tabBar(mods));
    const scroll = el('div', 'modkit-scroll common-scrollbar2');
    if (ui.tab === 'market') renderMarket(scroll);
    else renderInstalled(scroll, mods);
    next.appendChild(scroll);
  });
  renderFoot();
}

// A mod that changes many rows at once (a hundred added, a hundred taken away) says "changed" for each of them. The
// page is drawn once for all of them, when that run of calls is over, and not once for each: drawn at every
// call, the cost grows with the square of the number of rows.
document.addEventListener('click', () => {
  if (!ui.menu) return;
  ui.menu = null;
  renderView();
});

let drawQueued = false;
kit.onChange = () => {
  if (drawQueued) return;
  drawQueued = true;
  queueMicrotask(() => {
    drawQueued = false;
    if (kit.onChange) renderView();                              // not if the page has been taken down in the meantime
  });
};

// --- switching between our page and the app's pages -------------------------

// Whether our page is showing. See leaveModView for what leaving has to hand back.
let modOpen = false;

// Which stock tab (its place among them) was selected when ours was chosen: the page the app itself thinks the panel
// is on. It is what the app draws again when the panel is closed and opened (see keepModView).
let modFrom = -1;

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
  autoCheckSelf();
  autoCheckPlugins();
  kit.hello();   // the windows running the mods answer with their state, which redraws
}

function hideModView() {
  closeDialog();
  cancelMarketOp();
  ui.menu = null;
  document.getElementById(VIEW_ID)?.style.setProperty('display', 'none');

  const host = moduleHost();
  if (!host) return;
  for (const block of host.querySelectorAll(BLOCK_SELECTOR)) {
    if (block.id === VIEW_ID || block.dataset.modkitHidden !== '1') continue;
    block.style.removeProperty('display');
    delete block.dataset.modkitHidden;
  }
}

// While our page is the one open, it is the only one showing. The app draws its own pages again when the panel is
// closed with its own button and opened again, if the page it was on loads something (the bag, the atlas, the
// synthesis page; not the settings or the room page): the blocks are new elements, which are not marked as put
// away, so the app's page and ours showed together, with the app's first. So what the app has drawn is put away
// again, and the tab it lights is not lit.
//
// Unless it lights another page than the one it was on when ours was chosen: then the app is being told to show
// that page (open the bag from the pet's menu), and it is shown.
function keepModView() {
  const host = moduleHost();
  if (!host) return;

  const tabs = stockTabs();
  const lit = tabs.map((tab, index) => (tab.classList.contains('tab-btn--active') ? index : -1)).filter(index => index >= 0);
  if (lit.length && modFrom >= 0 && !lit.includes(modFrom)) {
    leaveModView(null);
    return;
  }

  const view = host.querySelector('#' + VIEW_ID);
  const stray = [...host.querySelectorAll(BLOCK_SELECTOR)].filter(block => block.id !== VIEW_ID && block.dataset.modkitHidden !== '1');
  if (view && view.style.display !== 'none' && !stray.length && !lit.length) return;

  for (const index of lit) tabs[index].classList.remove('tab-btn--active');
  document.getElementById(TAB_ID)?.classList.add('tab-btn--active');
  showModView();
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
    const from = stockTabs().findIndex(other => other.classList.contains('tab-btn--active'));
    if (from >= 0) modFrom = from;
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
    tab.toggleAttribute('data-update', marked());
    autoCheckSelf();
    autoCheckPlugins();
    if (modOpen) keepModView();
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

// --- the app's snapshots, a few times a second and not once for every click --------------------------------
//
// While the panel is open the main window sends it a snapshot of the whole of its state (the bag, the atlas, the room,
// the click counts, ...) every time any of it changes, and the panel draws all of it again. A click changes the
// click count, so at the twenty clicks a second that a plugin can make, the panel is drawn twenty times a second:
// it is busy nearly all the time, makes a gigabyte of garbage in an hour, and answers the person's own clicks late.
//
// A snapshot is the whole state, so the newest of a run of them makes the ones before it unnecessary. One that
// changes what the panel shows (another tab, a list, the room, who is logged in) is passed on at once; one that
// differs from the last passed on only in the counters, and the like, waits for the next SNAPSHOT_GAP_MS and
// then the newest is passed on. The panel only wants revisions that go up (it ignores the rest), and they do.
// The patch of the room's members (which is merged into the snapshot) is never passed before a snapshot that is
// older than it: the held ones go first.
//
// The app's listeners are kept in T.callbacks (id -> function); they are wrapped there, and put back when this is
// switched off. Nothing here is the app's code or the person's data: it only decides when the panel is told.
// <snapshots>
const SNAPSHOT_EVENT = 'cat-panel-state';
const PATCH_EVENT = 'cat-panel-room-members-patch';
const SNAPSHOT_GAP_MS = 200;

const snapshots = (() => {
  const listeners = window.__TAURI_INTERNALS__?.callbacks;
  if (!(listeners instanceof Map)) return { stop() {}, stats: {} };

  const flushers = new Set();
  const stats = { passed: 0, held: 0 };
  let stopped = false;

  // What the panel would show differently: if this differs from the last one passed on, it is not held.
  const shape = payload => {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload;
    return [p.activeTab, p.collapsed, p.isLoggedIn, p.roomMode, p.currentRoomId, p.roomIdInput, p.participantsLength,
      p.bagListLoading, p.atlasListLoading, p.presetListLoading, p.panelUiEpoch, p.selectedRoleId, p.selectedPartId, p.streamId,
      p.bagList?.length, p.atlasList?.length, p.presetList?.length, p.roomMembers?.length, p.userInfo?.id, p.localMemberId,
      p.canCreateRoom, p.canJoinRoom, p.canLeaveRoom].join('|');
  };

  function wrap(original) {
    let lastAt = 0;
    let lastShape = null;
    let newest = null;
    let timer = 0;

    const pass = data => {
      lastAt = performance.now();
      lastShape = shape(data.payload);
      stats.passed += 1;
      return original.call(null, data);
    };
    const flush = () => {
      clearTimeout(timer);
      timer = 0;
      if (!newest) return;
      const data = newest;
      newest = null;
      pass(data);
    };
    flushers.add(flush);

    const wrapper = function (data) {
      if (stopped) return original.apply(this, arguments);
      if (data?.event === PATCH_EVENT) {
        for (const run of flushers) run();                       // the snapshots held are older than this patch: they go first
        return original.apply(this, arguments);
      }
      if (data?.event !== SNAPSHOT_EVENT) return original.apply(this, arguments);

      const now = performance.now();
      const changed = shape(data.payload) !== lastShape;         // not only the counters
      if (changed || (!timer && now - lastAt >= SNAPSHOT_GAP_MS)) {
        newest = null;                                            // this one is newer than whatever was held
        clearTimeout(timer);
        timer = 0;
        return pass(data);
      }
      stats.held += 1;
      newest = data;
      if (!timer) timer = setTimeout(flush, Math.max(0, SNAPSHOT_GAP_MS - (now - lastAt)));
      return undefined;
    };
    wrapper.original = original;
    wrapper.flush = flush;
    return wrapper;
  }

  const set = Map.prototype.set;
  for (const [id, fn] of [...listeners]) {
    if (typeof fn === 'function' && !fn.original) set.call(listeners, id, wrap(fn));
  }
  listeners.set = function (id, fn) {                             // a listener added later is wrapped too
    return set.call(this, id, typeof fn === 'function' && !fn.original ? wrap(fn) : fn);
  };

  return {
    stats,
    // Off and on again without taking the listeners apart (what is held is passed on when it goes off).
    pause(off) {
      stopped = !!off;
      if (stopped) for (const run of flushers) run();
    },
    stop() {
      stopped = true;
      delete listeners.set;                                       // the Map's own method again
      for (const run of flushers) run();                          // whatever was held is passed on
      for (const [id, fn] of [...listeners]) if (fn?.original) set.call(listeners, id, fn.original);
      flushers.clear();
    },
  };
})();
// </snapshots>
kit.snapshots = snapshots;
mod.onDispose(() => snapshots.stop());

// Disposers run in reverse order, so this one runs last: by then our page is gone, and
// all that is left to undo is the app's own blocks we hid while it was open.
mod.onDispose(hideModView);
mod.onDispose(() => observer.disconnect());
mod.onDispose(() => classWatcher.disconnect());
mod.onDispose(() => { for (const [btn, handler] of boundTabs) btn.removeEventListener('click', handler); boundTabs.clear(); });
mod.onDispose(() => clearInterval(retry));
mod.onDispose(() => { kit.onChange = null; kit.onLive = null; });
mod.onDispose(closeDialog);
mod.onDispose(() => { clearTimeout(toastTimer); document.getElementById(TOAST_ID)?.remove(); });
mod.onDispose(() => { kit.onLog = null; clearTimeout(logTimer); });
mod.onDispose(() => document.getElementById(TAB_ID)?.remove());
mod.onDispose(() => document.getElementById(VIEW_ID)?.remove());
mod.onDispose(() => document.getElementById(STYLE_ID)?.remove());

installStyle();
ensureTab();
