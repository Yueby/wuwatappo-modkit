// modkit.exe window — the window with the install and uninstall buttons.
//
// What a double-click on the exe opens. The window itself is a PowerShell script (src/window.ps1:
// Windows has the forms library built in, so nothing is added to the exe for it), which runs this
// same program for each button. This process only writes the script out and starts it, then ends, so
// the console that a double-click opens goes away at once.
//
// Starting it is the awkward part, and what is done here is what was measured to work: a child that
// is not detached dies with this process (Node puts it in a job that ends with it), and a detached
// powershell.exe exits at once without running its script. So a PowerShell that is not detached
// starts the window with Start-Process, and what that starts is not part of the job.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPackaged, windowScript } from '../lib/bundle.js';
import { MODS_DIR } from '../lib/paths.js';
import { removeLeftovers } from '../lib/release.js';
import { VERSION } from '../lib/version.js';

// Windows PowerShell reads a script as ANSI unless it starts with a byte order mark.
const BOM = String.fromCharCode(0xFEFF);

// A string for a single-quoted PowerShell string.
const quoted = text => `'${text.replaceAll("'", "''")}'`;

export default async function openWindow() {
  if (process.platform !== 'win32') throw new Error('the window is for Windows');

  const dir = path.join(os.tmpdir(), 'wuwa-modkit-window');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'window.ps1');
  await fs.writeFile(file, BOM + await windowScript());

  // What an update left beside the program (the old exe, once nothing runs from it).
  if (isPackaged()) await removeLeftovers(process.execPath);

  // Packaged, the buttons run this exe. From the repository they run node on cli.js.
  const params = [`-Exe "${process.execPath}"`, `-ModsDir "${MODS_DIR}"`, `-Version "${VERSION}"`];
  if (!isPackaged()) params.push(`-Script "${fileURLToPath(new URL('../cli.js', import.meta.url))}"`);
  const argumentList = `-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "${file}" ${params.join(' ')}`;

  // -EncodedCommand (UTF-16, base64) so that no quoting between here and PowerShell can go wrong.
  const command = `Start-Process -FilePath powershell.exe -ArgumentList ${quoted(argumentList)}`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');

  const code = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) throw new Error(`could not open the window (powershell exited ${code})`);
  return 0;
}
