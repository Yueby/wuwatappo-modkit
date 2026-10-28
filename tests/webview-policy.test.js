// The registry value that makes the app open its DevTools port by itself. Everything here is done in
// a throw-away key of its own under HKCU\Software, never in the real policy key.
//
//   node --test tests/webview-policy.test.js

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runningLoader } from '../src/lib/lock.js';
import { APP_NAME, POLICY_KEY, portOf, readArguments, removeArguments, setArguments } from '../src/lib/webview-policy.js';

const exec = promisify(execFile);
const key = `HKCU\\Software\\wuwa-modkit-test-${process.pid}\\AdditionalBrowserArguments`;
const root = `HKCU\\Software\\wuwa-modkit-test-${process.pid}`;

const exists = async k => exec('reg', ['query', k], { windowsHide: true }).then(() => true, () => false);

after(async () => {
  await exec('reg', ['delete', root, '/f'], { windowsHide: true }).catch(() => {});
});

test('what is written is the app-only DevTools flag, in the current user\'s policy key', () => {
  assert.match(POLICY_KEY, /^HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments$/, 'per user: no administrator');
  assert.equal(APP_NAME, 'WuwaTappo.exe');
  assert.notEqual(APP_NAME, '*', 'a wildcard would open the port for every WebView2 program on the machine');
});

test('set, read back, change, remove', async () => {
  assert.equal(await readArguments({ key }), null, 'nothing there yet');
  assert.equal(await removeArguments({ key }), false, 'and removing nothing is not an error');

  await setArguments({ port: 9222, key });
  assert.equal(await readArguments({ key }), '--remote-debugging-port=9222');
  assert.equal(portOf(await readArguments({ key })), 9222);

  await setArguments({ port: 9333, key });
  assert.equal(await readArguments({ key }), '--remote-debugging-port=9333', 'again replaces, it does not add');

  assert.equal(await removeArguments({ key }), true);
  assert.equal(await readArguments({ key }), null);
  assert.equal(await exists(key), false, 'and a key that is left empty is removed with it');
});

test('what belongs to other programs in the same key is left alone', async () => {
  await exec('reg', ['add', key, '/v', 'OtherApp.exe', '/t', 'REG_SZ', '/d', '--some-flag', '/f'], { windowsHide: true });
  await setArguments({ port: 9222, key });

  assert.equal(await removeArguments({ key }), true);
  assert.equal(await exists(key), true, 'the key stays: it is not empty');
  assert.equal(await readArguments({ key, name: 'OtherApp.exe' }), '--some-flag');
  assert.equal(await readArguments({ key }), null);

  assert.equal(await removeArguments({ key, name: 'OtherApp.exe' }), true);
  assert.equal(await exists(key), false);
});

test('the value name is matched exactly, dot and all', async () => {
  await setArguments({ port: 9222, key, name: 'a.b.exe' });
  assert.equal(await readArguments({ key, name: 'a.b.exe' }), '--remote-debugging-port=9222');
  assert.equal(await readArguments({ key, name: 'aXb.exe' }), null, '. is not a wildcard');
  await removeArguments({ key, name: 'a.b.exe' });
});

test('portOf only believes the flag this tool writes', () => {
  assert.equal(portOf('--remote-debugging-port=9222'), 9222);
  assert.equal(portOf('--foo --remote-debugging-port=1234 --bar'), 1234);
  assert.equal(portOf('--something-else'), null);
  assert.equal(portOf(null), null);
});

test('a loader counts as running only if its process is', () => {
  assert.equal(runningLoader({ file: 'E:\\no\\such\\file.lock' }), null);
  assert.equal(runningLoader({ file: new URL(import.meta.url).pathname.slice(1), alive: () => true }), null, 'a file with no pid in it is not a loader');
});
