// @last-edited: 2026-10-23 UTC+7.
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
    'Browser.getWindowBounds'
  ]);
  assert.deepEqual(calls[1].params, {
    windowId: 44,
    bounds: { windowState: 'normal' }
  });
  assert.equal(out.focused, true);
  assert.equal(out.title, 'the browser window');
});


test('front brings the tab forward so the watcher sees where the agent is', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).front();

  assert.equal(out, true);
  assert.ok(cdp.calls.some((c) => c.method === 'Page.bringToFront'));
});

