// Where the packaged exe starts (scripts/build.js bundles this file and everything it imports into one
// script and embeds it in a copy of node.exe). From the repository, src/cli.js is the way in instead.
//
// One exe plays two parts, told apart by the environment, because a packaged program cannot be given a
// script to run: it is the command line program, and, when the loader starts a mod's Node part, it is
// that part's runner (see forkRunner in lib/host.js). There is no top-level await here: the bundle is
// CommonJS.

import { main } from './main.js';
import { runHost } from './lib/host-runner.js';

if (process.env.MODKIT_ROLE === 'host-runner') {
  runHost();
} else {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    err => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
