// @last-edited: 2026-11-01 UTC+7.
// @title: local-primitives — the assembled driver keeps navigation, focus and the raw escape hatch.
// @state: window state, focus window and bringing the tab forward, asked through the browser before the machine.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrimitives } from '../local/primitives.js';
import { recordingCdp } from './helpers/local-page.mjs';

test('the window state asks the browser, not the operating system, when it can', async () => {
  const calls = [];
  const cdp = {
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (method === 'Browser.getWindowForTarget') {
        return {
          windowId: 44,
          bounds: { windowState: 'minimized' }
        };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).windowState();

  assert.deepEqual(calls.map((c) => c.method), ['Browser.getWindowForTarget']);
  assert.deepEqual(out.minimized, ['the browser window'], 'a minimized window is the one case that needs the machine');
  assert.equal(out.ownWindow, true, 'the session owns that window, so its name is never in question');
  assert.equal(out.platform, process.platform);
});


test('focusing a minimized window uses the browser bounds, not a shell', async () => {
  const calls = [];
  const cdp = {
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (method === 'Browser.getWindowForTarget') return {
        windowId: 44,
        bounds: { windowState: 'minimized' }
      };
      if (method === 'Browser.setWindowBounds') return {};
      if (method === 'Browser.getWindowBounds') return { bounds: { windowState: 'normal' } };
      return {};
    }
  };

  const out = await createPrimitives(cdp).focusWindow('Paper');

  assert.deepEqual(calls.map((c) => c.method), [
    'Browser.getWindowForTarget',
    'Browser.setWindowBounds',
    'Browser.getWindowBounds',
    'Runtime.evaluate'
  ], 'the browser is asked of the page once, so the answer can name it');
  assert.deepEqual(calls[1].params, {
    windowId: 44,
    bounds: { windowState: 'normal' }
  });
  assert.equal(out.focused, true);
  assert.equal(out.title, 'the browser window');
});


// WHY A WINDOW THAT IS NOT MINIMIZED KEEPS ITS SIZE.
// Measured live on this machine: focusing a maximized browser window restored it to its smaller plain size, and the page the person was reading shrank under them without being asked.
// So the browser is told to be normal only for a window that is minimized, which cannot take a click at all.

test('a window that is not minimized is not resized on the way forward', async () => {
  const calls = [];
  const cdp = {
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (method === 'Browser.getWindowForTarget') return {
        windowId: 44,
        bounds: { windowState: 'maximized' }
      };
      if (method === 'Browser.getWindowBounds') return { bounds: { windowState: 'maximized' } };
      return {};
    }
  };

  const out = await createPrimitives(cdp).focusWindow('Paper');

  assert.equal(calls.some((c) => c.method === 'Browser.setWindowBounds'), false, 'a maximized window is not told to be normal');
  assert.equal(out.focused, true);
});


// WHY THE BROWSER IS ASKED OF THE PAGE.
// The extension may be talking to any browser on any machine, and every window the operating system holds belongs to one of them.
// The page knows which browser it runs in, so the driver asks the page, once, and keeps the answer for the life of the tab.

test('the browser is asked of the page once and kept, because a tab cannot change browsers', async () => {
  let asks = 0;
  const cdp = {
    send: async (
      method,
      params = {}
    ) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('userAgent')) {
        asks += 1;
        return { result: { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } };
      }
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp);

  const first = await p.browser();
  const second = await p.browser();

  assert.equal(first.name, 'Google Chrome');
  assert.equal(first.version, '131.0.0.0');
  assert.deepEqual(second, first);
  assert.equal(asks, 1, 'the page is asked once');
});


test('front brings the tab forward so the watcher sees where the agent is', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).front();

  assert.equal(out, true);
  assert.ok(cdp.calls.some((c) => c.method === 'Page.bringToFront'));
});

