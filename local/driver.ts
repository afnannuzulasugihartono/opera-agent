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

import { existsSync } from 'node:fs';

import { detectBrowsers, expandPath } from './browsers.js';
import { createPrimitives } from './primitives.js';
import { createCdpClient } from './cdp.js';
import {
  bridgeReachable,
  connectBridgeTarget,
  listBridgeTargets,
  openBridgeTarget,
  waitForBridgeLink,
  LINK_ERROR
} from './bridge.js';

export function installedBrowsers({ platform = process.platform, exists = existsSync, env = process.env }: { platform?: string; exists?: (path: string) => boolean; env?: NodeJS.ProcessEnv } = {}) {
  return detectBrowsers({ platform, exists, env }).map((entry) => ({
    ...entry,
    binary: (entry.paths[platform] ?? []).map((candidate) => expandPath(candidate, env)).find((candidate) => exists(candidate)) ?? null
  }));
}

// A named tab is always a NEW tab.
// Driving a document, a sheet and a deck in one session means three targets, and reusing whichever page happened to be in front would navigate away whatever the person was reading.

// A bridged session is a CDP session whose wire runs through the extension instead of a debugging port: same client, same primitives, numeric tab ids.
// There is nothing to launch and nothing to reuse; either the link is up or the call fails loudly naming the one fix that exists.

async function openBridgeSession({ tabUrl, targetId, timeoutMs, primitivesOptions }: { tabUrl?: string | null | undefined; targetId?: unknown; timeoutMs?: number; primitivesOptions?: Record<string, unknown> | undefined }) {
  const linked = await waitForBridgeLink(timeoutMs === undefined ? {} : { timeoutMs });
  if (!linked) throw new Error(LINK_ERROR);
  let numericId: unknown;
  if (tabUrl) {
    numericId = (await openBridgeTarget(tabUrl)).id;
  } else if (targetId !== null && targetId !== undefined && targetId !== '') {
    const known = await listBridgeTargets();
    if (!known.some((t) => String(t.id) === String(targetId))) {
      throw new Error(`No page target ${String(targetId)}. Open pages: ${known.map((t) => String(t.id)).join(' | ')}`);
    }
    numericId = Number(targetId);
  } else {
    const pages = await listBridgeTargets();
    if (!pages.length) throw new Error('bridge: the browser has no page to drive');
    numericId = pages[0]!.id;
  }
  const cdp = createCdpClient(connectBridgeTarget(numericId));
  return {
    port: null,
    reused: true,
    binary: null,
    bridge: true,
    targetId: numericId,
    cdp,
    ...createPrimitives(cdp, { ...primitivesOptions, bridge: true }),
    close() {
      cdp.close();
    }
  };
}

// WHY THERE IS ONE ROAD.
// The extension reaches the profile the person is actually logged into, and a debugging port cannot — it opens a fresh profile with nothing signed in.
// The port road therefore bought a different browser, not a faster one, and a second browser is a second queue and a second place a plan could be missed.
// So the link is asked for on every session, and there is nothing else to configure anywhere.

export async function openSession({
  tabUrl = null,
  targetId = null,
  timeoutMs = 15000,
  primitives: primitivesOptions = {}
}: { tabUrl?: string | null; targetId?: unknown; timeoutMs?: number; primitives?: Record<string, unknown> } = {}) {
  const linked = await bridgeReachable().catch(() => false);
  if (!linked) throw new Error(LINK_ERROR);
  return openBridgeSession({ tabUrl, targetId, timeoutMs, primitivesOptions });
}