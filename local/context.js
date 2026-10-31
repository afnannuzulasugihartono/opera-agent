// @last-edited: 2026-10-31 UTC+7.
// @title: context — the driver the local tools drive the browser with, built once and shared by the MCP server and the OpenCode plugin.
// @state: the pipe chosen per call, the session store behind it, and the driver that answers every primitive.
// @dependencies: ./driver.js, ./window-focus.js, ./dialog.js, ./sessions.js, ./transport.js, ./bridge.js, ./agent-guide.js.

import { createRequire } from 'node:module';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openSession,
  installedBrowsers
} from './driver.js';
import {
  windowState,
  focusWindow
} from './window-focus.js';
import {
  dialogState,
  dialogType,
  dialogPress
} from './dialog.js';
import { createSessionStore } from './sessions.js';
import {
  listPageWebSockets,
  openTab,
  closeTab
} from './transport.js';
import {
  bridgePort,
  bridgeReachable,
  closeBridgeTarget,
  listBridgeTargets,
  openBridgeTarget
} from './bridge.js';
import { guide } from './agent-guide.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(join(here, 'package.json'))('./package.json');

const PORT = Number(process.env.OPERA_LOCAL_PORT || 9333);
const BROWSER = process.env.OPERA_LOCAL_BROWSER || undefined;

// WHY THE LINK IS ASKED PER CALL.
// One `BRIDGED` constant decided the pipe at startup and then decided it for good: an extension that was asleep at that moment lost the run to a debugging port, which opens a profile nobody is logged into.
// Asking each time costs one field read and means a worker that wakes up late is simply used.

async function bridged() {
  return process.env.OPERA_LOCAL_TRANSPORT !== 'cdp' && await bridgeReachable();
}

/**
 * Build the context that drives the browser, for the MCP server and for the OpenCode plugin alike.
 * @returns {object} the driver, the session opener, the tab resolver, and what the server reports about itself.
 */

export function createLocalContext() {
  const store = createSessionStore({
    openSession,
    port: PORT,
    browserId: BROWSER,
    viaBridge: null
  });
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
      return (await listPageWebSockets(PORT)).map(({
        id,
        url,
        title
      }) => ({
        id,
        url,
        title
      }));
    },
    async open(url) {
      if (await bridged()) {
        const tab = await openBridgeTarget(url);
        return {
          url,
          id: tab.id,
          port: bridgePort()
        };
      }
      const tab = await openTab(PORT, url);
      return {
        url,
        id: tab.id,
        port: PORT
      };
    },
    async close(tabId) {
      return store.closeTab(tabId, async (id) => await bridged() ? closeBridgeTarget(id) : closeTab(PORT, id));
    },
    async ask(
      method,
      params
    ) {
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
    async settle() {
      return (await attach()).settle();
    },
    async find(query) {
      return (await attach()).find(query);
    },
    async clickFraction(at) {
      return (await attach()).clickFraction(at);
    },
    async click(
      x,
      y,
      handle
    ) {
      return (await attach()).click(x, y, handle);
    },
    async resolve(
      role,
      name
    ) {
      return (await attach()).resolve(role, name);
    },
    async hover(
      x,
      y
    ) {
      return (await attach()).hover(x, y);
    },
    async clickRow(
      role,
      name
    ) {
      return (await attach()).clickRow(role, name);
    },
    async key(
      name,
      modifiers
    ) {
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
    async ensureFront(options) {
      return (await attach()).ensureFront(options);
    },
    async captureSized(options) {
      return (await attach()).captureSized(options);
    },
    async dialogState() {
      return dialogState();
    },
    async dialogType(text) {
      return dialogType(text);
    },
    async dialogPress(name) {
      return dialogPress(name);
    },
    async waitForRow(options) {
      return (await attach()).waitForRow(options);
    },
    async waitForText(
      text,
      options
    ) {
      return (await attach()).waitForText(text, options);
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
    async download(options) {
      return (await attach()).download(options);
    },
    async pageState() {
      return (await attach()).pageState();
    },
    async capture(options) {
      return (await attach()).capture(options);
    }
  };

  return {
    driver,
    open,
    resolveTab,
    sessionOptions: {},
    port: async () => (await bridged()) ? bridgePort() : PORT,
    version: pkg.version,
    browsers: installedBrowsers(),
    reachable
  };
}
