// Starting the app with WebView2 remote debugging enabled.

import { spawn } from 'node:child_process';

// Start a process without making the caller wait for it. The only thing we add to the app's
// environment is whatever `env` says (the variable that opens the DevTools port), so the app
// otherwise runs exactly as it would when started normally.
//
// windowsHide matters here: without it, a GUI app launched with detached:true still gets an
// attached console window, because the child inherits ours, and a stray terminal is left
// behind after `lab` exits. With it, the app runs with no console at all — which is also how
// it behaves when started from Explorer.
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
