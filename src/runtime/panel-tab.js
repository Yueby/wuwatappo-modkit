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
// A button at the right end of a title row, the way the room page puts its 离开房间: the app's
// own button (common-btn) with the class that places it (leave-room-btn is only "absolute, right
// 0, bottom 0" inside .room-info). The empty space beside a title is used, not a row of the list.
// `beside`: how far from the right edge, in px, when another button already has the corner.
function headerButton(label, onClick, beside = 0) {
  const button = el('button', 'common-btn leave-room-btn', label);
  button.type = 'button';
  if (beside) button.style.right = `${beside}px`;
  button.addEventListener('click', onClick);
  return button;
}

function renderHeader(body, mods) {
  const failed = mods.filter(([id]) => kit.stateOf(id).status === 'error').length;
  const head = el('div', 'room-info');
  head.appendChild(el('div', 'room-qty', `MOD（${mods.length}）`));
  head.appendChild(el('div', 'room-number',
    !mods.length ? '还没有 mod，点“安装”获取'
      : failed ? `${failed} 个出错`
        : '全部正常'));
  head.appendChild(headerButton('日志', openLog));
  head.appendChild(headerButton('安装', openPlugins, INSTALL_BUTTON_RIGHT));
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
    description: state.status === 'error' ? `出错：${state.error}`
      : state.status === 'waiting' ? state.error
        : manifest.description,
    control: controlsOfRow,
  }));
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
  if (event.key === 'Escape' && !cancelPrompt()) closeDialog();
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
const openPlugins = () => {
  openDialog({ kind: 'plugins', phase: 'loading', plugins: [], problems: [], op: null });
  loadPlugins();
};

function closeDialog() {
  // An install waiting for its yes is a no, not something left hanging in the loader.
  if (dialog?.kind === 'plugins' && dialog.op?.type === 'confirm') kit.manageAnswer(dialog.requestId, false);
  dialog = null;
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(POPUP_ID)?.remove();
  document.removeEventListener('keydown', onDialogKey);
}

