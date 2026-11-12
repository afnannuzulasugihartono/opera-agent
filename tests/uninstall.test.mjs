// @last-edited: 2026-11-12 UTC+7.
// @title: uninstall - every step reported, nothing thrown, exit always 0.
// @state: honest scrubbing: registry copies disappear with a browser restart; developer-mode copies still ask for one click each.
// @dependencies: test, assert, node:fs/promises, node:os, node:path, ../local/install.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uninstall, deviceFile } from '../local/install.js';

const tmpRoot = () => mkdtemp(path.join(os.tmpdir(), 'oa-uninstall-'));
const homeWith = (dir) => ({ OPERA_AGENT_HOME: dir });

test('clean machine reports nothing removed and exits ok', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    const removed = {};
    const absent = path.join(home, 'OperaAgent');
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => { const e = new Error('Unable to find the specified registry key or value.'); e.status = 1; throw e; },
      spawnImpl: () => { removed.spawned = true; return { unref() {} }; },
      root: absent,
      home,
    });
    assert.equal(result.ok, true);
    assert.ok(removed.spawned, 'npm uninstall was spawned anyway');
    const text = result.message;
    for (const vendor of ['chrome', 'brave', 'edge']) assert.match(text, new RegExp(`registry key for ${vendor}`));
    assert.match(text, /OperaAgent folder: not found/);
    assert.match(text, /device pairing: not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('deletes all three registry keys', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    const calls = [];
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: (cmd, args) => calls.push(args),
      spawnImpl: () => ({ unref() {} }),
      root,
      home,
    });
    const vendors = calls.map(([op, key]) => String(key).includes('Google') ? 'chrome' : String(key).includes('Brave') ? 'brave' : 'edge');
    assert.deepEqual(new Set(vendors), new Set(['chrome', 'brave', 'edge']));
    assert.ok(result.message.includes('registry key for chrome'));
    assert.ok(result.message.includes('registry key for edge'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('deletes the OperaAgent folder including the dedicated ChromeProfile', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    await mkdir(path.join(root, 'ChromeProfile'), { recursive: true });
    await writeFile(path.join(root, 'ChromeProfile', 'marker.txt'), 'x');
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: () => ({ unref() {} }),
      root,
      home,
    });
    await assert.rejects(() => stat(path.join(root, 'ChromeProfile')), /ENOENT/);
    assert.match(result.message, /OperaAgent folder: deleted/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('keepPair preserves the device file; everything else still goes', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    await mkdir(path.join(root, 'Chrome'), { recursive: true });
    await mkdir(path.join(home, '.opera-agent'), { recursive: true });
    await writeFile(deviceFile(home), '{"deviceName":"opera-9"}');
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: () => ({ unref() {} }),
      root,
      home,
      keepPair: true,
    });
    assert.match(result.message, /device pairing: kept \(--keep-pair\)/);
    assert.match(result.message, /OperaAgent folder: deleted/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('deletes the paired device file by default', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    await mkdir(path.join(home, '.opera-agent'), { recursive: true });
    await writeFile(deviceFile(home), '{"deviceName":"opera-9"}');
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: () => ({ unref() {} }),
      root,
      home,
    });
    assert.match(result.message, /device pairing: deleted/);
    await assert.rejects(() => stat(deviceFile(home)), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('spawns npm uninstall -g opera-agent-mcp with detached:true', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    const calls = [];
    await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: (cmd, args, opts) => { calls.push([cmd, ...args, opts]); return { unref() {} }; },
      root,
      home,
    });
    assert.deepEqual(calls, [['npm', 'uninstall', '-g', 'opera-agent-mcp', { detached: true, stdio: 'ignore' }]]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('spawn failure is reported and the command still exits ok', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: () => { throw new Error('spawn npm ENOENT'); },
      root,
      home,
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /could not spawn/);
    assert.match(result.message, /npm uninstall -g opera-agent-mcp/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('prints the browser Remove instructions for developer-mode copies', async () => {
  const root = await tmpRoot();
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-home-'));
  try {
    const result = await uninstall({
      platform: 'win32',
      env: { LOCALAPPDATA: root, OPERA_AGENT_HOME: home },
      exec: () => {},
      spawnImpl: () => ({ unref() {} }),
      root,
      home,
    });
    assert.match(result.message, /chrome:\/\/extensions/);
    assert.match(result.message, /brave:\/\/extensions/);
    assert.match(result.message, /edge:\/\/extensions/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
