#!/usr/bin/env node

// @last-edited: 2026-10-11 UTC+7.
// @title: opera-local — the installed entry point: a local CDP driver behind an MCP stdio server.
// @state: binds the protocol to a real browser and to the environment it was given.
// @dependencies: ../mcp-server.js, ../driver.js.

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
import { connect, openTabWebSocket } from '../transport.js';
import { createCdpClient } from '../cdp.js';
import { createPrimitives } from '../primitives.js';
import { startStdio } from '../mcp-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(join(here, '..', 'package.json'))('./package.json');

const PORT = Number(process.env.OPERA_LOCAL_PORT || 9333);
const BROWSER = process.env.OPERA_LOCAL_BROWSER || undefined;

let session = null;
let wanted = null;

async function pages() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.filter((t) => t.type === 'page');
}

// WHY the target is matched rather than taken first. A drive that opens a sheet
// beside a document must end up driving the sheet, and attaching to whichever page
// the browser happens to list first does that by accident, on some machines and not
// others. The tab that was opened is named, and the session follows that name.

async function attach() {
  if (session) return session;

  if (wanted) {
    const page = (await pages()).find((t) => t.url.startsWith(wanted));
    if (!page) throw new Error(`The tab for ${wanted} is no longer open.`);
    const transport = await connect(page.webSocketDebuggerUrl);
    const cdp = createCdpClient(transport);
    session = { close: () => cdp.close(), ...createPrimitives(cdp) };
    return session;
  }

  session = await openSession({ port: PORT, id: BROWSER, launch: false });
  return session;
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
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.filter((t) => t.type === 'page').map((t) => ({ id: t.id, url: t.url, title: t.title }));
  },

  async open(url) {
    if (session) { session.close(); session = null; }
    await openTabWebSocket(PORT, url);
    wanted = url;
    return { url, port: PORT };
  },

  async read() {
    return (await attach()).read();
  },

  async find(query) {
    const page = await attach();
    return page.evaluate(`(() => {
      const needle = ${JSON.stringify(String(query).toLowerCase())};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const out = [];
      for (let node = walker.currentNode; node && out.length < 25; node = walker.nextNode()) {
        const own = Array.from(node.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
        if (!own.toLowerCase().includes(needle)) continue;
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({ text: own.slice(0, 80), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      }
      return out;
    })()`);
  },

  async click(x, y) {
    return (await attach()).clickAt(x, y);
  },

  async key(name, modifiers) {
    return (await attach()).key(name, modifiers);
  },

  async type(text) {
    return (await attach()).type(text);
  },

  async capture() {
    return (await attach()).capture();
  }
};

startStdio({
  context: {
    driver,
    port: PORT,
    version: pkg.version,
    browsers: installedBrowsers(),
    reachable
  }
});