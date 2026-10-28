// Run a one-off PowerShell snippet and return stdout.
//
// Used for the few things Node cannot do natively on Windows: UAC elevation,
// stopping a process we may not own, and process enumeration.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runPS(script, { timeout = 120_000 } = {}) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout },
  );
  return stdout;
}