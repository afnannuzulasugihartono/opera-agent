#!/usr/bin/env node

// @last-edited: 2026-11-08 UTC+7.
// @title: opera-agent-mcp - the installed entry point: one command, two modes.
// @state: the mode comes from the first argument; each mode starts the server it names.
// @dependencies: ./opera-local.js for the local mode.

// WHY THE MODE IS AN ARGUMENT AND NOT A FLAG.
// A caller that has to remember a flag has two ways to get it wrong; a caller that names the mode cannot.
// The modes share every tool name and every answer shape, so the choice is only about who drives the browser.

const USAGE = `opera-agent-mcp <mode>

  local   drive the everyday browser on this machine, over the loopback bridge
  cloud   drive it through the hosted Opera Agent server

  --help  print this
`;

const requested = process.argv[2] || 'local';
const mode = requested.startsWith('--mode=') ? requested.slice('--mode='.length) : requested;

if (mode === 'help' || process.argv.includes('--help')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (mode === 'local') {
  await import('./opera-local.js');
} else if (mode === 'cloud') {
  process.stderr.write('The cloud mode is not built yet: this package still drives the local browser.\n');
  process.exit(3);
} else {
  process.stderr.write(`Unknown mode: ${mode}\n${USAGE}`);
  process.exit(2);
}
