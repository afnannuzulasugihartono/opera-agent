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
import { windowState, focusWindow } from '../window-focus.js';
import { createSessionStore } from '../sessions.js';
import { listPageWebSockets, openTab, closeTab } from '../transport.js';
import { bridgePort, bridgeReachable, closeBridgeTarget, listBridgeTargets, openBridgeTarget } from '../bridge.js';
import { guide } from '../agent-guide.js';
import { startStdio } from '../mcp-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(join(here, '..', 'package.json'))('./package.json');

const PORT = Number(process.env.OPERA_LOCAL_PORT || 9333);
const BROWSER = process.env.OPERA_LOCAL_BROWSER || undefined;

// WHY THE LINK IS ASKED PER CALL. One `BRIDGED` constant decided the pipe at
// startup and then decided it for good: an extension that was asleep at that
// moment lost the run to a debugging port, which opens a profile nobody is
// logged into. Asking each time costs one field read and means a worker that
// wakes up late is simply used.

async function bridged() {
  return process.env.OPERA_LOCAL_TRANSPORT !== 'cdp' && await bridgeReachable();
}

const store = createSessionStore({ openSession, port: PORT, browserId: BROWSER, viaBridge: null });
const open = (options) => store.open(options);
const attach = () => store.attach();

async function resolveTab() {
  if (await bridged()) return (await listBridgeTargets()).map((page) => String(page.id));
  return (await listPageWebSockets(PORT)).map((page) => page.id);
}

async function reachable() {
  if (await bridged()) return true;
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

const driver = {
  async tabs() {
    if (await bridged()) return listBridgeTargets();
    return (await listPageWebSockets(PORT)).map(({ id, url, title }) => ({ id, url, title }));
  },

  async open(url) {
    if (await bridged()) {
      const tab = await openBridgeTarget(url);
      return { url, id: tab.id, port: bridgePort() };
    }
    const tab = await openTab(PORT, url);
    return { url, id: tab.id, port: PORT };
  },

  async close(tabId) {
    return store.closeTab(tabId, async (id) => await bridged() ? closeBridgeTarget(id) : closeTab(PORT, id));
  },

  async ask(method, params) {
    return (await attach()).ask(method, params);
  },

  async guide(topic) {
    return guide(topic);
  },

  async menuTree(options) {
    return (await attach()).menuTree(options);
  },

  async openMenu(options) {
    return (await attach()).openMenu(options);
  },

  async read() {
    return (await attach()).read();
  },

  async find(query) {
    return (await attach()).find(query);
  },

  async click(x, y, handle) {
    return (await attach()).click(x, y, handle);
  },

  async resolve(role, name) {
    return (await attach()).resolve(role, name);
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

  async caretLine() {
    return (await attach()).caretLine();
  },

  async windowState() {
    return windowState();
  },

  async focusWindow(match) {
    return focusWindow(match);
  },

  async waitForRow(options) {
    return (await attach()).waitForRow(options);
  },

  async waitForStill(options) {
    return (await attach()).waitForStill(options);
  },

  async upload(options) {
    return (await attach()).upload(options);
  },

  async dropFile(options) {
    return (await attach()).dropFile(options);
  },

  async interceptFileChooser(enabled) {
    return (await attach()).interceptFileChooser(enabled);
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

await bridgeReachable().catch(() => false);

// WHY THE STARTUP PROBE MAY NOT KILL THE SERVER. Asking which pipe is right is
// asking whether a port is free, and the honest answer to "another driver owns
// it" is to say so. Dying here instead said it by refusing to start at all,
// which is what happened when the person toggled the server on while a previous
// instance was still holding the loopback port: the conflict was real and the
// only visible result was a dead MCP with a stack trace instead of a server
// that starts and names the conflict on the first tool call.

// WHY THE PORT IS A FUNCTION AND NOT A VALUE. The pipe is chosen per call,
// because a worker that was asleep at startup picks itself up thirty seconds
// later. A port read once at startup reports the debugging port long after the
// drive has moved to the bridge — which is a wrong answer about a port nothing
// is listening on.

startStdio({
  context: {
    driver,
    open,
    resolveTab,
    sessionOptions: {},
    port: async () => (await bridged()) ? bridgePort() : PORT,
    version: pkg.version,
    browsers: installedBrowsers(),
    reachable
  }
});
