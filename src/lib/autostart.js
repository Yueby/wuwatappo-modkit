// Starting the loader when the user logs on.
//
// A script in the user's own Startup folder, not a scheduled task: it needs no administrator, it is
// a file anyone can open and read, and removing it is deleting it. It is a .vbs because that is
// what runs a program with no window (a console that flashes up at every logon, or stays open, is
// what a plain .cmd would give).
//
// The app has an autostart of its own (a logon task that runs it with the highest privileges, made
// while it still ran as administrator). If that one starts the app first, there is no DevTools port
// and the loader cannot attach; `status` says whether it is there.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as sea from 'node:sea';
import { INSTALL_DIR, PROJECT_ROOT } from './paths.js';

const run = promisify(execFile);

export const SCRIPT_NAME = 'wuwa-modkit.vbs';
export const APP_TASK = '\\WuwaTappo\\ElevatedAutostart';

export function startupDir() {
  if (!process.env.APPDATA) throw new Error('APPDATA is not set: cannot find the Startup folder');
  return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

// In a VBScript string a quote is written twice.
const vb = text => String(text).replaceAll('"', '""');

// How to run this program: from the repository it is node and cli.js; packaged, it is the exe itself.
export function launcher() {
  return sea.isSea()
    ? { node: process.execPath, cli: null, cwd: INSTALL_DIR }
    : { node: process.execPath, cli: path.join(PROJECT_ROOT, 'src', 'cli.js'), cwd: PROJECT_ROOT };
}

export function scriptText({ node, cli = null, cwd }) {
  // --no-launch: the loader waits for the app, however it is started; it does not start it.
  const command = [`"${node}"`, cli ? `"${cli}"` : null, 'start --no-launch --log-file'].filter(Boolean).join(' ');
  return [
    `' Starts wuwa-modkit when you log on. Written by: node src/cli.js autostart install`,
    `' Remove it with: node src/cli.js autostart remove   (or just delete this file)`,
    `Set shell = CreateObject("WScript.Shell")`,
    `shell.CurrentDirectory = "${vb(cwd)}"`,
    `shell.Run "${vb(command)}", 0, False`,
    ``,
  ].join('\r\n');
}

const fileIn = dir => path.join(dir, SCRIPT_NAME);

export function install({ dir = startupDir(), node = launcher().node, cli = launcher().cli, cwd = launcher().cwd } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = fileIn(dir);
  fs.writeFileSync(file, scriptText({ node, cli, cwd }));
  return file;
}

export function remove({ dir = startupDir() } = {}) {
  const file = fileIn(dir);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return { file, existed };
}

export function status({ dir = startupDir() } = {}) {
  const file = fileIn(dir);
  if (!fs.existsSync(file)) return { installed: false, file };
  const command = fs.readFileSync(file, 'utf8').match(/shell\.Run "(.*)", 0/)?.[1].replaceAll('""', '"') ?? null;
  return { installed: true, file, command };
}

// Whether the app's own logon task exists. Only asks; changing it takes an administrator.
export async function appHasLogonTask() {
  try {
    await run('schtasks', ['/Query', '/TN', APP_TASK], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
