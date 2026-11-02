// Whether this program is where it has to be: in the app's own folder, the one WuwaTappo.exe is in.
//
// The program takes that folder to be the one it runs from (paths.js), and the mods, the data and the loader's files
// are made there. Put anywhere else (the Downloads folder, or the folder of the app's shortcuts in the Start menu,
// which looks like the app's folder to someone who opened the shortcut's location), it finds no app, and everything
// that follows (the patch, the port, the loader) would be done to a folder that is not the app's. So it is checked
// first, and the person is told where the app is, which is found here: from a shortcut next to the program, from the
// running app, and from the entries Windows keeps of what is installed.

import fs from 'node:fs/promises';
import path from 'node:path';
import { INSTALL_DIR } from './paths.js';
import { PROCESS_NAME, runPS } from './ps.js';

export const APP_FILE = 'WuwaTappo.exe';

const isFile = file => fs.stat(file).then(stat => stat.isFile(), () => false);

// What the folders named in `found` are called, in the order they are believed: a shortcut that is right there beside
// the program says where it points; the running app says where it is; and what is installed says where it was put.
const SOURCES = ['shortcut', 'process', 'registry'];

// Where the app may be, as [{ how, dir }]: asked of Windows in one go. A failure to ask is not an answer: it is none.
export async function findAppFolders({ near, run = runPS } = {}) {
  const script = `
$dir = ${psQuote(near)}
$found = @()
$shell = $null
Get-ChildItem -LiteralPath $dir -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not $shell) { $shell = New-Object -ComObject WScript.Shell }
  $target = $shell.CreateShortcut($_.FullName).TargetPath
  if ($target -and (Split-Path $target -Leaf) -ieq ${psQuote(APP_FILE)}) { $found += @{ how = 'shortcut'; dir = (Split-Path $target -Parent) } }
}
Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | ForEach-Object {
  $path = $null
  try { $path = $_.Path } catch {}
  if ($path) { $found += @{ how = 'process'; dir = (Split-Path $path -Parent) } }
}
foreach ($root in 'HKCU:', 'HKLM:') {
  foreach ($sub in 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall') {
    Get-ChildItem "$root\\$sub" -ErrorAction SilentlyContinue | ForEach-Object {
      $location = (Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).InstallLocation
      # the app's own installer writes it in quotes ("E:\\Programs\\WuwaTappo"), which is not part of the folder's name
      if ($location) { $location = $location.Trim().Trim('"').TrimEnd('\\') }
      if ($location -and (Test-Path -LiteralPath (Join-Path $location ${psQuote(APP_FILE)}))) { $found += @{ how = 'registry'; dir = $location } }
    }
  }
}
ConvertTo-Json -InputObject @($found) -Compress`;
  try {
    const text = (await run(script, { timeout: 30_000 })).trim();
    const list = text ? JSON.parse(text) : [];
    return (Array.isArray(list) ? list : [list]).filter(entry => typeof entry?.dir === 'string' && entry.dir);
  } catch {
    return [];
  }
}

const psQuote = text => `'${String(text).replace(/'/g, "''")}'`;

// In a folder of the Start menu: where the app's shortcuts are (and where opening a shortcut's location can lead).
export const inStartMenu = dir => /[\\/]start menu[\\/]/i.test(`${dir}${path.sep}`) || /[\\/]开始菜单[\\/]/.test(`${dir}${path.sep}`);

// { ok: true, dir } when WuwaTappo.exe is beside the program. Otherwise { ok: false, dir, startMenu, found }: `found` is
// the folders where the app is, best belief first, each only if WuwaTappo.exe really is in it.
export async function checkPlacement({ dir = INSTALL_DIR, find = findAppFolders, exists = isFile } = {}) {
  if (await exists(path.join(dir, APP_FILE))) return { ok: true, dir };

  const candidates = (await find({ near: dir }).catch(() => []))
    .sort((a, b) => SOURCES.indexOf(a.how) - SOURCES.indexOf(b.how));
  const found = [];
  for (const { how, dir: candidate } of candidates) {
    const resolved = path.resolve(candidate);
    if (found.some(entry => entry.dir.toLowerCase() === resolved.toLowerCase())) continue;
    if (await exists(path.join(resolved, APP_FILE))) found.push({ how, dir: resolved });
  }
  return { ok: false, dir, startMenu: inStartMenu(dir), found };
}

// What to say, for the command line (English: the window says it in Chinese from the same facts).
export function placementMessage(placement) {
  if (placement.ok) return `${APP_FILE} is in ${placement.dir}`;
  const where = placement.found[0]?.dir;
  return [
    `${APP_FILE} is not in ${placement.dir}${placement.startMenu ? ' (that is where the app\'s shortcuts are, not the app)' : ''}.`,
    where
      ? `This program has to be in the app's own folder, beside ${APP_FILE}: put it in ${where}, and run it from there.`
      : `This program has to be in the app's own folder, beside ${APP_FILE}: put it there and run it from there (set WUWA_INSTALL_DIR if it cannot be).`,
  ].join('\n');
}
