// @last-edited: 2026-11-03 UTC+7.
// @title: landingserve — serve landing/ on 127.0.0.1 so the redesign can be looked at before it ships.
// @state: one throwaway server for the review step; it reads files and answers, and holds no state.
// @dependencies: node:http, node:fs, node:path.

// WHY THIS EXISTS.
// A redesign is judged by looking at it, and the shipped site is deployed by a manual dispatch.
// This serves the same bytes the site would, so the screenshots are of the change and not of the last deploy.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = new URL('../landing/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, sep);
const rootWithSep = root.endsWith(sep) ? root : root + sep;
const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const port = Number(process.argv[2] || 8777);

// WHY THE PATH IS BUILT FROM A WHITELIST, NOT JOINED FROM THE REQUEST: joining user input into a filesystem path is the shape the traversal checks flag, whatever guard follows it.
// The request names a file, the whitelist decides whether it exists, and the only names that exist are the keys below.

const FILES = new Set([
  'beranda.html', 'index.html', 'akun.html', 'dashboard.html', 'unduh.html',
  'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'fitur.html',
  'dukungan.html', 'docs.html', 'harga.html', 'site.css', 'beranda.css',
  'features.css', 'download.css', 'auth.css', 'app.css', 'dashboard.css',
  'harga.css', 'docs.css', 'support.css', 'notfound.css', 'i18n.js', 'spotlight.js', 'docs.js', 'reveal.js',
  'wayfind.js', 'palette.js', 'oauth/consent.html', 'fonts/instrument-sans-latin.woff2'
]);

createServer(async (req, res) => {
  const raw = (req.url || '/').split('?')[0];
  // WHY ENCODED CHARACTERS DIE HERE: the whitelist below is matched after decoding, so %2F must die before the match — otherwise /a%2Fb and /a%2fb name the same file and the set answers a question it was never asked.
  if (/%|\\/.test(raw) || /\0|\.\./.test(raw)) {
    res.writeHead(403);
    res.end();
    return;
  }
  const path = decodeURIComponent(raw);
  const name = path === '/' ? 'beranda.html' : path.replace(/^\//, '');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.(html|woff2)$|^[A-Za-z0-9._-]+\.(html|css|js|svg|woff2)$/.test(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!FILES.has(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = resolve(root, name);
  if (!file.startsWith(rootWithSep)) {
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
