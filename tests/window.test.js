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
let modsDir;

// What the registry lists: one not installed (with a Node part), one installed with a newer version out,
// one installed and current, one installed from somewhere else.
const PLUGINS = [
  { id: 'alpha', name: 'Alpha', version: '1.0.0', description: 'does alpha', author: 'someone', nodePart: true, permissions: ['files', 'network'], requires: { beta: '^1.0.0' }, dependencies: ['left-pad'], installed: false, installedVersion: null, fromRegistry: false, update: false },
  { id: 'beta', name: 'Beta', version: '1.1.0', description: 'does beta', author: null, nodePart: false, permissions: [], requires: {}, dependencies: [], installed: true, installedVersion: '1.0.0', fromRegistry: true, update: true },
  { id: 'gamma', name: 'Gamma', version: '2.0.0', description: 'does gamma', author: null, nodePart: false, permissions: [], requires: {}, dependencies: [], installed: true, installedVersion: '2.0.0', fromRegistry: true, update: false },
  { id: 'delta', name: 'Delta', version: '3.0.0', description: 'does delta', author: null, nodePart: false, permissions: [], requires: {}, dependencies: [], installed: true, installedVersion: '2.5.0', fromRegistry: false, update: false },
];

// What the program would print for each command: its own arguments, so a test can see what a button asked.
const FAKE = `
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.FAKE_CALLS) fs.appendFileSync(process.env.FAKE_CALLS, args.join(' ') + '\\n');
if (args[0] === 'mods' && args[1] === 'browse') {
  if (process.env.FAKE_BROWSE_FAIL) { console.error('registry unreachable'); process.exit(1); }
  console.log(JSON.stringify({ mods: JSON.parse(process.env.FAKE_PLUGINS ?? process.env.FAKE_DEFAULT_PLUGINS), problems: [] }));
  process.exit(0);
}
if (args[0] === 'update' && args.includes('--check')) {
  if (process.env.FAKE_CHECK_ERROR) console.log(JSON.stringify({ current: '1.0.0', error: process.env.FAKE_CHECK_ERROR }));
  else {
    const latest = process.env.FAKE_LATEST ?? '1.0.0';
    console.log(JSON.stringify({ current: '1.0.0', latest: latest === 'none' ? null : latest, newer: latest !== 'none' && latest !== '1.0.0' }));
  }
  process.exit(0);
}
if (args[0] === 'update') {
  console.log('FAKE ran: ' + args.join(' '));
  setTimeout(() => process.exit(Number(process.env.FAKE_UPDATE_CODE ?? 10)), 300);
  return;
}
if (process.env.FAKE_FAIL && args[0] === 'setup' && args[1] !== 'status') { console.error('boom: ' + args.join(' ')); process.exit(1); }
if (args[0] === 'setup' && args[1] !== 'status') { setTimeout(() => { console.log('FAKE ran: ' + args.join(' ') + ' 中文'); }, 800); }
else console.log('FAKE ran: ' + args.join(' '));
`;

