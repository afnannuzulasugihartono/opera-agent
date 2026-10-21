// @last-edited: 2026-10-11 UTC+7.
// @title: driver — launches a browser on its own profile, connects, and hands back primitives; or reuses one that is already listening.
// @state: 5 locks; reuse before launch, profile isolation, and a browser that is actually reachable before it is driven.
// @dependencies: ./browsers.js, ./cdp.js, ./transport.js, ./primitives.js.

// Why this file exists: the parts below are individually tested and individually correct, and the failure that matters happens between them.
// A browser launched with a profile that is already in use opens a second window, ignores the debugging port, and reports a connection refused with nothing to suggest why.
// So the profile is always isolated, and the driver never returns until it has spoken to the browser it claims to have started.

// Launching is not the default path.
// If something is already answering on the port, that browser is reused, which is what makes a second run cheap instead of opening another window every time.

// The session is closed by the caller rather than by a signal handler here, so that a script can decide whether a browser it launched should outlive it.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BROWSERS, detectBrowsers, expandPath, findBrowser, launchArgs } from './browsers.js';
import { createPrimitives } from './primitives.js';
import { createCdpClient } from './cdp.js';
import { attachToPage, connect, discoverPageWebSocket, discoverWebSocket, openTab, pageWebSocketById, waitForPage } from './transport.js';
import {
  bridgeReachable,
  closeBridgeTarget,
  connectBridgeTarget,
  listBridgeTargets,
  openBridgeTarget,
  waitForBridgeLink,
  LINK_ERROR
} from './bridge.js';

export function installedBrowsers({ platform = process.platform, exists = existsSync, env = process.env } = {}) {
  return detectBrowsers({ platform, exists, env }).map((entry) => ({
    ...entry,
    binary: entry.paths[platform].map((p) => expandPath(p, env)).find((p) => exists(p)) ?? null
  }));
}

function resolveBinary({ id, platform = process.platform, exists = existsSync, env = process.env } = {}) {
  if (!id) {
    const [first] = installedBrowsers({ platform, exists, env });
    if (!first) throw new Error('No Chromium browser was found on this machine.');
    return first;
  }
  const entry = findBrowser(id);
  if (!entry) throw new Error(`Unknown browser: ${id}. Known: ${BROWSERS.map((b) => b.id).join(', ')}`);
  const binary = entry.paths[platform].map((p) => expandPath(p, env)).find((p) => exists(p));
  if (!binary) throw new Error(`${entry.name} is not installed for ${platform}.`);
  return { ...entry, binary };
}

// A named tab is always a NEW tab.
// Driving a document, a sheet and a deck in one session means three targets, and reusing whichever page happened to be in front would navigate away whatever the person was reading.

// A bridged session is a CDP session whose wire runs through the extension instead of a debugging port: same client, same primitives, numeric tab ids.
// There is nothing to launch and nothing to reuse; either the link is up or the call fails loudly naming the one fix that exists.

async function openBridgeSession({ tabUrl, targetId, timeoutMs, primitivesOptions }) {
  const linked = await waitForBridgeLink({ timeoutMs });
  if (!linked) throw new Error(LINK_ERROR);
  let numericId;
  if (tabUrl) {
    numericId = (await openBridgeTarget(tabUrl)).id;
  } else if (targetId !== null && targetId !== undefined && targetId !== '') {
    const known = await listBridgeTargets();
    if (!known.some((t) => String(t.id) === String(targetId))) {
      throw new Error(`No page target ${targetId}. Open pages: ${known.map((t) => t.id).join(' | ')}`);
    }
    numericId = Number(targetId);
  } else {
    const pages = await listBridgeTargets();
    if (!pages.length) throw new Error('bridge: the browser has no page to drive');
    numericId = pages[0].id;
  }
  const cdp = createCdpClient(connectBridgeTarget(numericId));
  return {
    port: null,
    reused: true,
    binary: null,
    bridge: true,
    targetId: numericId,
    cdp,
    ...createPrimitives(cdp, primitivesOptions),
    close() {
      cdp.close();
    }
  };
}

// WHY THE PIPE IS ASKED, NOT SETTLED.
// The extension reaches the profile the person is actually logged into, and a debugging port cannot — it opens a fresh profile with nothing signed in.
// So the link is asked for on every session and the debugging port is what is left when there is no extension, which is the one case where it is the only thing that can work at all.
// `OPERA_LOCAL_TRANSPORT=cdp` still forces the port for a machine with no extension, and nothing else has to be configured anywhere.

export async function openSession({
  id,
  port = 9333,
  tabUrl = null,
  targetId = null,
  platform = process.platform,
  exists = existsSync,
  env = process.env,
  spawnBrowser = spawn,
  launch = true,
  timeoutMs = 15000,
  primitives: primitivesOptions = {},
  viaBridge = null
} = {}) {
  const bridged = viaBridge ?? (env.OPERA_LOCAL_TRANSPORT !== 'cdp' && await bridgeReachable());
  if (bridged) return openBridgeSession({ tabUrl, targetId, timeoutMs, primitivesOptions });

  let reused = false;
  let target = null;

  if (tabUrl) {
    target = (await openTab(port, tabUrl)).webSocketDebuggerUrl;
    reused = true;
  } else if (targetId) {
    target = (await pageWebSocketById(port, targetId)).url;
    reused = true;
  } else {
    try {
      target = await discoverPageWebSocket(port);
      reused = true;
    } catch {
      if (!launch) throw new Error(`No browser is listening on port ${port}.`);
    }
  }

  let child = null;
  if (!reused) {
    const entry = resolveBinary({ id, platform, exists, env });
    const userDataDir = mkdtempSync(join(tmpdir(), 'opera-local-'));
    const args = launchArgs({ browser: entry, port, userDataDir });
    child = spawnBrowser(entry.binary, args, { detached: false, stdio: 'ignore' });
  }

  if (!target) {
    const chosen = await pageWebSocketById(port, targetId, { timeoutMs });
    target = chosen.url;
  }
  const transport = await connect(target, { timeoutMs });
  const cdp = createCdpClient(transport);

  return {
    port,
    reused,
    binary: reused ? null : resolveBinary({ id, platform, exists, env }).binary,
    cdp,
    ...createPrimitives(cdp, primitivesOptions),
    close() {
      cdp.close();
      if (child) child.kill();
    }
  };
}