// PowerShell, for the few things Node cannot do on Windows by itself: ask whether the app
// is running, stop a process we may not own, and run something with administrator rights.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROCESS_NAME = 'WuwaTappo';

// Run a one-off snippet and return its stdout.
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

// --- administrator -------------------------------------------------------------

const UAC_TIMEOUT_MS = 90_000;
const UAC_HINT =
  'no answer to the UAC prompt within 90s.\n' +
  '  Look for a consent dialog on the desktop and answer it, then retry.\n' +
  '  If a previous attempt left one open, dismiss it first — Windows only shows one\n' +
  '  elevation prompt at a time and queues the rest.';

// Run PowerShell `commands` (an array of lines) with administrator rights, through UAC.
// Resolves when they have finished; rejects if the prompt was declined or a command threw.
//
// The commands go into a script that is elevated as a whole (-Verb RunAs on the script, not
// on the work it does). An elevated process gets a console of its own, so its output never
// reaches us; instead the script writes a small result file that we wait for. Both files are
// removed afterwards, whatever happened.
//
// This starts nothing but what `commands` say. (An earlier version also took an exe to
// launch; `stop` passed the node binary as a placeholder and each call left an elevated,
// empty node REPL on the desktop.)
export async function runElevated(commands) {
  const stamp = `${process.pid}-${Date.now()}`;
  const script = path.join(os.tmpdir(), `wuwatappo-modkit-${stamp}.ps1`);
  const result = path.join(os.tmpdir(), `wuwatappo-modkit-${stamp}.result`);

  const body = [
    'try {',
    '$ErrorActionPreference = "Stop"',
    ...commands,
    `Set-Content -LiteralPath ${psQuote(result)} -Value "done"`,
    '} catch {',
    `Set-Content -LiteralPath ${psQuote(result)} -Value ("error=" + $_.Exception.Message)`,
    '}',
  ].join('\r\n');
  await fs.writeFile(script, body, 'utf8');

  try {
    await requestElevation(script);
    const outcome = await waitForFile(result, UAC_TIMEOUT_MS);
    if (outcome === null) throw new Error(UAC_HINT);
    if (outcome.startsWith('error=')) throw new Error(`the elevated commands failed: ${outcome.slice(6)}`);
  } finally {
    await Promise.all([fs.rm(script, { force: true }), fs.rm(result, { force: true })]);
  }
}

// Start `powershell -File script` elevated and wait until Windows has either launched it or
// refused. Does not wait for the script itself to finish.
function requestElevation(script) {
  const launcher =
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden ` +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(script)})`;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => reject(new Error(`could not start powershell: ${err.message}`)));
    child.on('exit', code => {
      if (code === 0) return resolve();
      const declined = /取消|cancel|拒绝|denied/i.test(stderr);
      reject(new Error(declined ? 'UAC prompt was declined' : `elevation failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = (await fs.readFile(file, 'utf8')).trim();
      if (text) return text;
    } catch {
      // not written yet
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// PowerShell single-quoted literal: '' escapes a quote, nothing else is special.
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
