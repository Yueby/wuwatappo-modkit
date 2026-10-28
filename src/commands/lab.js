// node src/cli.js lab [--elevated] [--rebuild]
//
// Default: build the patched test copy and start it. Independent of any real
// install, own WebView2 profile.
//
// --elevated: start the *real* executable through UAC instead, sharing its
// profile and login. Requires stopping a running instance first, because the app
// is single-instance.

import fs from 'node:fs/promises';
import path from 'node:path';

import { buildLabCopy, ORIGINAL_EXE, describeEdits } from '../lib/patch.js';
import { launchDetached, launchElevated, findDebugPortOwner, defaultWebViewDataDir } from '../lib/launch.js';
import { PROJECT_ROOT } from '../lib/mods.js';
import { browserVersion } from '../lib/targets.js';
import { runPS } from '../lib/ps.js';
import { parseOptions } from './options.js';
import { field, log, section, style } from '../lib/output.js';

const BUNDLE_ID = 'com.kuro.wuwatappo.cn';
const LAB_EXE = path.join(PROJECT_ROOT, 'work', 'lab', 'WuwaTappo.exe');

export default async function lab(argv) {
  const options = parseOptions(argv);
  const elevated = argv.includes('--elevated');
  const rebuild = argv.includes('--rebuild');

  if (!(await exists(ORIGINAL_EXE))) {
    throw new Error(`original executable not found at ${ORIGINAL_EXE}`);
  }

  if (!(await isPortFree(options.port))) {
    throw new Error(`port ${options.port} is already in use — an earlier debug instance is still running`);
  }

  return elevated ? startNative(options) : startPatched(options, rebuild);
}

// --- native mode -----------------------------------------------------------
//
// Kept because it is genuinely useful for inspecting the *real* install (it
// shares that profile, so the login is there), but it cannot enable DevTools:
// the app sets its own WebView2 data directory, and an explicit --user-data-dir
// suppresses WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS. Verified by reading the
// webview child's command line: the flag is absent and the profile is
// ...\EBWebView\EBWebView (the app appends its own subdirectory).
//
// So this mode launches the app for use, not for modding. Use the default
// patched copy for anything the loader needs to attach to.

async function startNative(options) {
  section('Native launch (UAC)');

  const running = await countInstances();
  if (running > 0) {
    field('running', `${running} instance(s) — will be stopped after elevation`);
  }

  const env = {
    // Harmless, and it would work if the app ever stopped pinning its profile.
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port}`,
    WEBVIEW2_USER_DATA_FOLDER: defaultWebViewDataDir(BUNDLE_ID),
  };

  log('  waiting for the UAC prompt…');
  const { helperPid, status, statusPath } = await launchElevated(ORIGINAL_EXE, {
    cwd: path.dirname(ORIGINAL_EXE),
    extraEnv: env,
    // The running instance may be elevated (e.g. started by its autostart task),
    // and an unelevated token cannot terminate it. Do it inside the elevated
    // session we just got consent for.
    prelude: [
      'Stop-Process -Name WuwaTappo -Force -ErrorAction SilentlyContinue',
      'Start-Sleep -Milliseconds 2000',
      '__report "stage=cleared"',
    ],
  });

  if (status.error) {
    field('helper', helperPid ?? '(unknown)');
    throw new Error(`the elevated script failed: ${status.error}\n` +
      `  status file: ${statusPath}\n` +
      `  check the app log under %LOCALAPPDATA%\\com.kuro.wuwatappo.cn\\logs`);
  }

  field('helper', helperPid ?? '(unknown)');
  field('app pid', status.appPid ?? '(not reported)');

  // Give the webview a moment, then say plainly whether it is moddable.
  const attached = await waitForDevTools(options.port, 20_000, { required: false });
  if (!attached) {
    log('');
    log(`  ${style.yellow('launched')} ${style.dim('— but without DevTools, as expected on this app')}`);
    log(`  ${style.dim('the real install pins its own WebView2 profile, which overrides')}`);
    log(`  ${style.dim('the environment variable that enables the debug port')}`);
    log(`\n  For modding use the patched copy: ${style.bold('node src/cli.js lab')}`);
    return 0;
  }

  field('webview2', attached.Browser);
  log(`\n${style.green('ready')}  next: ${style.bold('node src/cli.js watch')}`);
  return 0;
}

async function countInstances() {
  const out = await runPS('(Get-Process WuwaTappo -ErrorAction SilentlyContinue | Measure-Object).Count');
  return Number(out.trim()) || 0;
}

// --- patched-copy mode -----------------------------------------------------

async function startPatched(options, rebuild) {
  if (rebuild || !(await exists(LAB_EXE))) {
    section('Building test copy');
    const result = await buildLabCopy({ destination: LAB_EXE });
    for (const edit of result.applied) log(`  ${style.green('patched')} ${edit.label}`);
    field('output', result.destination);
  } else {
    section('Using existing test copy');
    field('output', LAB_EXE);
  }

  for (const edit of await describeEdits(LAB_EXE)) {
    if (edit.untouched) throw new Error(`test copy still matches the original: ${edit.label}`);
  }

  section('Starting');
  const child = launchDetached(LAB_EXE, {
    cwd: path.dirname(LAB_EXE),
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(process.env.TEMP ?? '.', 'wuwa-modkit-webview2'),
    },
  });

  field('pid', child.pid);
  field('devtools', `http://127.0.0.1:${options.port}`);

  const version = await waitForDevTools(options.port, 30_000);
  field('webview2', version.Browser);
  log(`\n${style.green('ready')}  next: ${style.bold('node src/cli.js watch')}`);
  return 0;
}

// --- helpers ---------------------------------------------------------------

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function isPortFree(port) {
  return (await findDebugPortOwner(port)) === null;
}

// Resolves with the browser version, or null if `required` is false and the port
// never opened. With `required`, throws and lets `onFail` add context.
async function waitForDevTools(port, timeoutMs, { required = true, onFail = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await browserVersion({ port });
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  if (!required) return null;
  const detail = onFail ? await onFail() : null;
  throw new Error(`DevTools endpoint did not come up on port ${port} within ${timeoutMs / 1000}s` +
    (detail ? `\n  ${detail}` : ''));
}