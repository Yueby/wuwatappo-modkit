// Where things live. Every directory the tool reads or writes is named here, once.
//
//   the app folder    where WuwaTappo.exe is. Everything the user's installation consists of goes here:
//                       WuwaTappo.exe, WuwaTappo.exe.orig   the patched exe and the original
//                       mods\                               the mods that run
//                       moddata\<mod>\                      what each mod's Node part keeps
//                       moddata\.modkit\                    the loader's own: its lock and its log
//   the repository    source, the mods that ship with the program, and what development generates

import path from 'node:path';
import * as sea from 'node:sea';
import { fileURLToPath } from 'node:url';

// --- the app folder ------------------------------------------------------------

const DEFAULT_INSTALL_DIR = 'E:\\Programs\\WuwaTappo';

// Which folder that is. WUWA_INSTALL_DIR wins (another machine, a test). A packaged loader is an exe
// that is put in the app folder, so it is the folder it runs from. Run from the repository, it is
// where the app is on this machine.
export function resolveInstallDir({ env = process.env, packaged = sea.isSea(), execPath = process.execPath } = {}) {
  if (env.WUWA_INSTALL_DIR) return path.resolve(env.WUWA_INSTALL_DIR);
  if (packaged) return path.dirname(execPath);
  return DEFAULT_INSTALL_DIR;
}

export const INSTALL_DIR = resolveInstallDir();
export const APP_EXE = path.join(INSTALL_DIR, 'WuwaTappo.exe');
export const APP_EXE_BACKUP = path.join(INSTALL_DIR, 'WuwaTappo.exe.orig');
export const PATCH_MARKER = path.join(INSTALL_DIR, '.wuwa-modkit.json');

// The mods that run, and a folder for each mod's Node part to keep its files in.
export const MODS_DIR = path.join(INSTALL_DIR, 'mods');
export const MOD_DATA_DIR = path.join(INSTALL_DIR, 'moddata');

// The loader's own files. Under moddata so the app folder gets no third folder, and with a name
// that starts with a dot, which no mod can have, so it can never be a mod's.
export const LOADER_DIR = path.join(MOD_DATA_DIR, '.modkit');
export const LOCK_FILE = path.join(LOADER_DIR, 'loader.lock');
export const LOG_FILE = path.join(LOADER_DIR, 'modkit.log');

// --- this repository -----------------------------------------------------------

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const RUNTIME_DIR = path.join(PROJECT_ROOT, 'src', 'runtime');

// The mods that come with the program (and the templates to copy). `setup` puts the ones that are
// not in MODS_DIR yet there; it never overwrites one that is.
export const BUNDLED_MODS_DIR = path.join(PROJECT_ROOT, 'mods');

// Generated, git-ignored. The extracted frontend is a build artefact of whichever app
// version was last unpacked, so it is not worth keeping in version control.
export const WORK_DIR = path.join(PROJECT_ROOT, 'work');
export const ASSETS_DIR = path.join(WORK_DIR, 'assets');

// Where a mod's data used to be, before it moved to the app folder: moved from there by `setup`.
export const LEGACY_MOD_DATA_DIR = path.join(WORK_DIR, 'mod-data');
