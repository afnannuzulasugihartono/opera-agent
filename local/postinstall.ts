#!/usr/bin/env node

// @last-edited: 2026-11-12 UTC+7.
// @title: postinstall - the one silent ounce the package owes; it changes nothing that a person cannot see.
// @state: global install only, never in CI, one line of output, every error swallowed to exit 0.
// @dependencies: ./install.js.

// WHY IT NEVER FAILS THE INSTALL.
// A browser absent, a locked registry, no network: none of these are a reason to turn a package install red.
// The person who typed npm install asked for the extension's tooling; printing the outcome is the polite maximum.

const isGlobal = process.env.npm_config_global === 'true' || process.env.npm_config_global_old === 'true';
const disabled = process.env.CI === 'true' || process.env.OPERA_AGENT_NO_INSTALL === '1';

if (!isGlobal || disabled) process.exit(0);

try {
  const { install } = await import('./install.js');
  const report = await install({ print: () => {} });
  if (report.browsers.length > 0) {
    process.stdout.write(`opera-agent-mcp: extension registered for ${report.browsers.map((b) => b.id).join(', ')}; restart the browser to use it, then \`opera-agent-mcp install\` for the full report.\n`);
  } else {
    process.stdout.write(`opera-agent-mcp: ${report.message}\n`);
  }
} catch (error: unknown) {
  process.stdout.write(`opera-agent-mcp: postinstall skipped (${String((error as Error)?.message || error)})\n`);
}
process.exit(0);
