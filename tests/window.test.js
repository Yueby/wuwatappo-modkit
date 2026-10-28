// The window the exe opens (src/window.ps1): its buttons run the program and show what it printed.
// A real form is created, driven by code instead of a mouse, against a stand-in for the program, so
// nothing of the app is touched. Needs a Windows desktop session; the form is on screen for a moment.
//
//   node --test tests/window.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { windowScript } from '../src/lib/bundle.js';
import { write } from './app-helpers.js';

const exec = promisify(execFile);
const skip = process.platform !== 'win32' && 'the window is for Windows';

let dir;
let script;

// What the program would print for each command: its own arguments, so a test can see what a button asked.
const FAKE = `
const args = process.argv.slice(2);
if (process.env.FAKE_FAIL && args[0] === 'setup' && args[1] !== 'status') { console.error('boom: ' + args.join(' ')); process.exit(1); }
if (args[0] === 'setup' && args[1] !== 'status') { setTimeout(() => { console.log('FAKE ran: ' + args.join(' ') + ' 中文'); }, 800); }
else console.log('FAKE ran: ' + args.join(' '));
`;

before(async () => {
  // A folder with a space in its name: the script path is quoted, or it would not be found.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit window test '));
  await write(path.join(dir, 'fake cli.js'), FAKE);
  script = await windowScript();
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// The window's script, without the two lines that open it and wait, and with a driver that does what
// `steps` says, then writes down what the box and the buttons showed.
async function drive(steps, env = {}) {
  const body = script
    .replace(/^\$form\.Add_Shown.*$/m, '')
    .replace(/^\[void\]\$form\.ShowDialog\(\)\s*$/m, '');
  assert.notEqual(body, script, 'the lines that open the window were found and taken out');

  const driver = `
$form.Show()
$report = [ordered]@{}
function Wait-Idle {
  $deadline = (Get-Date).AddSeconds(20)
  do { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
  while (($script:process -or $script:then) -and (Get-Date) -lt $deadline)
  for ($i = 0; $i -lt 5; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
}
${steps}
$report | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 -Path $env:MODKIT_TEST_OUT
$form.Close()
`;
  const file = path.join(dir, 'drive.ps1');
  const out = path.join(dir, 'out.json');
  await fs.writeFile(file, '\uFEFF' + body + driver);
  await fs.rm(out, { force: true });
  await exec('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', file,
    '-Exe', process.execPath, '-Script', path.join(dir, 'fake cli.js'),
  ], { env: { ...process.env, MODKIT_TEST_OUT: out, ...env }, windowsHide: true, timeout: 60_000 });
  return JSON.parse((await fs.readFile(out, 'utf8')).replace(/^\uFEFF/, ''));
}

const lines = text => text.split(/\r?\n/).filter(Boolean);

test('the status is read when the window opens, by running the program with `setup status`', { skip }, async () => {
  const report = await drive(`Show-Status; Wait-Idle; $report.box = $box.Text; $report.enabled = $install.Enabled`);
  assert.deepEqual(lines(report.box), ['FAKE ran: setup status']);
  assert.equal(report.enabled, true);
});

test('安装 runs setup, keeps the buttons off while it runs, and shows what it said above the fresh status', { skip }, async () => {
  const report = await drive(`
    $install.PerformClick()
    $report.disabledWhileRunning = (-not $install.Enabled) -and (-not $uninstall.Enabled)
    $report.titleWhileRunning = $box.Text
    Wait-Idle
    $report.box = $box.Text
    $report.enabled = $install.Enabled`);
  assert.equal(report.disabledWhileRunning, true);
  assert.match(report.titleWhileRunning, /正在安装/);
  assert.deepEqual(lines(report.box), ['FAKE ran: setup 中文', '---', 'FAKE ran: setup status'], 'Chinese survives the pipe, and the status follows');
  assert.equal(report.enabled, true);
});

test('a command that fails keeps its message on screen: the status below it does not wipe it', { skip }, async () => {
  const report = await drive(`$install.PerformClick(); Wait-Idle; $report.box = $box.Text`, { FAKE_FAIL: '1' });
  assert.deepEqual(lines(report.box), ['boom: setup', '---', 'FAKE ran: setup status']);
});

test('卸载 runs uninstall, and with the box ticked also restores the original exe', { skip }, async () => {
  const report = await drive(`
    $uninstall.PerformClick(); Wait-Idle; $report.plain = $box.Text
    $restore.Checked = $true
    $uninstall.PerformClick(); Wait-Idle; $report.restoring = $box.Text`);
  assert.deepEqual(lines(report.plain), ['FAKE ran: uninstall', '---', 'FAKE ran: setup status']);
  assert.deepEqual(lines(report.restoring), ['FAKE ran: uninstall --restore-exe', '---', 'FAKE ran: setup status']);
});

test('刷新 reads the status again and drops what was said before', { skip }, async () => {
  const report = await drive(`$install.PerformClick(); Wait-Idle; $refresh.PerformClick(); Wait-Idle; $report.box = $box.Text`, { FAKE_FAIL: '1' });
  assert.deepEqual(lines(report.box), ['FAKE ran: setup status']);
});

test('a program that cannot be started is said in the window, and the buttons come back', { skip }, async () => {
  const report = await drive(`$script:Exe = 'C:\\nowhere\\none.exe'; $Exe = 'C:\\nowhere\\none.exe'; Show-Status; $report.box = $box.Text; $report.enabled = $install.Enabled`);
  assert.match(report.box, /无法运行/);
  assert.equal(report.enabled, true);
});
