// @last-edited: 2026-11-01 UTC+7.
// @title: pointer — the clicks and hovers, and the handles that say what they hit.
// @state: clickAt, clickFraction, hover, hoverRow, clickHandle, handleBox and resolveHandle, with the mark a person watching can see.
// @dependencies: ./page-expressions.js.

// WHY THIS MODULE EXISTS

// Every pointer action is a coordinate sent into a page that may have moved, and the answer it gives back is a fact about what was under that coordinate.
// Keeping the dispatch, the mark and the ownership read together means a click can never claim it landed without asking who owns the point first.

// Every pointer action leaves a mark the person watching can see.
// A synthetic click moves no cursor, so without a mark the drive is invisible: a red ring for a click, blue for a hover, drawn as one fixed div by a fixed script that takes coordinates and nothing else — visible live and in captures, and pipelined with the action so the mark costs no round trip.
// A debugger overlay was tried first and discarded: it answers ok and renders nothing.
// The mark is best-effort by design: a page that refuses the script still gets its click.

// WHY THE SPOT TAKES ITSELF AWAY.
// Measured live on this product's own author: a click marker that never goes leaves a red ring sitting on the page for the rest of the session, and every capture after it carries that ring - so the picture an agent reads its own click out of has a 26-pixel circle drawn on top of the thing it just clicked.
// The mark is worth having for the beat in which the person watching sees where the drive went; it is not worth leaving on the page.

// A hover moves and stops.
// A menu item that owns a submenu opens it on hover and closes on click, so a press here dismisses the menu the caller was reaching into and the submenu is then gone.
// Measured against a real View menu: the press did nothing but close it, the hover opened it.

// A hover does not wait for its own reply.
// A lone mouse move is the one dispatch whose acknowledgement Chrome answers on page time — measured 700 ms to 5 s on ordinary pages, while the same move inside a click answers in milliseconds.
// The move is sent and the mark awaited; the effect is proven by the snapshot read that follows every hover, which is also what makes a dead tab fail loudly one call later instead of silently now.

// WHY A CLICK ASKS WHO OWNS THE POINT BEFORE IT PRESSES.
// Measured live on YouTube: a cookie wall covered the page, click_row on the search box answered with the row's name and its point as if the click had reached it, focus never left the wall's button, and the type that followed had nothing to say but a guess.
// The point either belongs to the row or to something laid over it, and that is one question with one answer.
// When the page cannot answer, nothing is claimed.

import {
  HANDLE_PREFIX,
  centreOf,
  hitExpression
} from './page-expressions.js';

