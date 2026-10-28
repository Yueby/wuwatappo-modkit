// mod.json: what a mod says about itself, checked before anything is injected.
//
// The manifest is data on purpose. The settings page is drawn in the panel window while the
// mod's code runs in another one, so what a mod exposes has to be something that can be read
// without running it. Everything here is validated up front: a typo in a key name should be
// an error on the MOD page, not a row that silently does nothing.

export const WINDOWS = ['main', 'panel', 'login', 'update', 'toast', 'about', 'oss-notice'];

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const SETTING_TYPES = ['toggle', 'number', 'value'];

export class ManifestError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

// Returns { manifest, scripts }: `manifest` is what the page gets (no file names), `scripts`
// maps a window label (or '*' for all of them) to a path relative to the mod's folder.
// `folder` is the directory name, which is the mod's id unless the manifest says otherwise.
export function parseManifest(raw, folder) {
  const problems = [];
  const bad = message => problems.push(message);

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError(['mod.json must be a JSON object']);
  }

  const id = raw.id ?? folder;
  if (typeof id !== 'string' || !ID.test(id)) bad(`id "${id}" must be letters, digits, ".", "_" or "-"`);
  else if (id !== folder) bad(`id "${id}" must match the folder name "${folder}"`);

  const name = raw.name ?? id;
  if (typeof name !== 'string' || !name.trim()) bad('name must be a non-empty string');

  for (const field of ['version', 'description']) {
    if (raw[field] != null && typeof raw[field] !== 'string') bad(`${field} must be a string`);
  }
  if (raw.defaultEnabled != null && typeof raw.defaultEnabled !== 'boolean') bad('defaultEnabled must be true or false');

  const scripts = parseScripts(raw.scripts, bad);
  const settings = parseSettings(raw.settings, bad);

  if (problems.length) throw new ManifestError(problems);

  return {
    manifest: {
      id,
      name: name.trim(),
      version: raw.version ?? null,
      description: raw.description ?? null,
      defaultEnabled: raw.defaultEnabled ?? true,
      settings,
    },
    scripts,
  };
}

function parseScripts(raw, bad) {
  if (raw == null) return { '*': 'index.js' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    bad('scripts must map a window name to a file, e.g. { "main": "main.js" }');
    return {};
  }

  const scripts = {};
  for (const [windowName, file] of Object.entries(raw)) {
    if (windowName !== '*' && !WINDOWS.includes(windowName)) {
      bad(`scripts: unknown window "${windowName}" (windows: ${WINDOWS.join(', ')}, or "*")`);
    } else if (typeof file !== 'string' || !file.trim() || /^([\\/]|[A-Za-z]:)|(^|[\\/])\.\.([\\/]|$)/.test(file)) {
      bad(`scripts.${windowName}: "${file}" must be a file inside the mod's folder`);
    } else {
      scripts[windowName] = file;
    }
  }
  if (!Object.keys(scripts).length) bad('scripts is empty');
  return scripts;
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
