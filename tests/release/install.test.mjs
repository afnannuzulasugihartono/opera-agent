// @last-edited: 2026-11-12 UTC+7.
// @title: install - the trusted path from "npm install -g" to a verified backup of the build.
// @state: everything verified before it touches the disk; the registry, not the file, is the install.
// @dependencies: test, assert, node:crypto, node:http, node:fs/promises, node:os, node:path, ../local/install.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchVerifiedZip, installCrxInto } from '../../local/install.js';

const makeZip = () => Buffer.from('zip-payload-of-the-opera-agent-build-for-tests');

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/opera-agent.zip` };
};

test('fetchVerifiedZip returns the bytes when the header hash matches', async () => {
  const bytes = makeZip();
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', sha); res.end(); } else { res.setHeader('Content-Type', 'application/zip'); res.end(bytes); }
  });
  try {
    const got = await fetchVerifiedZip({ url });
    assert.deepEqual([...got], [...bytes]);
  } finally {
    server.close();
  }
});

test('fetchVerifiedZip throws when the sha256 header disagrees', async () => {
  const bytes = makeZip();
  const wrong = crypto.createHash('sha256').update('different').digest('hex');
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', wrong); res.end(); } else { res.end(bytes); }
  });
  try {
    await assert.rejects(() => fetchVerifiedZip({ url }), /sha256 mismatch/);
  } finally {
    server.close();
  }
});

test('fetchVerifiedZip throws when HEAD carries no hash header', async () => {
  const { server, url } = await serve((req, res) => { res.end(''); });
  try {
    await assert.rejects(() => fetchVerifiedZip({ url }), /x-opera-sha256/);
  } finally {
    server.close();
  }
});

test('fetchVerifiedZip throws when the download fails', async () => {
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', 'aa'); res.end(); } else { res.statusCode = 503; res.end(); }
  });
  try {
    await assert.rejects(() => fetchVerifiedZip({ url }), /503/);
  } finally {
    server.close();
  }
});

test('installCrxInto creates <root>/<Browser>/opera-agent.zip and README.txt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oa-install-'));
  try {
    const bytes = makeZip();
    const { folder, crx } = await installCrxInto(dir, 'chrome', bytes, 'readme content\n');
    assert.equal(path.basename(folder), 'Chrome');
    assert.equal(path.basename(crx), 'opera-agent.zip');
    assert.equal((await stat(crx)).size, bytes.length);
    assert.equal(await readFile(path.join(folder, 'README.txt'), 'utf8'), 'readme content\n');
    assert.deepEqual([...(await readFile(crx))], [...bytes]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installCrxInto refuses empty bytes; no folder is created', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oa-install-'));
  try {
    await assert.rejects(() => installCrxInto(dir, 'edge', Buffer.alloc(0), 'x'), /empty bytes/);
    await assert.rejects(() => stat(path.join(dir, 'Edge')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
