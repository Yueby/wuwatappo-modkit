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
import { APP_EXE, APP_EXE_BACKUP, LEGACY_PATCH_MARKER, PATCH_MARKER } from './paths.js';

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
export async function isPatched(file = APP_EXE) {
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    return false;
  }
  return EDITS.every(edit => data.includes(edit.to) && !data.includes(edit.from));
}

// Applies the edits to `file` in place.
export async function patchInPlace(file = APP_EXE) {
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
  // half-patched executable in the install directory. If the rename fails the
  // staging file is removed, otherwise a 77 MB orphan is left next to the exe.
  const staging = `${file}.modkit-tmp`;
  try {
    await fs.writeFile(staging, patched);
    await fs.rename(staging, file);
  } catch (err) {
    await fs.rm(staging, { force: true });
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      throw new Error(
        `cannot overwrite ${path.basename(file)}: it is in use or locked (${err.code}).\n` +
        `  Close the app first:  node src/cli.js stop`,
      );
    }
    throw err;
  }

  return { file, applied, changed: true, bytes: patched.length };
}

// Back up the pristine exe once, then patch. Safe to call repeatedly.
//
// `force` re-applies the patch even when the exe already looks patched, by going
// back to the stock backup first. That is what `lab --rebuild` means: recover from
// a patch that was applied by an older version of this tool.
export async function ensurePatched({ file = APP_EXE, force = false, log = () => {} } = {}) {
  if (!(await exists(file))) {
    throw new Error(`installed executable not found at ${file}`);
  }

  const alreadyPatched = await isPatched(file);

  if (alreadyPatched && !force) {
    await recordMarker(file);
    return { patched: true, changed: false };
  }

  if (alreadyPatched && force) {
    // The stock bytes live in the backup; start from those so the result does not
    // depend on whatever state the installed file is in.
    if (!(await exists(APP_EXE_BACKUP))) {
      throw new Error(`cannot rebuild: no backup at ${APP_EXE_BACKUP} to start from`);
    }
    await fs.copyFile(APP_EXE_BACKUP, file).catch(err => {
      if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        throw new Error(`cannot overwrite ${path.basename(file)}: it is in use. Close the app first:  node src/cli.js stop`);
      }
      throw err;
    });
    log('  reset to stock from backup');
  } else {
    // Keep a pristine copy for restoration and for re-patching after an update.
    // If a backup already exists but differs, the exe has been updated since it
    // was made, so refresh it — it must always be the current stock binary.
    const currentHash = await fileHash(file);
    const backupHash = (await exists(APP_EXE_BACKUP)) ? await fileHash(APP_EXE_BACKUP) : null;

    if (backupHash !== currentHash) {
      await fs.copyFile(file, APP_EXE_BACKUP);
      log(`  backed up original -> ${APP_EXE_BACKUP}`);
    }
  }

  const result = await patchInPlace(file);
  for (const edit of result.applied) {
    if (edit.already) log(`  ${edit.label} (already applied)`);
    else log(`  patched ${edit.label}`);
  }

  await recordMarker(file);
  return { patched: true, changed: result.changed };
}

async function recordMarker(file) {
  const hash = await fileHash(file);
  await fs.writeFile(PATCH_MARKER, JSON.stringify({
    patchedAt: new Date().toISOString(),
    sha256: hash,
    backup: APP_EXE_BACKUP,
  }, null, 2));
  await fs.rm(LEGACY_PATCH_MARKER, { force: true });
}

// Reads the marker written by the last patch (under its old name if it was written before the rename).
export async function readMarker({ file = PATCH_MARKER, legacy = LEGACY_PATCH_MARKER } = {}) {
  for (const candidate of [file, legacy]) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf8'));
    } catch { /* not there, or not readable: try the other */ }
  }
  return null;
}

// Restore the stock exe from the backup.
export async function restoreOriginal({ file = APP_EXE } = {}) {
  if (!(await exists(APP_EXE_BACKUP))) {
    throw new Error(`no backup at ${APP_EXE_BACKUP} — nothing to restore from`);
  }
  try {
    await fs.copyFile(APP_EXE_BACKUP, file);
  } catch (err) {
    if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
      throw new Error(`cannot overwrite ${path.basename(file)}: it is in use. Close the app first:  node src/cli.js stop`);
    }
    throw err;
  }
  return { file, restoredFrom: APP_EXE_BACKUP };
}