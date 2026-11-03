// @last-edited: 2026-11-03 UTC+7.
// @title: landingserve — serve landing/ on 127.0.0.1 so the redesign can be looked at before it ships.
// @state: one throwaway server for the review step; it reads files and answers, and holds no state.
// @dependencies: node:http, node:fs, node:path.

// WHY THIS EXISTS.
// A redesign is judged by looking at it, and the shipped site is deployed by a manual dispatch.
// This serves the same bytes the site would, so the screenshots are of the change and not of the last deploy.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = new URL('../landing/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const port = Number(process.argv[2] || 8777);

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = join(root, path === '/' ? 'beranda.html' : path);
  // WHY THE GUARD READS LIKE A GATE EVEN ON LOOPBACK: a dev server that resolves a URL into a filesystem path without checking the root is one copied command away from a public one, and the reviewer who finds it there reads it as the habit, not the exposure.
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`landing served on http://127.0.0.1:${port}`));
