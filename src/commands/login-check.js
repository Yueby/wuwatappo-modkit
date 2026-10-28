// node src/cli.js login-check
//
// Reports whether the *real* install is signed in, and whether a cloned profile
// would carry that session. Run it after logging in to the real app.

import { realProfileDir, cloneProfileDir, describeProfile } from '../lib/profile.js';
import { runPS } from '../lib/ps.js';
import { log, field, section, style } from '../lib/output.js';

export default async function loginCheck() {
  section('Real install');
  const real = realProfileDir();
  const realInfo = await describeProfile(real);
  field('profile', real);
  field('cookies', realInfo.hasCookies ? style.green('present') : style.red('missing'));

  const lastAuth = await lastAuthLine(real);
  if (lastAuth) {
    field('last boot', lastAuth);
    const signedIn = /logged_in=true/.test(lastAuth);
    field('status', signedIn ? style.green('signed in') : style.yellow('not signed in'));
    if (!signedIn) {
      log(`\n  Sign in to the real app once (${style.bold('node src/cli.js stop')} first if it is running),`);
      log(`  then run ${style.bold('node src/cli.js lab')} — the copy clones this profile.`);
    }
  } else {
    field('last boot', style.dim('no log yet'));
  }

  section('Patched copy');
  const clone = cloneProfileDir();
  const cloneInfo = await describeProfile(clone);
  field('profile', clone);
  field('cloned', cloneInfo.hasState ? style.green('yes') : style.dim('no — will be created on next lab run'));
  return 0;
}

// The app logs one AUTH line per boot; find the newest one.
async function lastAuthLine(profileDir) {
  const logsRoot = profileDir.replace(/[\\/]EBWebView$/, '') + '\\logs';
  const file = `${logsRoot}\\Wuwa Tappo.log`;
  try {
    const text = await runPS(`Get-Content -LiteralPath '${file}' -Tail 60 -ErrorAction SilentlyContinue`);
    const lines = text.split(/\r?\n/).filter(l => l.includes('[AUTH]') && l.includes('event=boot'));
    return lines.length ? lines[lines.length - 1].trim() : null;
  } catch {
    return null;
  }
}