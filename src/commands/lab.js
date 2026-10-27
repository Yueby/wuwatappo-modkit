// node src/cli.js lab — build and launch the test copy.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { buildLabCopy, ORIGINAL_EXE, describeEdits } from '../lib/patch.js';
import { PROJECT_ROOT } from '../lib/mods.js';
import { browserVersion } from '../lib/targets.js';
import { parseOptions } from './options.js';
import { field, log, section, style } from '../lib/output.js';

export const LAB_DIR = path.join(PROJECT_ROOT, 'work', 'lab');
const LAB_EXE = path.join(LAB_DIR, 'WuwaTappo.exe');

export default async function lab(argv) {
  const options = parseOptions(argv);
  const rebuild = options.positional.includes('--rebuild') || argv.includes('--rebuild');

  try {
    await fs.access(ORIGINAL_EXE);
  } catch {
    throw new Error(`original executable not found at ${ORIGINAL_EXE}\n` +
      `Pass a different source with --source, or fix ORIGINAL_EXE in src/lib/patch.js`);
  }

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
    if (edit.untouched) throw new Error(`test copy still fits the original: ${edit.label}`);
  }

  if (!(await isPortFree(options.port))) {
    throw new Error(`port ${options.port} is already in use — another debug instance is running?`);
  }

  section('Starting');
  const child = spawn(LAB_EXE, [], {
    cwd: LAB_DIR,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(os.tmpdir(), 'wuwa-modkit-webview2'),
    },
  });
  child.unref();

  field('pid', child.pid);
  field('devtools', `http://127.0.0.1:${options.port}`);

  const version = await waitForDevTools(options.port, 30_000);
  field('webview2', version.Browser);
  log(`\n${style.green('ready')}  next: ${style.bold('node src/cli.js watch')}`);
  return 0;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function isPortFree(port) {
  try { await browserVersion({ port }); return false; } catch { return true; }
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
  throw new Error(`DevTools endpoint did not come up on port ${port} within ${timeoutMs / 1000}s`);
}