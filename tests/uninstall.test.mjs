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

const withRoots = async (fn) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oa-uninstall-root-'));
  const home = await mkdtemp(path.join(os.tmpdir(), 'oa-uninstall-home-'));
  try {
    return await fn({ root, home });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
};

const env = (root, home) => ({ LOCALAPPDATA: root, OPERA_AGENT_HOME: home });
const quietExec = () => {};
const noSpawn = () => ({ unref() {} });
const absentKey = () => { const e = new Error('Unable to find the specified registry key or value.'); e.status = 1; throw e; };

test('clean machine reports nothing removed and exits ok', async () => {
  await withRoots(async ({ root, home }) => {
    const spawned = { yes: false };
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: absentKey,
      spawnImpl: () => { spawned.yes = true; return noSpawn(); },
      root: path.join(home, 'OperaAgent'),
      home,
    });
    assert.equal(result.ok, true);
    assert.equal(spawned.yes, true, 'npm uninstall was spawned anyway');
    for (const vendor of ['chrome', 'brave', 'edge']) assert.match(result.message, new RegExp(`registry key for ${vendor}`));
    assert.match(result.message, /OperaAgent folder: not found/);
    assert.match(result.message, /device pairing: not found/);
  });
});

test('deletes all three registry keys', async () => {
  await withRoots(async ({ root, home }) => {
    const calls = [];
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: (cmd, args) => calls.push(args),
      spawnImpl: noSpawn,
      root: path.join(home, 'OperaAgent'),
      home,
    });
    const vendors = calls.map(([op, key]) => String(key).includes('Google') ? 'chrome' : String(key).includes('Brave') ? 'brave' : 'edge');
    assert.deepEqual(new Set(vendors), new Set(['chrome', 'brave', 'edge']));
    assert.match(result.message, /registry key for chrome/);
    assert.match(result.message, /registry key for edge/);
  });
});

test('deletes the OperaAgent folder including the dedicated ChromeProfile', async () => {
  await withRoots(async ({ root, home }) => {
    await mkdir(path.join(root, 'ChromeProfile'), { recursive: true });
    await writeFile(path.join(root, 'ChromeProfile', 'marker.txt'), 'x');
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: noSpawn,
      root,
      home,
    });
    await assert.rejects(() => stat(path.join(root, 'ChromeProfile')), /ENOENT/);
    assert.match(result.message, /OperaAgent folder: deleted/);
  });
});

test('keepPair preserves the device file; everything else still goes', async () => {
  await withRoots(async ({ root, home }) => {
    await mkdir(path.join(root, 'Chrome'), { recursive: true });
    await mkdir(path.join(home, '.opera-agent'), { recursive: true });
    await writeFile(deviceFile(home), '{"deviceName":"opera-9"}');
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: noSpawn,
      root,
      home,
      keepPair: true,
    });
    assert.match(result.message, /device pairing: kept \(--keep-pair\)/);
    assert.match(result.message, /OperaAgent folder: deleted/);
  });
});

test('deletes the paired device file by default', async () => {
  await withRoots(async ({ root, home }) => {
    await mkdir(path.join(home, '.opera-agent'), { recursive: true });
    await writeFile(deviceFile(home), '{"deviceName":"opera-9"}');
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: noSpawn,
      root,
      home,
    });
    assert.match(result.message, /device pairing: deleted/);
    await assert.rejects(() => stat(deviceFile(home)), /ENOENT/);
  });
});

test('spawns npm uninstall -g opera-agent-mcp with detached:true', async () => {
  await withRoots(async ({ root, home }) => {
    const calls = [];
    await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: (cmd, args, opts) => { calls.push([cmd, ...args, opts]); return { unref() {} }; },
      root,
      home,
    });
    assert.deepEqual(calls, [['npm', 'uninstall', '-g', 'opera-agent-mcp', { detached: true, stdio: 'ignore' }]]);
  });
});

test('spawn failure is reported and the command still exits ok', async () => {
  await withRoots(async ({ root, home }) => {
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: () => { throw new Error('spawn npm ENOENT'); },
      root,
      home,
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /could not spawn/);
    assert.match(result.message, /npm uninstall -g opera-agent-mcp/);
  });
});

test('prints the browser Remove instructions for developer-mode copies', async () => {
  await withRoots(async ({ root, home }) => {
    const result = await uninstall({
      platform: 'win32',
      env: env(root, home),
      exec: quietExec,
      spawnImpl: noSpawn,
      root,
      home,
    });
    assert.match(result.message, /chrome:\/\/extensions/);
    assert.match(result.message, /brave:\/\/extensions/);
    assert.match(result.message, /edge:\/\/extensions/);
  });
});
