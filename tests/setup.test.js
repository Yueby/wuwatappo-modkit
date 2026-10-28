// What setup and uninstall decide to do about an app that is running. The doing (killing, patching,
// starting) touches the real machine and is not run here; what is decided is pure.
//
//   node --test tests/setup.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupAppPlan, uninstallAppPlan } from '../src/commands/setup.js';

test('setup: an app that is not running is left alone', () => {
  for (const patched of [true, false]) {
    assert.deepEqual(setupAppPlan({ state: 'stopped', patched }), { stop: false, restart: false });
  }
});

test('setup: a running app without the port is closed and started again, patched or not', () => {
  // It was started before the port was asked for, so it never gets one; and an exe that is not patched
  // yet cannot be written while it runs.
  for (const patched of [true, false]) {
    assert.deepEqual(setupAppPlan({ state: 'running', patched }), { stop: true, restart: true });
  }
});

test('setup: an app that answers on the port with a patched exe is not touched, running setup again changes nothing for it', () => {
  assert.deepEqual(setupAppPlan({ state: 'debuggable', patched: true }), { stop: false, restart: false });
});

test('setup: an app on the port but with an exe that is not patched is still closed: the file cannot be written', () => {
  assert.deepEqual(setupAppPlan({ state: 'debuggable', patched: false }), { stop: true, restart: true });
});

test('uninstall: the original is put back, and a running app is closed for it and started again', () => {
  assert.deepEqual(uninstallAppPlan({ running: true, hasBackup: true, keepExe: false }), { restore: true, stop: true, restart: true });
  assert.deepEqual(uninstallAppPlan({ running: false, hasBackup: true, keepExe: false }), { restore: true, stop: false, restart: false });
});

test('uninstall: --keep-exe leaves the exe and the app alone, and with no backup there is nothing to put back', () => {
  assert.deepEqual(uninstallAppPlan({ running: true, hasBackup: true, keepExe: true }), { restore: false, stop: false, restart: false });
  assert.deepEqual(uninstallAppPlan({ running: true, hasBackup: false, keepExe: false }), { restore: false, stop: false, restart: false });
});
