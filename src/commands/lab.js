// node src/cli.js lab [--rebuild] [--restore]
//
// Patches the installed executable in place and starts it with WebView2 remote
// debugging enabled. This is the normal way to run the app now: it stays the
// real installed binary, so the updater keeps working.
//
//   --rebuild   re-apply the patch (needed after an app update overwrote the exe)
//   --restore   put the unpatched original back and exit

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ORIGINAL_EXE, INSTALL_DIR, ensurePatched, isPatched, restoreOriginal, readMarker,
} from '../lib/patch.js';
import { launchDetached, findDebugPortOwner } from '../lib/launch.js';
import { browserVersion } from '../lib/targets.js';
import { countInstances } from '../lib/ps.js';
import { parseOptions } from './options.js';
import { field, log, section, style } from '../lib/output.js';

export default async function lab(argv) {
  const options = parseOptions(argv);
  const restore = argv.includes('--restore');
  const rebuild = argv.includes('--rebuild');

  if (restore) return doRestore();

  if (!(await exists(ORIGINAL_EXE))) {
    throw new Error(`installed executable not found at ${ORIGINAL_EXE}\n` +
      `  Set INSTALL_DIR in src/lib/patch.js if the app lives elsewhere.`);
  }

  if (!(await isPortFree(options.port))) {
    throw new Error(`port ${options.port} is already in use — an earlier instance is still running.\n` +
      `  Stop it with: node src/cli.js stop`);
  }

  // Check this *before* touching the exe. A running app holds WuwaTappo.exe open,
  // so patching it fails midway — and the app may be running without a debug port
  // (started by double-click), which the port check above cannot see.
  if (await isRunning()) {
    log(`${style.yellow('the app is running')} — it has to be closed before the exe can be patched:`);
    log(`  ${style.bold('node src/cli.js stop')}`);
    return 1;
  }

  section(rebuild ? 'Patching (forced)' : 'Patching');
  const patched = await ensurePatched({ force: rebuild, log });
  if (!patched.changed) {
    field('status', style.dim('already patched'));
  }

  section('Starting');

  // Use the app's own profile. We are launching the installed binary itself
  // (just without the admin requirement), so there is no second install to keep
  // apart: the login, settings, and click counters are the real ones, and the
  // updater keeps working normally.
  const child = launchDetached(ORIGINAL_EXE, {
    cwd: INSTALL_DIR,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port}`,
    },
  });

  field('pid', child.pid);
  field('devtools', `http://127.0.0.1:${options.port}`);

  const version = await waitForDevTools(options.port, 30_000);
  field('webview2', version.Browser);
  log(`\n${style.green('ready')}  next: ${style.bold('node src/cli.js watch')}`);
  return 0;
}

async function doRestore() {
  section('Restoring');
  const marker = await readMarker();
  if (await isRunning()) {
    throw new Error('the app is running — stop it first: node src/cli.js stop');
  }
  const result = await restoreOriginal();
  field('restored', result.file);
  field('from', result.restoredFrom);
  if (marker?.patchedAt) field('was patched', marker.patchedAt);
  log(`\n  The app is back to stock (administrator + original bundle id).`);
  log(`  Run ${style.bold('node src/cli.js lab')} to patch it again.`);
  return 0;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function isPortFree(port) {
  return (await findDebugPortOwner(port)) === null;
}

async function isRunning() {
  return (await countInstances()) > 0;
}

async function waitForDevTools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await browserVersion({ port });
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  throw new Error(
    `DevTools endpoint did not come up on port ${port} within ${timeoutMs / 1000}s.\n` +
    `  If Windows showed a UAC prompt, the patch did not take — run ` +
    `${style.bold('node src/cli.js lab --rebuild')} and try again.`,
  );
}