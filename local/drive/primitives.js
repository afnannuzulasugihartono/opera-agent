// @last-edited: 2026-10-23 UTC+7.
// @title: primitives — the local driver assembled from the modules that each answer one question.
// @state: navigation, focus and the raw protocol escape hatch, with the typing, pointer, reads, waits, canvas and file verbs assigned from their own modules.
// @dependencies: input, pointer, observe, waits, canvas, primitives-file, window-focus.

// WHY THIS FILE EXISTS

// These are the verbs that make the three targets possible: writing a document in Docs, filling a sheet in Sheets, laying out a deck in Slides.
// Each one is a CDP command underneath, so each inherits the half-millisecond transport measured in local-transport, and each has one rule that is not obvious and not optional.
// The rules themselves moved to the module that owns the verb they govern: typing and keys to input.js, clicks and hovers to pointer.js, the reads of the page to observe.js, the settle and the waits to waits.js, the canvas read to canvas.js and the file verbs to primitives-file.js.
// What is left here is the navigation, the window, and the wiring that hands each module the page it drives.

// Dispatches pipeline.
// One CDP session answers every request by id, so ten sends without an await between them cost one round trip, not ten, and Chrome still processes them in arrival order.
// Anything that must wait — a gap for a menu animation, a tree before its boxes — awaits; everything else fires together.

import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';

import { measureAx, probeSurface, buildProfile, describeProfile } from '../surface/surface-profile.js';
import { readLadder } from '../surface/read-strategy.js';
import { actionLadder } from '../surface/action-strategy.js';
import { filePrimitives } from './primitives-file.js';
import { createInputMethods } from './input.js';
import { createPointerMethods } from './pointer.js';
import { createObserveMethods } from './observe.js';
import { createWaits } from './waits.js';
import { createCanvasMethods } from '../surface/canvas.js';
import { windowState as osWindowState, focusWindow as osFocusWindow } from '../core/window-focus.js';

export function createPrimitives(cdp, { chunkSize = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fs = nodeFs, os = nodeOs, path = nodePath, now = Date.now } = {}) {
  const capped = (limit) => Math.min(Math.max(1, Number(limit) || 120), 500);

  const primitives = {
    async navigate(url) {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url });
      return primitives.waitForIdle();
    },

    async front() {
      await cdp.send('Page.bringToFront', {});
      return true;
    },

    async ask(method, params = {}) {
      return cdp.send(method, params);
    },

    // WHY A PAGE EXCEPTION IS AN ERROR AND NOT A MISSING VALUE.
    // Measured on a real Google Doc: the first probe referenced a constant the page had never heard of, the page threw, and the answer came back undefined - which reads exactly like a page with no canvas, no text and no editor.
    // A thrown page expression is a fact about the page, so it is raised here rather than flattened into a value the caller cannot tell from a measurement.
    async evaluate(expression) {
      const reply = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true
      });
      if (reply?.exceptionDetails) {
        const detail = reply.exceptionDetails;
        throw new Error(`the page threw while evaluating: ${detail.text || 'unknown error'}${detail.exception?.description ? ` (${String(detail.exception.description).split('\n')[0]})` : ''}`);
      }
      return reply?.result?.value;
    },

    // WHY THE PROFILE IS A PRIMITIVE OF ITS OWN.
    // An agent meeting a site for the first time has to know what the surface is before it can know what a read will cost, and paying a full read to find out is the wrong order.
    // This asks nothing of the page and moves no caret, so it is the one call that is always safe on a surface nobody has seen.
    async surfaceProfile() {
      const probe = await probeSurface({ evaluate: primitives.evaluate });
      const ax = await measureAx({ ask: primitives.ask });
      const surface = buildProfile({ probe, ax });
      return {
        surface,
        strategy: readLadder(surface),
        action: actionLadder(surface),
        description: describeProfile(surface)
      };
    },

    // WHY THE PAGE IS ASKED BEFORE THE MACHINE, AND WHY IT IS ENOUGH.
    // Measured live on this machine, twice, with the drive typing into a Google Docs document: a browser behind another application still reported focus here and took the text, and a minimized browser reported no focus and dropped it.
    // So this one evaluation answers the only case that costs anything to be wrong about, and the machine is asked only when it says the page is deaf.
    async hasFocus() {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: 'document.hasFocus()',
        returnByValue: true
      });
      return result?.value === true;
    },

    // WHY THE WINDOW IS ASKED THROUGH THE BROWSER FIRST.
    // Measured on this machine: the OS read is a PowerShell enumeration and costs p50 1.14s, while Browser.getWindowForTarget on the same session costs p50 0.35ms and already answers the only question the focus guard has - is the window minimized.
    // The OS read stays as the fallback for a browser or bridge that refuses the Browser domain, because a wrong "background" answer is how text goes nowhere.
    async windowState() {
      try {
        const { bounds } = await cdp.send('Browser.getWindowForTarget', {});
        return {
          platform: process.platform,
          foreground: '',
          windows: [],
          minimized: bounds?.windowState === 'minimized' ? ['the browser window'] : [],
          ownWindow: true
        };
      } catch {
        return osWindowState();
      }
    },

    async focusWindow(match = '') {
      try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget', {});
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
        const focused = bounds?.windowState !== 'minimized';
        return {
          platform: process.platform,
          match: String(match ?? ''),
          focused,
          title: focused ? 'the browser window' : '',
          foreground: '',
          windows: [],
          minimized: focused ? [] : ['the browser window'],
          why: focused ? '' : 'the browser would not leave the taskbar'
        };
      } catch {
        return osFocusWindow(match);
      }
    }

  };

  const observe = createObserveMethods({ cdp, primitives, capped });
  Object.assign(primitives, observe);
  const { readState, readRows } = observe;

  const input = createInputMethods({ cdp, primitives, sleep, chunkSize });
  Object.assign(primitives, input);

  const pointer = createPointerMethods({ cdp, primitives });
  Object.assign(primitives, pointer);

  const canvas = createCanvasMethods({ cdp, primitives, readState });
  Object.assign(primitives, canvas);

  const waits = createWaits({ cdp, sleep, readState, readRows, read: () => primitives.read(), primitives, now });
  Object.assign(primitives, waits);

  Object.assign(primitives, filePrimitives(primitives, { cdp, sleep, fs, os, path, readState }));

  return primitives;
}