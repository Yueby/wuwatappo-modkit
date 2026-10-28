// Run a one-off PowerShell snippet and return stdout.
//
// Used for the few things Node cannot do natively on Windows: UAC elevation,
// stopping a process we may not own, and process enumeration.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROCESS_NAME = 'WuwaTappo';

export async function runPS(script, { timeout = 120_000 } = {}) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout },
  );
  return stdout;
}

// How many instances of the app are running right now.
//
// A failure to ask is an error, not "zero": callers use this to decide whether it
// is safe to overwrite the exe, and treating "could not check" as "not running"
// would let them write to a file that is in use.
export async function countInstances() {
  const out = await runPS(
    `(Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Measure-Object).Count`,
  );
  const n = Number(out.trim());
  if (!Number.isInteger(n)) {
    throw new Error(`could not tell whether the app is running (PowerShell said: ${out.trim() || 'nothing'})`);
  }
  return n;
}