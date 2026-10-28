// package.json: what a mod says about itself, checked before anything is injected.
//
// A mod's manifest is an ordinary package.json, the way a VS Code extension's is. The standard
// fields mean what they always do (name, version, description), and what is specific to this
// loader sits under one key of its own, "modkit", so nothing collides with npm's vocabulary:
//
//   {
//     "name": "auto-click",            the id; must equal the folder name
//     "displayName": "自动点击",         what the MOD page shows (defaults to the name)
//     "version": "0.4.0",
//     "description": "...",
//     "private": true,
//     "modkit": {
//       "defaultEnabled": true,
//       "windows": { "main": "main.js" },
//       "settings": [ ... ]
//     }
//   }
//
// The manifest is data on purpose. The settings page is drawn in the panel window while the
// mod's code runs in another one, so what a mod exposes has to be something that can be read
// without running it. Everything here is validated up front: a typo in a key name should be
// an error on the MOD page, not a row that silently does nothing. Other top-level fields
// (author, license, ...) are left alone; unknown keys inside "modkit" are an error.

export const WINDOWS = ['main', 'panel', 'login', 'update', 'toast', 'about', 'oss-notice'];

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const SETTING_TYPES = ['toggle', 'number', 'value'];
const MODKIT_KEYS = ['defaultEnabled', 'windows', 'settings'];

export class ManifestError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

// Returns { manifest, windows }: `manifest` is what the page gets (no file names), `windows`
// maps a window label (or '*' for all of them) to a path relative to the mod's folder.
// `folder` is the directory name, which is the mod's id.
export function parseManifest(raw, folder) {
  const problems = [];
  const bad = message => problems.push(message);

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError(['package.json must be a JSON object']);
  }

  const id = raw.name ?? folder;
  if (typeof id !== 'string' || !ID.test(id)) bad(`name "${id}" must be letters, digits, ".", "_" or "-"`);
  else if (id !== folder) bad(`name "${id}" must match the folder name "${folder}"`);

  const displayName = raw.displayName ?? id;
  if (typeof displayName !== 'string' || !displayName.trim()) bad('displayName must be a non-empty string');

  for (const field of ['version', 'description']) {
    if (raw[field] != null && typeof raw[field] !== 'string') bad(`${field} must be a string`);
  }

  const kit = raw.modkit ?? {};
  if (typeof kit !== 'object' || Array.isArray(kit) || kit === null) {
    bad('"modkit" must be an object');
    throw new ManifestError(problems);
  }
  for (const key of Object.keys(kit)) {
    if (!MODKIT_KEYS.includes(key)) bad(`modkit.${key}: unknown (it has: ${MODKIT_KEYS.join(', ')})`);
  }
  if (kit.defaultEnabled != null && typeof kit.defaultEnabled !== 'boolean') bad('modkit.defaultEnabled must be true or false');

  const windows = parseWindows(kit.windows, bad);
  const settings = parseSettings(kit.settings, bad);

  if (problems.length) throw new ManifestError(problems);

  return {
    manifest: {
      id,
      name: displayName.trim(),
      version: raw.version ?? null,
      description: raw.description ?? null,
      defaultEnabled: kit.defaultEnabled ?? true,
      settings,
    },
    windows,
  };
}

function parseWindows(raw, bad) {
  if (raw == null) return { '*': 'index.js' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    bad('modkit.windows must map a window name to a file, e.g. { "main": "main.js" }');
    return {};
  }

  const windows = {};
  for (const [windowName, file] of Object.entries(raw)) {
    if (windowName !== '*' && !WINDOWS.includes(windowName)) {
      bad(`modkit.windows: unknown window "${windowName}" (windows: ${WINDOWS.join(', ')}, or "*")`);
    } else if (typeof file !== 'string' || !file.trim() || /^([\\/]|[A-Za-z]:)|(^|[\\/])\.\.([\\/]|$)/.test(file)) {
      bad(`modkit.windows.${windowName}: "${file}" must be a file inside the mod's folder`);
    } else {
      windows[windowName] = file;
    }
  }
  if (!Object.keys(windows).length) bad('modkit.windows is empty');
  return windows;
}

function parseSettings(raw, bad) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    bad('settings must be a list');
    return [];
  }

  const seen = new Set();
  const settings = [];
  raw.forEach((item, index) => {
    const where = `settings[${index}]`;
    if (item === null || typeof item !== 'object') return bad(`${where} must be an object`);

    const { key, type, title } = item;
    if (typeof key !== 'string' || !KEY.test(key)) return bad(`${where}: key "${key}" must be letters, digits and "_", starting with a letter`);
    if (seen.has(key)) return bad(`${where}: key "${key}" is used twice`);
    seen.add(key);

    const at = `settings.${key}`;
    if (!SETTING_TYPES.includes(type)) return bad(`${at}: type must be one of ${SETTING_TYPES.join(', ')}`);
    if (typeof title !== 'string' || !title.trim()) return bad(`${at}: title is required`);
    if (item.description != null && typeof item.description !== 'string') return bad(`${at}: description must be a string`);
    if (item.persist != null && typeof item.persist !== 'boolean') return bad(`${at}: persist must be true or false`);

    const setting = { key, type, title: title.trim(), description: item.description ?? null };

    if (type === 'toggle') {
      if (typeof (item.default ?? false) !== 'boolean') return bad(`${at}: default must be true or false`);
      setting.default = item.default ?? false;
    } else if (type === 'number') {
      const { min = null, max = null, step = null } = item;
      for (const [label, v] of [['min', min], ['max', max], ['step', step]]) {
        if (v !== null && !Number.isFinite(v)) return bad(`${at}: ${label} must be a number`);
      }
      if (!Number.isFinite(item.default)) return bad(`${at}: default must be a number`);
      if ((min !== null && item.default < min) || (max !== null && item.default > max)) {
        return bad(`${at}: default ${item.default} is outside min/max`);
      }
      if (min !== null && max !== null && min > max) return bad(`${at}: min is greater than max`);
      Object.assign(setting, { default: item.default, min, max, step });
    } else {
      // A read-only figure the mod publishes while it runs (mod.live). Never stored.
      if (item.default != null && typeof item.default !== 'string') return bad(`${at}: default must be text`);
      setting.default = item.default ?? null;
      if (item.persist != null) return bad(`${at}: a value row is never stored, so persist does not apply`);
    }

    // Stored across restarts unless the mod says otherwise. A switch that makes the mod act
    // on the account should say persist:false, so it cannot come back on by itself.
    if (type !== 'value') setting.persist = item.persist ?? true;
    settings.push(setting);
  });
  return settings;
}
