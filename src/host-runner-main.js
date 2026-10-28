// What the loader forks to run a mod's Node part when it is started from the repository.
// (Packaged, the program forks itself instead: see forkRunner in lib/host.js.)

import { runHost } from './lib/host-runner.js';

runHost();
