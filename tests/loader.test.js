// What keeps the loader resident and single: the lock, the log file, the logon script.
// Nothing here touches the app, the real Startup folder or the real lock.   node --test tests/loader.test.js

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { install, remove, scriptText, status } from '../src/lib/autostart.js';
import { LoaderRunning, acquireLock } from '../src/lib/lock.js';
import { log, stopTee, style, teeToFile } from '../src/lib/output.js';
import { until } from './app-helpers.js';

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modkit-loader-'));
});

after(() => {
  stopTee();
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the lock -----------------------------------------------------------------------

test('a second loader is refused while the first is alive, and told who has it', () => {
  const file = path.join(dir, 'a.lock');
  const first = acquireLock({ file, pid: 111, alive: () => true });
  assert.equal(fs.readFileSync(file, 'utf8'), '111');

  assert.throws(() => acquireLock({ file, pid: 222, alive: () => true }), err => {
    assert.ok(err instanceof LoaderRunning);
    assert.equal(err.pid, 111);
    assert.match(err.message, /another loader is already running \(pid 111\)/);
    return true;
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '111', 'the holder keeps it');

  first.release();
  assert.equal(fs.existsSync(file), false, 'released');
  acquireLock({ file, pid: 222, alive: () => true }).release();     // and now the second may
});

test('a lock left by a process that is gone is taken over', () => {
  const file = path.join(dir, 'b.lock');
  fs.writeFileSync(file, '999999');
  const lock = acquireLock({ file, pid: 333, alive: pid => pid !== 999999 });
  assert.equal(fs.readFileSync(file, 'utf8'), '333');
  lock.release();
});

test('a lock file with nothing sensible in it does not block anyone', () => {
  const file = path.join(dir, 'c.lock');
  fs.writeFileSync(file, 'not a pid');
  acquireLock({ file, pid: 444, alive: () => true }).release();
});

test('releasing does not remove a lock that is no longer ours', () => {
  const file = path.join(dir, 'd.lock');
  const mine = acquireLock({ file, pid: 555, alive: () => true });
  fs.writeFileSync(file, '777');                 // someone took it over after a mistaken "stale"
  mine.release();
  assert.equal(fs.readFileSync(file, 'utf8'), '777');
});

test('across real processes: a held lock refuses a second one, and a killed holder frees it', async () => {
  const file = path.join(dir, 'e.lock');
  const lockModule = new URL('../src/lib/lock.js', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireLock } from ${JSON.stringify(lockModule)};
    acquireLock({ file: ${JSON.stringify(file)} });
    console.log('held');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await until('the holder has it', () => fs.existsSync(file), 8000);
    assert.throws(() => acquireLock({ file }), LoaderRunning);

    holder.kill();                                // no chance to release: the file stays behind
    await until('the holder is gone', () => holder.exitCode !== null || holder.signalCode !== null, 5000);
    assert.equal(fs.existsSync(file), true, 'a killed holder leaves its lock behind');
    acquireLock({ file }).release();              // and that is not a problem
  } finally {
    holder.kill();
  }
});

// --- the log file -------------------------------------------------------------------

test('everything logged is also in the file, with the time and without colour codes', () => {
  const file = path.join(dir, 'logs', 'one.log');
  teeToFile(file);
  log(`${style.green('ok')} plain line`);
  log('two\nlines');
  stopTee();
  log('not in the file');

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d {2}(ok )?plain line$/);
  assert.ok(lines.every(l => !l.includes('\x1b')));
  assert.match(lines[2], /two\s*$|lines$/);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('not in the file'));
});

test('a log that has grown too big is moved aside once, so it cannot fill the disk', () => {
  const file = path.join(dir, 'logs', 'two.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(5000));
  teeToFile(file, { maxBytes: 1000 });
  log('fresh');
  stopTee();

  assert.equal(fs.readFileSync(`${file}.1`, 'utf8').length, 5000, 'the old one is kept as .1');
  assert.match(fs.readFileSync(file, 'utf8'), /fresh/);
  assert.ok(fs.statSync(file).size < 200, 'and the new one starts small');
});

// --- the logon script ---------------------------------------------------------------

test('the logon script starts the loader hidden, from the project folder, and quotes what has spaces', () => {
  const text = scriptText({ node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'E:\\my mods\\src\\cli.js', cwd: 'E:\\my mods' });
  assert.match(text, /CurrentDirectory = "E:\\my mods"/);
  const run = text.match(/shell\.Run "(.*)", 0, False/)[1];
  // VBScript doubles a quote inside a string; undone, it is a command line with each path quoted.
  assert.equal(run.replaceAll('""', '"'), '"C:\\Program Files\\nodejs\\node.exe" "E:\\my mods\\src\\cli.js" start --log-file');
  assert.match(text, /, 0, False/, 'window style 0: hidden, and do not wait');
  assert.ok(text.includes('\r\n'), 'Windows line endings');
});

test('installing, reading back and removing the logon script', () => {
  const startup = path.join(dir, 'Startup');
  assert.deepEqual(status({ dir: startup }), { installed: false, file: path.join(startup, 'wuwa-modkit.vbs') });

  const file = install({ dir: startup, node: 'C:\\node.exe', cli: 'E:\\p\\src\\cli.js', cwd: 'E:\\p' });
  assert.equal(file, path.join(startup, 'wuwa-modkit.vbs'));
  const now = status({ dir: startup });
  assert.equal(now.installed, true);
  assert.equal(now.command, '"C:\\node.exe" "E:\\p\\src\\cli.js" start --log-file');

  install({ dir: startup, node: 'C:\\node.exe', cli: 'E:\\p\\src\\cli.js', cwd: 'E:\\p' });       // again: the same file, not a second one
  assert.deepEqual(fs.readdirSync(startup), ['wuwa-modkit.vbs']);

  assert.deepEqual(remove({ dir: startup }), { file, existed: true });
  assert.deepEqual(remove({ dir: startup }), { file, existed: false }, 'removing twice is not an error');
  assert.equal(status({ dir: startup }).installed, false);
});
