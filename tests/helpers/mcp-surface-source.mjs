// @last-edited: 2026-10-21 UTC+7.
// @title: mcp-surface-source — the cloud MCP surface, read from every file that carries it.
// @state: the tool surface lives in two files now; a test that reads the surface reads both.
// @dependencies: node:fs, node:fs/promises.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// WHY THE SURFACE IS READ FROM BOTH FILES.
// The tool list and the transport that carries it were one file, and a test that read the file saw both.
// The list now lives in its own module, so a test that reads only the transport would see a surface with no tools in it, and a test that reads only the tools would see schemas with no server behind them.
// Reading both keeps every one of those tests saying what it was written to say.

const FILES = [
  '../../supabase/functions/opera-agent-mcp/index.ts',
  '../../supabase/functions/opera-agent-mcp/tools.ts'
];

export const mcpSurfaceSourceSync = () => FILES
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

export const mcpSurfaceSource = async () => {
  const parts = [];
  for (const file of FILES) parts.push(await readFile(new URL(file, import.meta.url), 'utf8'));
  return parts.join('\n');
};
