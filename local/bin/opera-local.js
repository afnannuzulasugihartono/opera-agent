#!/usr/bin/env node

// @last-edited: 2026-10-13 UTC+7.
// @title: opera-local — the installed entry point: a local CDP driver behind an MCP stdio server.
// @state: binds the protocol to a real browser and to the environment it was given.
// @dependencies: ../mcp-server.js, ../driver.js, ../sessions.js, ../transport.js.

// WHY THIS FILE EXISTS
//
// The server speaks MCP and the driver speaks CDP; this is the only place the two
// are joined. It is separate so the protocol stays testable without a browser.
//
// WHY the session is made lazily. browser_status has to answer on a machine where
// no browser is listening, which is exactly when someone needs to be told that.
// Connecting eagerly would turn a useful diagnosis into a crash.
//
// WHY the port comes from the environment. npx must work without a config file, so
// the two things a user may need to override, which port and which browser, are
// environment variables rather than arguments a client would have to know about.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, installedBrowsers } from '../driver.js';
import { createSessionStore } from '../sessions.js';
import { listPageWebSockets, openTab, closeTab } from '../transport.js';
import { bridgeAddress, bridgePort, closeBridgeTarget, listBridgeTargets, openBridgeTarget } from '../bridge.js';
import { startStdio } from '../mcp-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(join(here, '..', 'package.json'))('./package.json');

const PORT = Number(process.env.OPERA_LOCAL_PORT || 9333);
const BROWSER = process.env.OPERA_LOCAL_BROWSER || undefined;
const BRIDGED = process.env.OPERA_LOCAL_TRANSPORT === 'bridge';

const store = createSessionStore({ openSession, port: PORT, browserId: BROWSER, viaBridge: BRIDGED || null });
const open = (options) => store.open(options);
const attach = () => store.attach();

async function resolveTab() {
  if (BRIDGED) return (await listBridgeTargets()).map((page) => String(page.id));
  return (await listPageWebSockets(PORT)).map((page) => page.id);
}

async function reachable() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

const driver = {
  async tabs() {
    if (BRIDGED) return listBridgeTargets();
    return (await listPageWebSockets(PORT)).map(({ id, url, title }) => ({ id, url, title }));
  },

  async open(url) {
    if (BRIDGED) {
      const tab = await openBridgeTarget(url);
      return { url, id: tab.id, port: bridgePort() };
    }
    const tab = await openTab(PORT, url);
    return { url, id: tab.id, port: PORT };
  },

  async close(tabId) {
    return store.closeTab(tabId, (id) => BRIDGED ? closeBridgeTarget(id) : closeTab(PORT, id));
  },

  async read() {
    return (await attach()).read();
  },

  async find(query) {
    return (await attach()).find(query);
  },

  async click(x, y) {
    return (await attach()).click(x, y);
  },

  async hover(x, y) {
    return (await attach()).hover(x, y);
  },

  async clickRow(role, name) {
    return (await attach()).clickRow(role, name);
  },

  async key(name, modifiers) {
    return (await attach()).key(name, modifiers);
  },

  async type(text) {
    return (await attach()).type(text);
  },

  async keys(events) {
    return (await attach()).keys(events);
  },

  async snapshot(limit) {
    return (await attach()).snapshot(limit);
  },

  async capture(options) {
    return (await attach()).capture(options);
  }
};

// WHY the bridge listens before the first tool call. A lazy server makes the
// first command pay the whole link wait, and leaves the extension polling a
// dead port until then. Listening here links the worker while the client is
// still shaking hands. A failure is swallowed on purpose: the port may belong
// to another session, and every tool call retries with a named error anyway.

if (BRIDGED) await bridgeAddress().catch(() => {});

startStdio({
  context: {
    driver,
    open,
    resolveTab,
    sessionOptions: {},
    port: BRIDGED ? bridgePort() : PORT,
    version: pkg.version,
    browsers: installedBrowsers(),
    reachable
  }
});
