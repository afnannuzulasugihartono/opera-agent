// @last-edited: 2026-11-06 UTC+7.
// @title: proof-run — one real drive: a browser reads a portal, the CSV lands, and four office files come out with the bytes the site ships.
// @state: the fixture portal, a throwaway Chrome, the MCP client over stdio, the five steps, and the record the suite rechecks.
// @dependencies: node:child_process, node:fs, node:http, node:os, node:path, ../local/browsers.js, ../local/driver.js, ../local/transport.js.

// WHY THIS FILE EXISTS.
// The product claims it drives a browser and hands back designed office files, and until this run the claim rested on separate tests: one drove a fake page, another wrote a workbook.
// A run that does both in one breath is the only thing that answers "can it actually do the job", and the hashes are what make the answer checkable instead of a story.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { launchArgs } from '../local/browsers.js';
import { installedBrowsers } from '../local/driver.js';
import { waitForBrowser } from '../local/transport.js';

// WHY THE SERVER ANSWERS FROM A WHITELIST.
// The portal is two files, and a server that joined the request into a folder would be a door nothing needs.

const SERVED = new Map([
  ['/portal.html', { file: 'portal.html', type: 'text/html; charset=utf-8' }],
  ['/transaksi-2026-09.csv', { file: 'transaksi-2026-09.csv', type: 'text/csv; charset=utf-8' }]
]);

export async function serveCompany(company = path.resolve('tests', 'fixtures', 'mock-company')) {
  const server = http.createServer((request, response) => {
    const entry = SERVED.get((request.url || '/').split('?')[0]);
    if (!entry) {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = fs.readFileSync(path.join(company, entry.file));
    response.writeHead(200, { 'content-type': entry.type, 'content-length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/portal.html`,
    csvUrl: `http://127.0.0.1:${port}/transaksi-2026-09.csv`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
