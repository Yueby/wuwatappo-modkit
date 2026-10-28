// Where things live. Every directory the tool reads or writes is named here, once.
//
//   project   this repository
//   install   the app being modded (the one place outside the repository we write to)

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- this repository ---------------------------------------------------------

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const MODS_DIR = path.join(PROJECT_ROOT, 'mods');
export const RUNTIME_DIR = path.join(PROJECT_ROOT, 'src', 'runtime');

// Generated, git-ignored. The extracted frontend is a build artefact of whichever app
// version was last unpacked, so it is not worth keeping in version control.
export const WORK_DIR = path.join(PROJECT_ROOT, 'work');
export const ASSETS_DIR = path.join(WORK_DIR, 'assets');
export const LOG_FILE = path.join(WORK_DIR, 'logs', 'modkit.log');

// A mod's Node part gets a folder of its own to keep files in, one per mod.
export const MOD_DATA_DIR = path.join(WORK_DIR, 'mod-data');

// --- the installed app ---------------------------------------------------------

export const INSTALL_DIR = 'E:\\Programs\\WuwaTappo';
export const APP_EXE = path.join(INSTALL_DIR, 'WuwaTappo.exe');
export const APP_EXE_BACKUP = path.join(INSTALL_DIR, 'WuwaTappo.exe.orig');
export const PATCH_MARKER = path.join(INSTALL_DIR, '.wuwa-modkit.json');
