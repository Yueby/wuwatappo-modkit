#!/usr/bin/env node
// Command line entry point, for running from the repository: node src/cli.js <command>.
// The packaged exe starts at src/entry.js instead.

import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2));
