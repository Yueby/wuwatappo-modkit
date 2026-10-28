// Patching the installed executable in place.
//
// One problem blocks debugging on the shipped binary: the manifest demands
// administrator, so it cannot be started from a normal shell with environment
// variables set. One length-preserving edit fixes that, so no PE offset, section
// table entry, or signature blob moves:
//
//   requestedExecutionLevel: requireAdministrator -> asInvoker
//
// Only the requested level is changed. The bundle identifier is left alone on
// purpose: rewriting it would move the app's data folders
// (%APPDATA%\com.kuro.wuwatappo.cn, the WebView2 profile) to a new name, which
// would look like "my settings and login are gone". Since this is the only copy
// that runs, the single-instance mutex is not a conflict either.
//
// The original is backed up once, before the first patch. An app update
// overwrites the exe with a fresh stock build; ensurePatched() detects that and
// re-patches (refreshing the backup).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const INSTALL_DIR = 'E:\\Programs\\WuwaTappo';
export const ORIGINAL_EXE = path.join(INSTALL_DIR, 'WuwaTappo.exe');
export const BACKUP_EXE = path.join(INSTALL_DIR, 'WuwaTappo.exe.orig');
const MARKER = path.join(INSTALL_DIR, '.wuwa-modkit.json');

export const BUNDLE_ID = 'com.kuro.wuwatappo.cn';

const EDITS = [
  {
    label: 'manifest: requireAdministrator -> asInvoker',
    from: Buffer.from('<requestedExecutionLevel level="requireAdministrator" uiAccess="false" />', 'utf8'),
    to: Buffer.from('<requestedExecutionLevel level="asInvoker" uiAccess="false" />', 'utf8'),
    exactly: 1,
  },
];

export async function fileHash(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Is the installed exe currently patched?
export async function isPatched(file = ORIGINAL_EXE) {
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    return false;
  }
  return EDITS.every(edit => data.includes(edit.to) && !data.includes(edit.from));
}

// Per-edit status, for diagnostics.
export async function describeEdits(file = ORIGINAL_EXE) {
  const data = await fs.readFile(file);
  return EDITS.map(edit => ({
    label: edit.label,
    replacements: data.includes(edit.to),
    untouched: data.includes(edit.from),
  }));
}

// Applies the edits to `file` in place.
export async function patchInPlace(file = ORIGINAL_EXE) {
  const original = await fs.readFile(file);
  const patched = Buffer.from(original);
  const applied = [];

  for (const edit of EDITS) {
    if (edit.to.length > edit.from.length) {
      throw new Error(`${edit.label}: replacement must not be longer than the original`);
    }
    // Pad with spaces to keep the byte length identical: the manifest is XML, so
    // trailing whitespace inside the element is harmless, and nothing in the PE
    // moves.
    const replacement = Buffer.concat([
      edit.to,
      Buffer.alloc(edit.from.length - edit.to.length, 0x20),
    ]);

    let count = 0;
    let at = patched.indexOf(edit.from);
    while (at !== -1) {
      replacement.copy(patched, at);
      count++;
      at = patched.indexOf(edit.from, at + edit.from.length);
    }

    if (count !== edit.exactly) {
      // Already patched is the normal reason for a miss; anything else is a
      // different build than we expect and must not be written.
      if (count === 0 && patched.includes(edit.to)) {
        applied.push({ label: edit.label, count: 0, already: true });
        continue;
      }
      throw new Error(
        `${edit.label}: expected ${edit.exactly} occurrence(s), found ${count}.\n` +
        `  This exe is not the build this tool knows. Refusing to write.`,
      );
    }
    applied.push({ label: edit.label, count });
  }

  if (patched.length !== original.length) {
    throw new Error('length changed; refusing to write a file with shifted offsets');
  }

  if (Buffer.compare(original, patched) === 0) {
    return { file, applied, changed: false };
  }

  // Write beside the target then rename: an interrupted write must not leave a
  // half-patched executable in the install directory.
  const staging = `${file}.modkit-tmp`;
  await fs.writeFile(staging, patched);
  await fs.rename(staging, file);

  return { file, applied, changed: true, bytes: patched.length };
}

// Back up the pristine exe once, then patch. Safe to call repeatedly.
export async function ensurePatched({ file = ORIGINAL_EXE, log = () => {} } = {}) {
  if (!(await exists(file))) {
    throw new Error(`installed executable not found at ${file}`);
  }

  if (await isPatched(file)) {
    await recordMarker(file);
    return { patched: true, changed: false };
  }

  // Keep a pristine copy for restoration and for re-patching after an update.
  // If a backup already exists the exe has been updated since we made it, so the
  // backup is refreshed — it must always be the current stock binary.
  const currentHash = await fileHash(file);
  const backupHash = (await exists(BACKUP_EXE)) ? await fileHash(BACKUP_EXE) : null;

  if (backupHash !== currentHash) {
    await fs.copyFile(file, BACKUP_EXE);
    log(`  backed up original -> ${BACKUP_EXE}`);
  }

  const result = await patchInPlace(file);
  for (const edit of result.applied) {
    if (edit.already) log(`  ${edit.label} ${'(already applied)'}`);
    else log(`  patched ${edit.label}`);
  }

  await recordMarker(file);
  return { patched: true, changed: result.changed };
}

async function recordMarker(file) {
  const hash = await fileHash(file);
  await fs.writeFile(MARKER, JSON.stringify({
    patchedAt: new Date().toISOString(),
    sha256: hash,
    bundleId: BUNDLE_ID,
    backup: BACKUP_EXE,
  }, null, 2));
}

// Reads the marker written by the last patch.
export async function readMarker() {
  try {
    return JSON.parse(await fs.readFile(MARKER, 'utf8'));
  } catch {
    return null;
  }
}

// Restore the stock exe from the backup.
export async function restoreOriginal({ file = ORIGINAL_EXE } = {}) {
  if (!(await exists(BACKUP_EXE))) {
    throw new Error(`no backup at ${BACKUP_EXE} — nothing to restore from`);
  }
  await fs.copyFile(BACKUP_EXE, file);
  return { file, restoredFrom: BACKUP_EXE };
}