#!/usr/bin/env node

// @last-edited: 2026-10-21 UTC+7.
// @title: opera-local-dev — the development front door for the local MCP server.
// @state: the watched files, the supervisor behind the pipe, and the reload it performs on a save.
// @dependencies: none.

// Same tools as opera-local.js, reached through the dev shim: edit a watched file, save, and the worker behind the pipe rebuilds itself within a second, without a toggle.
// Production spawns opera-local.js directly.

import { stdin, stdout, stderr, exit, execPath } from 'node:process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSupervisor } from '../dev-shim.js';
import type { SupervisorWorker } from '../dev-shim.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const WATCHED = [
  join(root, 'local'),
  join(root, 'extension', 'lib', 'socket-protocol.js')
];

const log = (message: unknown) => stderr.write(`[opera-local-dev] ${String(message)}\n`);

const supervisor = createSupervisor({
  // WHY THE CAST: the spawn is declared with stdio pipes, so stdin and stdout are the streams the supervisor reads; Node types them as nullable, the supervisor asks for a non-null pair, and the cast names that contract.
  spawnWorker: () => spawn(execPath, [join(here, 'opera-local.js')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: join(root, 'local')
  }) as unknown as SupervisorWorker,
  watchFiles: (onChange: () => void) => {
    const watchers: import('node:fs').FSWatcher[] = [];
    for (const target of WATCHED) {
      const stats = fs.statSync(target, { throwIfNoEntry: false });
      if (!stats) continue;
      watchers.push(fs.watch(target, { recursive: stats.isDirectory() }, (_event, name) => {
        if (name && !/\.(mjs|js|json)$/.test(name)) return;
        onChange();
      }));
    }
    return {
      close: () => {
        for (const watcher of watchers) watcher.close();
      }
    };
  },
  input: stdin,
  output: stdout,
  log
});

async function shutdown(code: number) {
  await supervisor.stop();
  exit(code);
}

stdin.on('end', () => {
  void shutdown(0);
});
process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});