export function createPointerMethods({
  cdp,
  primitives
}) {
  const SPOT_MS = 700;

  const spot = (
    x,
    y,
    color
  ) => {
    const px = Math.round(Number(x) || 0);
    const py = Math.round(Number(y) || 0);
    return cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const d = document;
        if (!d || !d.documentElement) return false;
        let el = d.getElementById('opera-spot');
        if (!el) {
          el = d.createElement('div');
          el.id = 'opera-spot';
          el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid;border-radius:50%;width:26px;height:26px;margin:0;padding:0;box-sizing:border-box;transition:opacity 120ms linear;';
          d.documentElement.appendChild(el);
        }
        clearTimeout(d.defaultView.__operaSpot);
        el.style.opacity = '1';
        el.style.left = '${px - 13}px';
        el.style.top = '${py - 13}px';
        el.style.borderColor = '${color}';
        d.defaultView.__operaSpot = d.defaultView.setTimeout(() => { el.remove(); }, ${SPOT_MS});
        return true;
      })()`,
      returnByValue: true
    }).catch(() => null);
  };

  const hitAt = async (
    x,
    y
  ) => {
    try {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: hitExpression(x, y),
        returnByValue: true
      });
      const el = result?.value;
      if (!el) return {
        hit: null,
        presses: null
      };
      const tag = String(el.tag ?? '');
      return {
        hit: {
          tag,
          role: String(el.role ?? ''),
          name: String(el.name ?? ''),
          canvas: tag === 'CANVAS'
        },
        presses: typeof el.presses === 'number' ? el.presses : null
      };
    } catch {
      return {
        hit: null,
        presses: null
      };
    }
  };

  const ownershipAt = async (
    handle,
    point
  ) => {
    const raw = String(handle ?? '');
    if (!raw.startsWith(HANDLE_PREFIX)) return {};
    const backendNodeId = Number(raw.slice(HANDLE_PREFIX.length));
    if (!Number.isFinite(backendNodeId)) return {};

    // WHY THE DOM AGENT IS SWITCHED ON FIRST.
    // Measured live: without it resolveNode answers an error, the catch below swallowed it, and the click reported no fact at all - a silent fallback that looks the same as a page that cannot answer.

    try {
      await cdp.send('DOM.enable').catch(() => null);
      const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
      const objectId = resolved?.object?.objectId;
      if (!objectId) return {};
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function (x, y) {
          const at = document.elementFromPoint(x, y);
          if (!at) return {};
          if (at === this || this.contains(at)) return { covered: false };
          const label = (at.getAttribute('aria-label') || at.innerText || at.textContent || '')
            .replace(/\\s+/g, ' ').trim().slice(0, 60);
          return {
            covered: true,
            coveredBy: at.tagName.toLowerCase() + (at.getAttribute('role') ? '[' + at.getAttribute('role') + ']' : ''),
            coveredText: label
          };
        }`,
        arguments: [
          { value: Number(point.x) },
          { value: Number(point.y) }
        ],
        returnByValue: true
      });
      return result?.value ?? {};
    } catch {
      return {};
    }
  };

  // WHY THE PAGE COUNTS THE PRESSES IT TAKES.
  // Measured live on this machine: the first click of a drive, right after the browser window came forward for the person, never reached the page - Chrome swallowed the press when the window was activated, the page saw the move and nothing else, and the second press landed.
  // So the page is asked to count the presses it receives, and a press the page did not take is sent again.
  // A press the page did take is never sent twice, so a page that answered once is not made to answer twice.

  let presses = null;

  const countPresses = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        if (!window.__operaPressListening) {
          window.__operaPressListening = true;
          window.__operaPressCount = 0;
          document.addEventListener('mousedown', () => { window.__operaPressCount += 1; }, true);
        }
        return window.__operaPressCount;
      })()`,
      returnByValue: true
    });
    const count = Number(result?.value);
    return Number.isFinite(count) ? count : null;
  };

  // WHY THE MOUSE GOES OUT WITH THE PAGE TOLD TO TAKE THE FOCUS.
  // Measured live on this machine: with the browser window behind another application, a click cost 5031 ms and the page never saw it - no mousedown, no mouseup, no click, and the field took no focus - while the answer still named the element under the point.
  // Chrome drops the press and the release for a window that is not in front, and it holds the move on a compositor that is not running.
  // Focus emulation makes the renderer take the mouse: the same click cost 25 ms, the page saw it, and the field took the focus.
  // The focus is given back right after, because the focus guard reads the truth about the window, and a page that believes it is focused forever would never hear that its window is on the taskbar.
  // A browser that does not know the command still gets the click, because a lost click is worse than a slow one.

  // WHY THE COUNT IS HERE.
  // The MCP server answers requests as they arrive, so two clicks on one tab can be on their way at the same time.
  // The first one to finish must not take the focus away from the second one, or that click never reaches the page.

  let mouseFocus = 0;

  const withMouseFocus = async (work) => {
    mouseFocus += 1;
    await cdp.send('Emulation.setFocusEmulationEnabled', {
      enabled: true
    }).catch(() => null);
    try {
      return await work();
    } finally {
      mouseFocus -= 1;
      if (mouseFocus === 0) {
        await cdp.send('Emulation.setFocusEmulationEnabled', {
          enabled: false
        }).catch(() => null);
      }
    }
  };

  async function clickAt(
    x,
    y
  ) {
    const px = Number(x);
    const py = Number(y);
    const view = await primitives.viewport().catch(() => null);
    if (view && view.width > 0 && view.height > 0
      && (px < 0 || py < 0 || px > view.width || py > view.height)) {
      const at = `${Math.round(px)},${Math.round(py)}`;
      const box = `${view.width}x${view.height}`;
      throw new Error(`click refused: ${at} is outside the ${box} viewport - scroll({text}) or scroll({y}) to bring it into view, then click again`);
    }
    const common = {
      x: px,
      y: py,
      button: 'left',
      clickCount: 1,
      buttons: 1
    };
    const press = async () => {
      await withMouseFocus(async () => {
        await Promise.all([
          spot(x, y, 'rgb(255,60,60)'),
          cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            buttons: 0
          }),
          cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            ...common
          }),
          cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...common
          })
        ]);
      });
    };
    if (presses === null) presses = await countPresses().catch(() => null);
    const baseline = presses;
    await press();
    let seen = await hitAt(x, y);

    // WHY A PRESS THE PAGE DID NOT TAKE IS SENT AGAIN.
    // Chrome swallows the first press after the browser window comes forward, and the answer that says which element was under the point would still name it.
    // The count says what the page received, so the press goes again - and a page that took the press is left alone.
    // A frame is left alone too: the press lands in the frame's own document, the count here never moves, and a second press would be a second click inside it.

    const framed = seen.hit?.tag === 'IFRAME';
    if (!framed && seen.presses !== null && seen.presses === baseline) {
      await press();
      seen = await hitAt(x, y);
    }
    presses = seen.presses;
    return {
      x,
      y,
      hit: seen.hit,
      pressed: seen.presses === null || framed ? null : seen.presses > baseline
    };
  }

  // WHY A CLICK TAKES A FRACTION AS WELL AS A PIXEL.
  // Measured live by resizing this machine's browser window: the viewport went 1144x714 to 1186x670 while the device scale stayed at 1.25, so the same CSS pixel stopped meaning the same place.
  // A fraction is resolved against the viewport as it is at the moment of the click, which survives that, and the answer says which pixels it became and in what space - so a caller that meant a fixed pixel still gets the truth about the space it landed in.

  async function clickFraction(at) {
    const view = await primitives.viewport();
    const asked = {
      x: Number(at?.x) || 0,
      y: Number(at?.y) || 0
    };
    const x = Math.round(Math.min(1, Math.max(0, asked.x)) * view.width);
    const y = Math.round(Math.min(1, Math.max(0, asked.y)) * view.height);
    const click = await clickAt(x, y);
    return {
      x,
      y,
      of: asked,
      pressed: click.pressed,
      viewport: {
        width: view.width,
        height: view.height
      },
      dpr: view.dpr
    };
  }

  async function hover(
    x,
    y
  ) {
    await withMouseFocus(async () => {
      await Promise.all([
        spot(x, y, 'rgb(66,133,244)'),
        cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
          buttons: 0
        })
      ]);
    });
    return {
      x,
      y
    };
  }

  // WHY A SUBMENU IS HOVERED AND NOT CLICKED.
  // Clicking a row that turns out to be a branch runs whatever it was — Delete, Remove, Send.
  // Hover opens the same submenu and activates nothing, so it is what the walker uses, and only a click is used when the caller says the item is a command.

  // WHY THE POINTER LEAVES FIRST.
  // Measured live: a submenu that would not open on hover opened once the pointer was sent somewhere else first and came back.
  // A menu that has never seen the pointer arrive from outside does not treat the hover as entering it, so the away-and-back is not politeness, it is the enter transition the menu is waiting for.

  async function hoverRow(row) {
    const away = {
      x: Math.max(2, row.x - 80),
      y: Math.max(2, row.y - 80)
    };
    await hover(away.x, away.y);
    await primitives.settle();
    const here = await primitives.handleBox(row.handle);
    await hover(here.x, here.y);
    await primitives.settle();
    return here;
  }

  // WHY A MENU ROW RESOLVES THE SAME WAY A SNAPSHOT ROW DOES.
  // Both are places on the screen that stop being true when the menu closes, so both are held on to as elements and measured again at the moment of the click.

  async function resolveHandle(row) {
    if (row.handle || row.node === undefined) return row;
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `window.__operaMenuNodes[${row.node}]`,
      returnByValue: false
    });
    if (!result?.objectId) return row;
    const described = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    const backendNodeId = described?.node?.backendNodeId;
    return backendNodeId ? {
      ...row,
      handle: HANDLE_PREFIX + backendNodeId
    } : row;
  }

  async function handleBox(handle) {
    const backendNodeId = Number(String(handle ?? '').replace(HANDLE_PREFIX, ''));
    if (!Number.isInteger(backendNodeId)) throw new Error(`"${handle}" is not an element handle.`);
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
    const quad = model?.content ?? model?.border;
    if (!Array.isArray(quad) || quad.length < 4) {
      throw new Error(`handle ${handle} is no longer in the page — resolve the row again`);
    }
    return centreOf(quad);
  }

  async function clickHandle(handle) {
    const at = await handleBox(handle);
    const owner = await ownershipAt(handle, at);
    const click = await clickAt(at.x, at.y);
    return {
      ...at,
      handle: String(handle),
      pressed: click.pressed,
      ...owner
    };
  }

  return {
    clickAt,
    clickFraction,
    hover,
    hoverRow,
    resolveHandle,
    handleBox,
    clickHandle
  };
}