function renderPopup() {
  if (dialog?.kind === 'log') renderLogDialog();
  else if (dialog?.kind === 'settings') renderSettingsDialog();
  else if (dialog?.kind === 'plugins') renderPluginsDialog();
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
// The dialog is the same layer and card as the settings dialog, and it is the list of plugins and stays that.
// What happens to a plugin is not another page of it: a question, a wait, a failure is a prompt laid over the
// list (the app's own confirm dialog, .role-switch-emote-overlay), and "installed" / "removed" is a bubble
// (the app's own toast, .toast-wrapper) that goes by itself. So the list never jumps.

const infoRow = (title, text, description) => row({ title, description, control: controls.value(text) });

// --- the prompt over the list --------------------------------------------------------------------------
//
// dialog.op is what is being asked or waited for, or null:
//   { type: 'busy', text }                          waiting for the loader; nothing to press
//   { type: 'confirm', info }                       an install or an update, with what the package declares
//   { type: 'confirm-remove', plugin, purge }       a removal
//   { type: 'error', message }                      it did not work; 好 closes it

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

// What each kind of prompt says and has to press.
function promptFor(op) {
  if (op.type === 'busy') return { lines: [op.text], buttons: [] };

  if (op.type === 'error') {
    return { lines: ['没有成功', op.message], buttons: [{ label: '好', kind: 'confirm', onClick: () => setOp(dialog, null) }] };
  }

  if (op.type === 'confirm-remove') {
    return {
      lines: [`卸载「${op.plugin.name}」？`, '删掉它的文件夹。它在软件里存的设置还在，装回来还能用。'],
      checkbox: { label: '同时删除它在 moddata 里的数据', checked: op.purge, onChange: on => { op.purge = on; } },
      buttons: [
        { label: '取消', kind: 'cancel', onClick: () => setOp(dialog, null) },
        { label: '卸载', kind: 'confirm', onClick: () => pluginRequest('remove', op.plugin, { purge: op.purge }) },
      ],
    };
  }

  const info = op.info;
  const update = Boolean(info.before);
  const lines = [update ? `把「${info.name ?? info.id}」从 ${info.before} 更新到 ${info.version}？` : `安装「${info.name ?? info.id}」${info.version ?? ''}？`];
  if (info.description) lines.push(info.description);
  lines.push(info.nodePart
    ? 'Node 部分：有。它作为单独的程序运行，用您账号的权限，能读写文件、联网，没有沙盒。'
    : 'Node 部分：没有。');
  lines.push(`它声明要用：${info.permissions.length ? info.permissions.join('、') : '没写'}`);
  const requires = Object.entries(info.requires ?? {}).map(([name, range]) => `${name} ${range}`);
  if (requires.length) lines.push(`需要别的插件：${requires.join('、')}`);
  if (info.dependencies.length) lines.push(`依赖包 ${info.dependencies.length} 个：${info.dependencies.join('、')}（用 npm 取，不运行它们的安装脚本）`);
  if (info.warning) lines.push(`注意：${info.warning}`);
  lines.push('它的网页脚本会在软件的窗口里运行，能做软件自己能做的一切。');
  return {
    lines,
    buttons: [
      { label: '取消', kind: 'cancel', onClick: () => answerPlugin(false) },
      { label: update ? '更新' : '安装', kind: 'confirm', onClick: () => answerPlugin(true) },
    ],
  };
}

// Put the prompt for dialog.op on screen, or take it away. Built again only when what it says changes, so
// that a box the person has ticked is not unticked by a redraw of the list.
function syncOverlay() {
  const op = dialog?.kind === 'plugins' ? dialog.op : null;
  const existing = document.getElementById(OVERLAY_ID);
  if (!op) {
    existing?.remove();
    return;
  }
  const key = JSON.stringify([op.type, op.text, op.message, op.info?.id, op.plugin?.id]);
  if (existing?.dataset.key === key) return;
  existing?.remove();

  const prompt = promptFor(op);
  const layer = el('div', 'role-switch-emote-overlay');
  layer.id = OVERLAY_ID;
  layer.dataset.key = key;
  layer.addEventListener('mousedown', event => event.stopPropagation());   // the panel drags the window on mousedown

  const card = el('div', 'role-switch-emote-overlay__panel');
  const [title, ...rest] = prompt.lines;                                    // the first line says what it is about, apart from the rest
  const message = el('p', 'role-switch-emote-overlay__message', rest.length ? `${title}\n\n${rest.join('\n')}` : title);
  message.style.whiteSpace = 'pre-line';                                    // the lines are lines
  card.appendChild(message);

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

  layer.appendChild(card);
  (document.querySelector('.module-panel') ?? document.body).appendChild(layer);
}

// Set what is being asked, and draw it.
function setOp(state, op) {
  state.op = op;
  if (dialog === state) {
    syncOverlay();
    renderPopup();
  }
}

// Escape: the prompt first, when there is one that can be said no to; the dialog after.
function cancelPrompt() {
  const op = dialog?.kind === 'plugins' ? dialog.op : null;
  if (!op || op.type === 'busy') return false;
  if (op.type === 'confirm') answerPlugin(false);
  else setOp(dialog, null);
  return true;
}

// --- one request to the loader -----------------------------------------------------------------------------

const DONE_TEXT = {
  installed: r => `已安装 ${r.id}${r.version ? ` ${r.version}` : ''}`,
  updated: r => `已更新到 ${r.version ?? '新版本'}`,
  current: r => `已经是最新${r.version ? `（${r.version}）` : ''}`,
  removed: r => `已卸载 ${r.id}${r.purged ? '，它的数据也删了' : ''}`,
};

const WORKING_TEXT = { get: '正在下载并核对', update: '正在下载并核对', remove: '正在卸载' };

// The dialog is the one that was open when the request was made: if it has been closed since, a plugin
// waiting for its yes gets a no, and what comes of the rest is only said in a bubble.
function pluginRequest(action, plugin, args = {}) {
  const mine = dialog;
  mine.cancelled = false;
  setOp(mine, { type: 'busy', text: `${WORKING_TEXT[action]}「${plugin.name}」…` });
  const { id, done } = kit.manage(action, { mod: plugin.id, ...args }, {
    onConfirm: info => {
      if (dialog !== mine) return void kit.manageAnswer(id, false);
      setOp(mine, { type: 'confirm', info });
    },
  });
  mine.requestId = id;
  done.then(result => {
    const said = DONE_TEXT[result.done]?.(result);
    if (said) notify(said);
    if (dialog !== mine) return;
    if (result.mods) {
      mine.plugins = result.mods;
      mine.problems = result.problems ?? [];
    }
    setOp(mine, null);
  }, err => {
    if (dialog !== mine) return notify(err.message);
    if (mine.cancelled) return;
    setOp(mine, { type: 'error', message: err.message });
  });
}

function answerPlugin(ok) {
  const state = dialog;
  kit.manageAnswer(state.requestId, ok);
  if (!ok) {
    state.cancelled = true;
    setOp(state, null);
    return;
  }
  setOp(state, { type: 'busy', text: `正在安装「${state.op.info.name ?? state.op.info.id}」…` });   // until the loader says it is done
}

function loadPlugins() {
  const mine = dialog;
  mine.phase = 'loading';
  renderPopup();
  kit.manage('browse').done.then(result => {
    if (dialog !== mine) return;
    mine.plugins = result.mods;
    mine.problems = result.problems ?? [];
    mine.phase = 'list';
    renderPopup();
  }, err => {
    if (dialog !== mine) return;
    mine.phase = 'error';
    mine.message = err.message;
    renderPopup();
  });
}

// What a plugin's row says about where it stands, and the buttons that go with it.
function pluginRow(plugin) {
  const flags = [plugin.author ? `作者 ${plugin.author}` : null, plugin.nodePart ? '有 Node 部分' : null].filter(Boolean).join(' · ');
  const state = !plugin.installed ? null
    : !plugin.fromRegistry ? '已有（不是从这里装的）'
      : plugin.update ? `已装 ${plugin.installedVersion ?? '?'}，可更新`
        : `已装 ${plugin.installedVersion ?? ''}`.trim();
  const description = [plugin.description, flags, state].filter(Boolean).join(' · ');

  const buttons = [];
  if (!plugin.installed) {
    buttons.push(controls.button({ label: '安装', onClick: () => pluginRequest('get', plugin) }));
  } else if (plugin.fromRegistry) {
    if (plugin.update) buttons.push(controls.button({ label: '更新', onClick: () => pluginRequest('update', plugin) }));
    buttons.push(controls.button({ label: '卸载', onClick: () => setOp(dialog, { type: 'confirm-remove', plugin, purge: false }) }));
  }
  return row({ title: `${plugin.name}  ${plugin.version}`, description, control: buttons });
}

function renderPluginsDialog() {
  const body = document.getElementById(POPUP_BODY_ID);
  if (!body) return;
  const state = dialog;

  redraw(body, next => {
    const head = el('div', 'room-info');
    head.appendChild(el('div', 'room-qty', '插件'));
    head.appendChild(el('div', 'room-number', '来自插件仓库'));
    if (state.phase === 'list') head.appendChild(headerButton('刷新', loadPlugins));
    head.style.marginBottom = '28px';
    next.appendChild(head);

    if (state.phase === 'loading') {
      next.appendChild(infoRow('正在读取插件列表', '…'));
    } else if (state.phase === 'list') {
      if (!state.plugins.length) next.appendChild(infoRow('仓库里还没有插件', ''));
      for (const plugin of state.plugins) next.appendChild(pluginRow(plugin));
      if (state.problems.length) next.appendChild(infoRow('有条目不合格，已跳过', `${state.problems.length} 个`, state.problems.join('；')));
    } else if (state.phase === 'error') {
      next.appendChild(row({
        title: '读不到插件列表',
        description: state.message,
        control: controls.button({ label: '重试', onClick: loadPlugins }),
      }));
    }
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
mod.onDispose(() => { clearTimeout(toastTimer); document.getElementById(TOAST_ID)?.remove(); });
mod.onDispose(() => { kit.onLog = null; clearTimeout(logTimer); });
mod.onDispose(() => document.getElementById(TAB_ID)?.remove());
mod.onDispose(() => document.getElementById(VIEW_ID)?.remove());
mod.onDispose(() => document.getElementById(STYLE_ID)?.remove());

installStyle();
ensureTab();
