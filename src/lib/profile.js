// Cloning the real install's WebView2 profile for the patched copy.
//
// The login lives in a cookie (`infoToken`) inside the WebView2 profile, not in
// localStorage. A fresh profile therefore means "log in again", which is the
// reason a copied exe appears to lose the login.
//
// Sharing one profile between the copy and the real install is not safe: the
// profile is locked while in use, and the app clears its auth cookies on logout,
// which would log out the real install too. So we copy instead — the copy starts
// signed in, and the two never touch each other again.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// WebView2 profile inside a bundle-id folder:
//   %LOCALAPPDATA%\<bundle-id>\EBWebView
export function realProfileDir(bundleId = 'com.kuro.wuwatappo.cn') {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, bundleId, 'EBWebView');
}

// Where the patched copy keeps its own cloned profile.
export function cloneProfileDir() {
  return path.join(process.env.TEMP ?? os.tmpdir(), 'wuwa-modkit-webview2');
}

// Subdirectories that are pure cache. Copying them is slow and they are rebuilt
// on demand, so skipping them keeps the clone to a few megabytes.
const SKIP_DIRS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache',
  'ShaderCache', 'GPUPersistentCache', 'Crashpad', 'component_crx_cache',
  'extensions_crx_cache', 'BrowserMetrics', 'OriginTrials',
]);

// Files WebView2 holds open; copying them produces a corrupt profile.
const SKIP_FILES = new Set(['LOCK', 'lockfile', 'Cookie-journal', 'LOG.old']);

export async function cloneProfile({ from = realProfileDir(), to = cloneProfileDir(), log = () => {} } = {}) {
  let stats;
  try {
    stats = await fs.stat(from);
  } catch {
    return { cloned: false, reason: 'the real install has no WebView2 profile yet — start it once first' };
  }
  if (!stats.isDirectory()) {
    return { cloned: false, reason: `${from} is not a directory` };
  }

  // A stale clone would keep an old (possibly expired) login and confuse the
  // "is my login still there" question, so each start begins from the real one.
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(to, { recursive: true });

  const result = await copyTree(from, to, log);
  await fs.writeFile(
    path.join(to, '.clone-source.json'),
    JSON.stringify({ from, at: new Date().toISOString(), files: result.files }, null, 2),
  );
  return { cloned: true, ...result, to };
}

async function copyTree(from, to, log, depth = 0) {
  let files = 0;
  let skipped = 0;
  let entries;
  try {
    entries = await fs.readdir(from, { withFileTypes: true });
  } catch (err) {
    return { files, skipped, warning: `could not read ${from}: ${err.code}` };
  }

  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) { skipped++; continue; }
      await fs.mkdir(destination, { recursive: true });
      const nested = await copyTree(source, destination, log, depth + 1);
      files += nested.files;
      skipped += nested.skipped;
      continue;
    }

    if (!entry.isFile() || SKIP_FILES.has(entry.name)) { skipped++; continue; }

    // Cookies and Local State are written continuously; if the real app holds
    // them open the copy can fail mid-read. A single locked file must not abort
    // the whole clone.
    try {
      await fs.copyFile(source, destination);
      files++;
    } catch (err) {
      skipped++;
      log(`  skipped ${entry.name}: ${err.code}`);
    }
  }
  return { files, skipped };
}

// Cheap check that a cloned profile looks usable, without parsing WebView2 formats.
export async function describeProfile(dir) {
  const cookies = path.join(dir, 'Default', 'Network', 'Cookies');
  const localState = path.join(dir, 'Local State');
  const [hasCookies, hasState] = await Promise.all([exists(cookies), exists(localState)]);
  return { dir, hasCookies, hasState };
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}