before(async () => {
  // A folder with a space in its name: the script path is quoted, or it would not be found.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modkit window test '));
  await write(path.join(dir, 'fake cli.js'), FAKE);
  script = await windowScript();
  modsDir = path.join(dir, 'the app', 'mods');      // not next to the program: the window must be told, not work it out
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
# Not a real Explorer: what it would have been asked to open is written down.
function Start-Process { $script:launched = ($args -join ' ') }
# Not a real dialog: what the person would have been asked is written down, and the answer is the test's.
$script:questions = @()
$script:answer = $true
function Confirm-Action([string]$Text) { $script:questions += $Text; return $script:answer }
function Wait-Idle {
  $deadline = (Get-Date).AddSeconds(20)
  do { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
  while (($script:process -or $script:then -or $script:after) -and (Get-Date) -lt $deadline)
  for ($i = 0; $i -lt 5; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
}
${steps}
$report | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 -Path $env:MODKIT_TEST_OUT
try { $form.Close() } catch { }
`;
  const file = path.join(dir, 'drive.ps1');
  const out = path.join(dir, 'out.json');
  const calls = path.join(dir, 'calls.log');
  await fs.writeFile(file, '\uFEFF' + body + driver);
  await fs.rm(out, { force: true });
  await fs.rm(calls, { force: true });
  await exec('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', file,
    '-Exe', process.execPath, '-Script', path.join(dir, 'fake cli.js'), '-ModsDir', modsDir, '-Version', '1.0.0',
  ], { env: { ...process.env, MODKIT_TEST_OUT: out, FAKE_CALLS: calls, FAKE_DEFAULT_PLUGINS: JSON.stringify(PLUGINS), ...env }, windowsHide: true, timeout: 60_000 });
  const report = JSON.parse((await fs.readFile(out, 'utf8')).replace(/^\uFEFF/, ''));
  report.calls = (await fs.readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return report;
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

test('卸载 runs plain uninstall (putting the original exe back is what uninstall does), and there is no box to tick for it', { skip }, async () => {
  const report = await drive(`
    $uninstall.PerformClick(); Wait-Idle; $report.box = $box.Text
    $report.checkboxes = @($form.Controls | Where-Object { $_ -is [System.Windows.Forms.CheckBox] }).Count`);
  assert.deepEqual(lines(report.box), ['FAKE ran: uninstall', '---', 'FAKE ran: setup status']);
  assert.equal(report.checkboxes, 0);
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

test('打开 mods 文件夹 opens the mods folder the program says, making it if it is not there, and not one next to the program', { skip }, async () => {
  const report = await drive(`$folder.PerformClick(); $report.launched = $script:launched`);
  assert.ok(report.launched.includes(modsDir), `it was asked to open ${report.launched}`);
  assert.ok(!report.launched.includes(path.dirname(process.execPath) + path.sep + 'mods'), 'not "mods" beside the program (node.exe, from the repository)');
  assert.ok((await fs.stat(modsDir)).isDirectory(), 'and the folder is there');
});

// --- the version, and updating ---------------------------------------------------------------------

test('the launcher\'s version is shown, and when it is the latest the window says so and leaves the status as it was', { skip }, async () => {
  const report = await drive(`
    $report.before = $versionLabel.Text
    Start-Up; Wait-Idle
    $report.label = $versionLabel.Text; $report.box = $box.Text`);
  assert.equal(report.before, '启动器 v1.0.0');
  assert.match(report.label, /^启动器 v1\.0\.0 +（已是最新）$/);
  assert.deepEqual(lines(report.box), ['FAKE ran: setup status'], 'the check says nothing in the box');
  assert.deepEqual(report.calls, ['setup status', 'update --check --json'], 'it only asked');
});

test('a newer version is taken at once: the window asks the program to update and reopen, and closes when it says it has', { skip }, async () => {
  const report = await drive(`Start-Up; Wait-Idle; $report.closed = $form.IsDisposed`, { FAKE_LATEST: '2.0.0' });
  assert.deepEqual(report.calls, ['setup status', 'update --check --json', 'update --reopen']);
  assert.equal(report.closed, true, 'exit code 10 means the new window is up, so this one goes');
});

test('an update that did not finish keeps the window, says so, and shows what the program said above the status', { skip }, async () => {
  const report = await drive(`Start-Up; Wait-Idle; $report.closed = $form.IsDisposed; $report.label = $versionLabel.Text; $report.box = $box.Text`,
    { FAKE_LATEST: '2.0.0', FAKE_UPDATE_CODE: '1' });
  assert.equal(report.closed, false);
  assert.match(report.label, /更新到 v2\.0\.0 没有完成/);
  assert.deepEqual(lines(report.box), ['FAKE ran: update --reopen', '---', 'FAKE ran: setup status']);
});

test('not being able to ask, and there being nothing to take yet, are said and nothing is updated', { skip }, async () => {
  const failed = await drive(`Start-Up; Wait-Idle; $report.label = $versionLabel.Text`, { FAKE_CHECK_ERROR: 'offline' });
  assert.match(failed.label, /检查更新失败：offline/);
  assert.deepEqual(failed.calls.filter(call => call.startsWith('update')), ['update --check --json']);

  const none = await drive(`Start-Up; Wait-Idle; $report.label = $versionLabel.Text`, { FAKE_LATEST: 'none' });
  assert.match(none.label, /还没有发布过新版本/);
});

test('刷新 asks again, and takes a newer version the same way', { skip }, async () => {
  const report = await drive(`$refresh.PerformClick(); Wait-Idle; $report.closed = $form.IsDisposed`, { FAKE_LATEST: '3.0.0' });
  assert.deepEqual(report.calls, ['setup status', 'update --check --json', 'update --reopen']);
  assert.equal(report.closed, true);
});

// --- plugins ---------------------------------------------------------------------------------------------

// Open the plugins window (not modal, so that the test can drive it), and load its list.
const OPEN = `
  $w = New-PluginsWindow; Connect-PluginsWindow $w; $w.Form.Show(); Update-PluginList $w
  function Pick([string]$name) { foreach ($item in $w.List.Items) { if ($item.Text -eq $name) { $item.Selected = $true } } }
`;

test('the plugins window lists what the registry has, with where each stands', { skip }, async () => {
  const report = await drive(`${OPEN}
    $report.rows = @($w.List.Items | ForEach-Object { ($_.Text, $_.SubItems[1].Text, $_.SubItems[2].Text) -join '|' })
    $report.act = $w.Act.Enabled; $report.remove = $w.Remove.Enabled`);
  assert.deepEqual(report.rows, ['Alpha|1.0.0|未安装', 'Beta|1.1.0|可更新 1.0.0 → 1.1.0', 'Gamma|2.0.0|已安装 2.0.0', 'Delta|3.0.0|已安装（不是从这里装的）']);
  assert.deepEqual([report.act, report.remove], [false, false], 'nothing is selected, so nothing can be pressed');
  assert.deepEqual(report.calls, ['mods browse --json']);
});

test('what is selected decides the buttons: 安装, 更新, or nothing to do, and 卸载 only for what is installed', { skip }, async () => {
  const report = await drive(`${OPEN}
    $report.states = [ordered]@{}
    foreach ($name in 'Alpha', 'Beta', 'Gamma', 'Delta') { Pick $name; $report.states[$name] = "$($w.Act.Text)|$($w.Act.Enabled)|$($w.Remove.Enabled)" }`);
  assert.deepEqual(report.states, { Alpha: '安装|True|False', Beta: '更新|True|True', Gamma: '已是最新|False|True', Delta: '已是最新|False|True' });
});

test('安装 says what the plugin declares first, and installs only on a yes; then the list is read again', { skip }, async () => {
  const report = await drive(`${OPEN}
    Pick 'Alpha'; $w.Act.PerformClick()
    $report.question = $script:questions[0]; $report.asked = $script:questions.Count`);
  assert.equal(report.asked, 1);
  for (const part of ['安装「Alpha」1.0.0？', 'does alpha', 'Node 部分：有', '没有沙盒', 'files、network', 'beta ^1.0.0', 'left-pad', '网页脚本会在软件的窗口里运行']) {
    assert.ok(report.question.includes(part), `the question has "${part}":\n${report.question}`);
  }
  assert.deepEqual(report.calls, ['mods browse --json', 'mods get alpha --yes', 'mods browse --json']);
});

test('a plugin without a Node part says so, and a no runs nothing', { skip }, async () => {
  const said = await drive(`${OPEN}
    $script:answer = $false
    Pick 'Beta'; $w.Act.PerformClick(); $w.Act.PerformClick()
    $report.questions = $script:questions`);
  assert.equal(said.questions.length, 2, 'asked each time it was pressed');
  assert.ok(said.questions[0].startsWith('更新「Beta」1.1.0？'));
  assert.ok(said.questions[0].includes('Node 部分：没有') && said.questions[0].includes('它声明要用：没写'));
  assert.deepEqual(said.calls, ['mods browse --json'], 'nothing but the list');
});

test('更新 updates the one that has a newer version, and 卸载 removes after asking', { skip }, async () => {
  const report = await drive(`${OPEN}
    Pick 'Beta'; $w.Act.PerformClick()
    Pick 'Gamma'; $w.Remove.PerformClick()
    $report.questions = $script:questions`);
  assert.deepEqual(report.calls, ['mods browse --json', 'mods update beta --yes', 'mods browse --json', 'mods remove gamma', 'mods browse --json']);
  assert.ok(report.questions[1].startsWith('卸载「Gamma」？'));
});

test('a list that cannot be read is said in the window, and nothing can be pressed', { skip }, async () => {
  const report = await drive(`${OPEN}
    $report.details = $w.Details.Text; $report.count = $w.List.Items.Count; $report.act = $w.Act.Enabled`, { FAKE_BROWSE_FAIL: '1' });
  assert.match(report.details, /读不到插件列表：registry unreachable/);
  assert.deepEqual([report.count, report.act], [0, false]);
});

test('the main window has the 插件… button, kept off while a command runs like the others', { skip }, async () => {
  const report = await drive(`$report.text = $pluginsButton.Text; $install.PerformClick(); $report.whileRunning = $pluginsButton.Enabled; Wait-Idle; $report.after = $pluginsButton.Enabled`);
  assert.deepEqual([report.text, report.whileRunning, report.after], ['插件…', false, true]);
});
