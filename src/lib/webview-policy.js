// Making the app open its DevTools port by itself, every time it starts, however it is started.
//
// WebView2 reads extra browser arguments from the registry as well as from an environment variable
// (the docs: CreateCoreWebView2EnvironmentWithOptions). The registry is the one that suits this:
//
//   HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments
//       "WuwaTappo.exe" = "--remote-debugging-port=9222"
//
//   * the value name is the program, so only this app is affected. A value named "*" would open the
//     port for every WebView2 program on the machine, which is not done here;
//   * the arguments are appended to the app's own, not substituted for them, so its profile and login
//     stay as they are;
//   * an environment variable is not honoured by a process running elevated, the registry is; so the
//     port is there whether the app runs as itself or (unpatched) as administrator;
//   * the key is the current user's (HKCU), but Software\Policies is a protected place: it belongs to
//     SYSTEM, and an ordinary process may read it and not write it (measured: "access denied"). So
//     writing the value, and taking it away, asks for administrator rights through UAC, once each.
//     Reading never does, and nothing else in this tool needs it.
//
// This is the whole "injection" as far as the app goes: from then on it listens, and the loader
// (start / watch) attaches to it whenever it is up.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runElevated } from './ps.js';

const exec = promisify(execFile);

export const POLICY_KEY = 'HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
export const APP_NAME = 'WuwaTappo.exe';
const flag = port => `--remote-debugging-port=${port}`;

const reg = args => exec('reg', args, { windowsHide: true });

// `reg query` says a value or key is missing with exit code 1; anything else is a real failure.
const isMissing = err => err.code === 1;

// A change that is done as the user if the place allows it, and through UAC if it does not (reg.exe
// reports both "denied" and "invalid" as exit code 1, in the system's language, so the second try is
// what tells them apart: it fails too, with a message, if the cause was something else).
async function change(regArgs, elevatedLines) {
  try {
    await reg(regArgs);
  } catch (err) {
    if (err.code !== 1) throw err;
    await runElevated(elevatedLines);
  }
}

const ps = text => `'${String(text).replace(/'/g, "''")}'`;
const psPath = key => key.replace(/^HKCU\\/, 'HKCU:\\');

export async function setArguments({ port, key = POLICY_KEY, name = APP_NAME }) {
  await change(['add', key, '/v', name, '/t', 'REG_SZ', '/d', flag(port), '/f'], [
    `New-Item -Path ${ps(psPath(key))} -Force | Out-Null`,
    `New-ItemProperty -Path ${ps(psPath(key))} -Name ${ps(name)} -Value ${ps(flag(port))} -PropertyType String -Force | Out-Null`,
  ]);
}

// The arguments currently set for the app, or null.
export async function readArguments({ key = POLICY_KEY, name = APP_NAME } = {}) {
  try {
    const { stdout } = await reg(['query', key, '/v', name]);
    const line = stdout.split(/\r?\n/).find(l => l.trim().startsWith(name));
    return line?.trim().replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_SZ\\s+`), '') ?? null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// Remove the app's value, and the key too if that leaves it empty (it is Edge's policy key: what
// is not ours is left alone). Returns whether there was a value to remove.
export async function removeArguments({ key = POLICY_KEY, name = APP_NAME } = {}) {
  if ((await readArguments({ key, name })) === null) return false;
  await change(['delete', key, '/v', name, '/f'], [
    `Remove-ItemProperty -Path ${ps(psPath(key))} -Name ${ps(name)}`,
    `if (-not (Get-Item -Path ${ps(psPath(key))}).Property) { Remove-Item -Path ${ps(psPath(key))} }`,
  ]);
  try {
    const { stdout } = await reg(['query', key]);
    if (!stdout.split(/\r?\n/).some(line => /\sREG_\w+\s/.test(line))) {
      await change(['delete', key, '/f'], [`Remove-Item -Path ${ps(psPath(key))}`]);
    }
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  return true;
}

// The port in the arguments, if they are the ones this tool writes.
export const portOf = args => Number(/--remote-debugging-port=(\d+)/.exec(args ?? '')?.[1]) || null;
