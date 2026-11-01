// @last-edited: 2026-10-31 UTC+7.
// @title: context — the driver the local tools drive the browser with, built once and shared by the MCP server and the OpenCode plugin.
// @state: the pipe chosen per call, the session store behind it, and the driver that answers every primitive.
// @dependencies: ./driver.js, ./window-focus.js, ./focus-confirm.js, ./dialog.js, ./sessions.js, ./transport.js, ./bridge.js, ./agent-guide.js.

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
  askFocus,
  focusSteal,
  warmFocusNotice
} from './focus-confirm.js';
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

// WHY THE PANEL THAT ASKS THE PERSON IS STARTED WITH THE AGENT.
// Measured live on this machine: the question cost 1.6 s before it was on screen, because it started its own PowerShell and compiled the panel class again.
// A host that is already up answers in the time it takes to draw the panel, so the agent starts it before anyone is asked.

/**
 * Build the context that drives the browser, for the MCP server and for the OpenCode plugin alike.
 * @param {object} [options] - whether the panel that asks the person is started with the agent.
 * @param {boolean} [options.warm] - true to keep a panel host up, so the first question does not pay for a boot.
 * @returns {object} the driver, the session opener, the tab resolver, and what the server reports about itself.
 */

export function createLocalContext({
  warm = false
} = {}) {
  if (warm) warmFocusNotice();

  // WHY THE MACHINE IS READ ONCE FOR EVERYBODY.
  // The operating system read starts a PowerShell and costs about a second, and the question about the screen is asked by three places: the tab switch, the guard before an input, and the window answer.
  // So one read is shared and kept for a beat - long enough for one step of a drive, short enough that a person who walks away is noticed.

  let seen = {
    at: 0,
    state: null
  };
  const readWindow = async () => {
    if (Date.now() - seen.at < 1500 && seen.state) return seen.state;
    const state = await windowState().catch(() => null);
    seen = {
      at: Date.now(),
      state
    };
    return state;
  };

  const store = createSessionStore({
    openSession,
    port: PORT,
    browserId: BROWSER,
    viaBridge: null,
    mayFront,
    read: readWindow,
    resolveTabs: resolveTab
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

  // WHY THE PERSON IS ASKED BEFORE THE SCREEN MOVES TO ANOTHER TAB.
  // The person may have moved on to another tab, another browser or another program while the drive was working, and a tab that comes forward under their hands takes that away without asking.
  // So the question is asked in the window they are in, and only an answer of yes lets the focus move.
  // Once it does, the tab comes forward and the window of the browser being driven comes with it, because a tab that switches behind another program never reaches the screen.

  async function mayFront({
    key,
    driver: session
  }) {

    // WHY THE QUESTION IS ONLY ASKED ON THE MACHINE THAT CAN SHOW IT.
    // The panel that asks is a Windows panel, and on a machine without it the question could only be asked in the chat - which is the one place the person is not looking.
    // So the question is asked only where it can be seen, and the focus moves as it did before on the other machines.

    if (process.platform !== 'win32') {
      await session?.front?.().catch(() => null);
      return;
    }
    const state = await readWindow();
    const pages = await driver.tabs().catch(() => []);
    const target = pages.find((page) => String(page.id) === String(key))
      ?? pages.find((page) => String(page.url) === String(key));
    const title = target?.title ?? '';

    // WHY THE BROWSER OF THE TAB IS ASKED FOR.
    // The same page can be open in two browsers at once, and the window in front would then carry the title of the tab the drive wants - so a title alone would say "the person is already here" while the screen moves to another browser.

    const driving = await Promise.resolve().then(() => session?.browser?.()).catch(() => null);
    const steal = focusSteal({
      foreground: state?.foreground ?? '',
      title,
      browser: driving?.name ?? ''
    });
    if (steal.ask) {
      const answer = await askFocus({
        what: `the "${title || key}" tab`
      });
      if (!answer.allowed) {
        throw new Error(`the focus did not move: ${steal.why}, and the answer was ${answer.answer}`);
      }
    }

    // WHY THE WINDOW COMES FORWARD WITH THE TAB.
    // Measured live on this machine: the browser window stayed behind the program the person was using, so the screen never moved even though the tab was the drive's.
    // So the window of the browser being driven comes forward too when there was a question, with the browser's name so the right window is the one that rises.

    if (steal.ask) {
      await session?.front?.().catch(() => null);

      // WHY THE PERSON IS NOT ASKED A SECOND TIME.
      // The question above was answered a moment ago, and asking the same person the same thing twice is noise they learn to dismiss.
      // So the window comes forward on the answer that was already given.

      await focusWindow(title || driving?.name || '', {
        browser: driving?.name ?? '',
        ask: false
      }).catch(() => null);
      return;
    }
    await session?.front?.().catch(() => null);
  }

  // WHY THE BROWSER IS ASKED OF THE TAB BEING DRIVEN.
  // The extension may be connected to several browsers at once, so the browser this tab belongs to is the fact every window answer needs.
  // A tab that cannot be reached answers unknown rather than nothing, because a wrong browser name is how a drive acts on the wrong window.

  async function drivingBrowser() {
    try {
      return await (await attach()).browser();
    } catch {
      return null;
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
    async browser() {
      return drivingBrowser();
    },
    async focusWindow(match) {
      const driving = await drivingBrowser();
      return focusWindow(match, {
        browser: driving?.name ?? ''
      });
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
