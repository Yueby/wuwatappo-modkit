// Launching the app with WebView2 remote debugging enabled.
//
// launchDetached starts the installed binary with the environment that opens the
// DevTools port; the port is the only thing we add, so the app runs normally.
//
// launchElevated exists for process control, not for launching the app: an
// unelevated token cannot stop an instance that is running as administrator
// (Stop-Process reports success and does nothing), so `stop` needs a way to act
// inside an elevated session.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const EOL = '\r\n';

// Start a process without making the caller wait for it.
//
// windowsHide matters here: without it, a GUI app launched with detached:true
// still gets an attached console window, because the child inherits ours. That
// leaves a stray terminal behind after `lab` exits. With it, the app runs with no
// console at all — which is also how it behaves when started from Explorer.
//
// The child also must not keep our event loop alive, hence unref().
export function launchDetached(exe, { cwd, env }) {
  const child = spawn(exe, [], {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  return child;
}

// Launch a privileged executable through UAC.
//
// Write a small .ps1 that sets the environment and starts the app, then elevate
// *that script* with -Verb RunAs. Elevating the script rather than the exe is
// what lets the environment variables reach the app; Start-Process on the exe
// itself does not raise UAC and fails for a requireAdministrator binary.
//
// With an `exe`, the script waits for the app, so the elevated helper lives as long
// as the app. With `exe: null` it only runs `prelude` and finishes — that is what
// `stop` needs. Passing a placeholder exe there is a bug: the script would start
// it, and an unexpected elevated process (e.g. an empty node REPL) appears.
//
// Progress is reported through a small status file rather than stdout: an
// elevated process gets its own console, so its output never reaches our pipe.
export async function launchElevated(exe, { cwd, extraEnv = {}, prelude = [] }) {
  const stamp = `${process.pid}-${Date.now()}`;
  const scriptPath = path.join(os.tmpdir(), `wuwa-modkit-elevate-${stamp}.ps1`);
  const statusPath = path.join(os.tmpdir(), `wuwa-modkit-elevate-${stamp}.status`);
  const statuses = [];

  const lines = [
    '$ErrorActionPreference = "Stop"',
    `$__status = ${psQuote(statusPath)}`,
    'function __report([string]$line) { Add-Content -LiteralPath $__status -Value $line }',
    '__report "stage=prelude"',
    ...prelude,
    ...Object.entries(extraEnv)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => `[Environment]::SetEnvironmentVariable(${psQuote(key)}, ${psQuote(value)})`),
    '__report "stage=env-set"',
    ...(exe
      ? [
        `Set-Location -LiteralPath ${psQuote(cwd)}`,
        `$p = Start-Process -FilePath ${psQuote(exe)} -PassThru`,
        '__report ("app-pid=" + $p.Id)',
        '$p.WaitForExit()',
        '__report "stage=exited"',
      ]
      : ['__report "stage=done"']),
  ];

  // Wrap the body so a thrown error is recorded instead of vanishing.
  const wrapped = [
    'try {',
    ...lines.map(line => '  ' + line),
    '} catch {',
    '  __report ("error=" + $_.Exception.Message)',
    '  exit 1',
    '}',
  ];
  await fs.writeFile(scriptPath, wrapped.join(EOL), 'utf8');

  const launcher = [
    `$p = Start-Process -FilePath 'powershell.exe' -PassThru -Verb RunAs -WindowStyle Hidden`,
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(scriptPath)});`,
    'Write-Output ("helper=" + $p.Id)',
  ].join(' ');

  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let out = '';
  let err = '';
  child.stdout.on('data', chunk => { out += chunk.toString(); });
  child.stderr.on('data', chunk => { err += chunk.toString(); });

  const helperPid = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        'no answer to the UAC prompt within 90s.\n' +
        '  Look for a consent dialog on the desktop and answer it, then retry.\n' +
        '  If a previous attempt left one open, dismiss it first — Windows only\n' +
        '  shows one elevation prompt at a time and queues the rest.',
      ));
    }, 90_000);

    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    const gotPid = () => {
      const match = out.match(/helper=(\d+)/);
      return match ? Number(match[1]) : null;
    };

    child.stdout.on('data', () => {
      const pid = gotPid();
      if (pid) settle(resolve, pid);
    });
    child.on('exit', () => {
      const pid = gotPid();
      if (pid) return settle(resolve, pid);
      // No pid line at all: the elevation never happened.
      const cancelled = /取消|cancel|拒绝|denied/i.test(err + out);
      settle(reject, new Error(cancelled
        ? 'UAC prompt was declined — nothing was launched'
        : `elevation failed${err ? ':\n' + err.trim() : ' (no output)'}`));
    });
    child.on('error', e => settle(reject, new Error(`could not start powershell: ${e.message}`)));
  });

  child.unref();

  // Read back what the elevated side managed to do. Poll briefly: the service
  // writes these lines as it goes, so a failure point is visible even when the
  // app never starts.
  const status = await readStatus(statusPath, { want: exe ? 'app-pid=' : 'stage=done' });
  return { helperPid: helperPid || null, scriptPath, statusPath, status };
}

// Parse the "key=value" status lines the elevated script appends.
async function readStatus(statusPath, { timeoutMs = 20_000, want = 'app-pid=' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(statusPath, 'utf8');
      lines = raw.split(/\r?\n/).filter(Boolean);
      if (lines.some(l => l.startsWith(want)) || lines.some(l => l.startsWith('error='))) break;
    } catch {
      // not written yet
    }
    await new Promise(r => setTimeout(r, 300));
  }

  const parsed = { raw: lines, error: null, appPid: null, stage: null };
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key === 'error') parsed.error = value;
    else if (key === 'app-pid') parsed.appPid = Number(value);
    else if (key === 'stage') parsed.stage = value;
  }
  return parsed;
}

// PowerShell single-quoted literal: '' escapes a quote, nothing else is special.
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Is anything listening on the DevTools port already?
export async function findDebugPortOwner(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return await res.json();
  } catch {
    return null;
  }
}
