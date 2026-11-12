// @last-edited: 2026-11-12 UTC+7.
// @title: install - the trusted path from "npm install -g" to a browser that carries the extension.
// @state: everything server-independent is verified before it touches the disk; nothing is written before the bytes check out.
// @dependencies: test, assert, node:crypto, node:http, node:fs/promises, node:os, node:path, ../local/install.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchVerifiedCrx, installCrxInto, CRX_MAGIC } from '../local/install.js';

const makeCrx = () => Buffer.concat([Buffer.from(CRX_MAGIC), Buffer.from('payload-of-filler-bytes-for-testing')]);

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/crx` };
};

test('fetchVerifiedCrx returns bytes when hash matches and magic is Cr24', async () => {
  const bytes = makeCrx();
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', sha); res.end(); } else { res.setHeader('Content-Type', 'application/octet-stream'); res.end(bytes); }
  });
  try {
    const got = await fetchVerifiedCrx({ url });
    assert.deepEqual([...got], [...bytes]);
  } finally {
    server.close();
  }
});

test('fetchVerifiedCrx throws when the sha256 header disagrees', async () => {
  const bytes = makeCrx();
  const wrong = crypto.createHash('sha256').update('different').digest('hex');
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', wrong); res.end(); } else { res.end(bytes); }
  });
  try {
    await assert.rejects(() => fetchVerifiedCrx({ url }), /sha256 mismatch/);
  } finally {
    server.close();
  }
});

test('fetchVerifiedCrx throws when the payload is not Cr24', async () => {
  const bytes = Buffer.from('definitely-not-a-crx-file-at-all');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const { server, url } = await serve((req, res) => {
    if (req.method === 'HEAD') { res.setHeader('x-opera-sha256', sha); res.end(); } else { res.end(bytes); }
  });
  try {
    await assert.rejects(() => fetchVerifiedCrx({ url }), /magic bytes missing/);
  } finally {
    server.close();
  }
});

test('fetchVerifiedCrx throws when HEAD carries no hash header', async () => {
  const { server, url } = await serve((req, res) => { res.end(''); });
  try {
    await assert.rejects(() => fetchVerifiedCrx({ url }), /x-opera-sha256/);
  } finally {
    server.close();
  }
});

test('installCrxInto creates <root>/<Browser>/extension.crx and README.txt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oa-install-'));
  try {
    const bytes = makeCrx();
    const { folder, crx } = await installCrxInto(dir, 'chrome', bytes, 'readme content\n');
    assert.equal(path.basename(folder), 'Chrome');
    assert.equal((await stat(crx)).size, bytes.length);
    assert.equal(await readFile(path.join(folder, 'README.txt'), 'utf8'), 'readme content\n');
    assert.deepEqual([...(await readFile(crx))], [...bytes]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installCrxInto refuses bytes that are not Cr24; no folder is created', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oa-install-'));
  try {
    await assert.rejects(() => installCrxInto(dir, 'edge', Buffer.from('nope'), 'x'), /not a CRX/);
    await assert.rejects(() => stat(path.join(dir, 'Edge')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
