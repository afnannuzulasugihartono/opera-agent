#!/usr/bin/env node

// @last-edited: 2026-11-08 UTC+7.
// @title: opera-agent-mcp - the installed entry point: one command, two modes.
// @state: the mode comes from the first argument; each mode starts the server it names.
// @dependencies: ./opera-local.js for the local mode.

// WHY THE MODE IS AN ARGUMENT AND NOT A FLAG.
// A caller that has to remember a flag has two ways to get it wrong; a caller that names the mode cannot.
// The modes share every tool name and every answer shape, so the choice is only about who drives the browser.

const USAGE = `opera-agent-mcp <mode>

  local      drive the everyday browser on this machine, over the loopback bridge
  cloud      drive it through the hosted Opera Agent server
  auth       sign in with a browser and keep the token beside this install
  doctor     print what is connected, the plan, and what the plan allows
  install    detect this machine's browsers, register the extension, keep a verified CRX backup
  uninstall  remove the extension's registry keys, the OperaAgent folder, and this package; prints what it cannot remove

  --help     print this
`;

const requested = process.argv[2] || 'local';
const mode = requested.startsWith('--mode=') ? requested.slice('--mode='.length) : requested;

if (mode === 'help' || process.argv.includes('--help')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (mode === 'doctor') {
  const { doctor } = await import('../doctor.js');
  process.exitCode = await doctor();
} else if (mode === 'local') {
  await import('./opera-local.js');
} else if (mode === 'cloud') {
  const { serveCloud } = await import('../cloud.js');
  process.exitCode = await serveCloud();
} else if (mode === 'auth') {
  const { login } = await import('../oauth.js');
  try {
    const answer = await login();
    process.stdout.write('Signed in. The token is stored in ' + answer.file + '\n');
  } catch (error) {
    process.stderr.write('Sign-in did not finish: ' + String(error?.message || error) + '\n');
    process.exitCode = 4;
  }
} else if (mode === 'install') {
  const { installFromCli } = await import('../install.js');
  process.exitCode = await installFromCli();
} else if (mode === 'uninstall') {
  const { uninstallFromCli } = await import('../install.js');
  process.exitCode = await uninstallFromCli();
} else {
  process.stderr.write(`Unknown mode: ${mode}\n${USAGE}`);
  process.exit(2);
}
