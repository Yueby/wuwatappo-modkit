// The app as a process: is it up, does it have a DevTools port, and starting it with one.
// What `lab` does by hand and `start` does every time.

import { APP_EXE, INSTALL_DIR } from './paths.js';
import { launchDetached } from './launch.js';
import { countInstances } from './ps.js';
import { browserVersion } from './targets.js';

// 'debuggable': something answers on the port, which is the app we started. 'running': the app is
// up but without a DevTools port (started by double-click, or by its own logon task), so nothing can
// be attached to it. 'stopped': not running.
export async function appState(port) {
  try {
    await browserVersion({ port });
    return 'debuggable';
  } catch {
    return (await countInstances()) > 0 ? 'running' : 'stopped';
  }
}

export async function waitForDevTools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await browserVersion({ port });
    } catch {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  throw new Error(
    `DevTools endpoint did not come up on port ${port} within ${timeoutMs / 1000}s.\n` +
    `  If Windows showed a UAC prompt, the patch did not take — run node src/cli.js lab --rebuild and try again.`,
  );
}

// Start the (already patched) app with the DevTools port, and wait until the port answers. The
// app's own profile is used: this is the installed binary itself, just without the administrator
// requirement, so the login, settings and click counters are the real ones and the updater keeps
// working.
export async function startApp({ port }) {
  const child = launchDetached(APP_EXE, {
    cwd: INSTALL_DIR,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  const version = await waitForDevTools(port, 30_000);
  return { pid: child.pid, version };
}
