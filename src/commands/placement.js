// node src/cli.js placement [--json] — is this program in the app's own folder, beside WuwaTappo.exe?
//
// What the window asks when it opens (--json: one line of { ok, dir, startMenu, found: [{ how, dir }] }), and what a person
// can ask by hand. Exit code 0 when it is where it has to be, 1 when it is not.

import { log, style } from '../lib/output.js';
import { checkPlacement, placementMessage } from '../lib/placement.js';

export default async function placement(argv) {
  const unknown = argv.filter(arg => arg !== '--json');
  if (unknown.length) throw new Error(`unknown option ${unknown[0]} (placement takes --json)`);

  const result = await checkPlacement();
  if (argv.includes('--json')) log(JSON.stringify(result));
  else log(result.ok ? style.green(placementMessage(result)) : style.red(placementMessage(result)));
  return result.ok ? 0 : 1;
}
