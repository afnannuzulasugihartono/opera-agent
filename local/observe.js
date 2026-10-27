// @last-edited: 2026-10-23 UTC+7.
// @title: observe — what the page says about itself, read in as few round trips as it can be read in.
// @state: snapshot, resolveRow, menuTree, openMenu, computed, scroll, viewport, capture and the two page-state reads.
// @dependencies: ./menu-tree.js, ./page-expressions.js.

// WHY THIS MODULE EXISTS

// A canvas page exposes no DOM worth querying, so every fact about it is an expression run inside the page and an answer read back.
// Keeping those reads together means the round trips they cost are counted in one place, and a read that grows a second job is visible as a file growing a second job.

// A snapshot names what can be clicked.
// A canvas page exposes no DOM worth querying, but Blink computes an accessibility tree for every rendered page, and every node in it resolves to a box.
// Reading role, name and center together turns "click the Insert menu" from a remembered coordinate into one fresh call.

// A capture is one pixel per clickable coordinate.
// Taken at device pixels on a HiDPI screen a picture comes back larger than the clickable viewport, so a coordinate read off it and sent as CSS pixels lands a quarter of the way off: that is what put a click meant for A1 into A3 on a 1.25 screen.
// Every capture is therefore clipped to the viewport at scale 1, which is the same space clickAt speaks, so looking at a picture and clicking what is in it is true.

// WHY AN ACTION'S PAGE STATE IS MEASURED AND NOT COPIED.
// Measured on a real job: eight calls spent 34,974 characters, most of it the same sixty rows and the same page text riding along after every click.
// An agent does not read that; it pays for it in tokens and in attention.
// So an action reports where the page is and what moved - url, title, how much text it holds, which element has focus - and the rows that changed.
// The rest stays one deliberate ax_snapshot away.

// WHY THE TEXT IS COUNTED AND NOT RETURNED.
// The count answers "did this action change what the page says", which is the question an action's answer owes.
// The words themselves belong to read_page, where the caller asked for them.

import { findNode, menuTreeExpression, nearestNames, revealOf, stateOf } from './menu-tree.js';
import {
  HANDLE_PREFIX,
  PAGE_STATE_TEXT_EXPRESSION,
  computedExpression,
  imageSize,
  scrollExpression,
  snapshotExpression
} from './page-expressions.js';

// WHY THE VIEWPORT IS READ FROM THE PAGE AND NOT FROM THE PROTOCOL.
// The click space is CSS pixels, and the page is the only place that number is true: a protocol read of the same window answers device pixels on a HiDPI screen.
// Measured live by resizing this machine's window: the viewport moved 1144x714 -> 1186x670 while the capture moved with it, so the two have to be read together or a click aimed at a picture lands a quarter of the way off.

const VIEWPORT_EXPRESSION = `({
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio
})`;

// WHY THE FOCUS IS NAMED AND NOT COUNTED.
// An action's answer has to say whether the page is listening, and "the page holds 4,200 characters" says nothing about that.
// What an agent needs is which element has focus and whether it takes text, because a keystroke sent to a button goes nowhere and answers ok.
// The name is trimmed to sixty characters: the point is to recognise the field, not to read its whole label into an answer that already costs tokens.

const PAGE_STATE_EXPRESSION = `(() => {
  const body = document.body ? document.body.innerText : '';
  const active = document.activeElement;
  let focus = null;
  if (active && active !== document.body) {
    const name = (active.getAttribute('aria-label')
      || active.getAttribute('placeholder')
      || active.getAttribute('title')
      || active.innerText
      || active.textContent
      || '').trim();
    focus = {
      tag: active.tagName,
      role: active.getAttribute('role') || '',
      name: name.slice(0, 60)
    };
  }
  return { url: location.href, title: document.title, textChars: body.length, focus };
})()`;

// WHY THE SCROLL'S VERDICT IS A FUNCTION AND NOT A TERNARY.
// Four questions decide what a scroll has to say for itself, and they are not equally likely: a target that was never found, a page that cannot prove it reached the end, a page that plainly did not move, and the ordinary case where it did.
// Written as one nested ternary inside the answer object, the ordinary case was the last line of a four-deep expression, so the reader reached it only after parsing the three failures first.
// Named cases read in the order they are checked, and each one says what the caller should do next.

function scrollWhy({ seen, wanted, end }) {
  if (wanted && !seen.target?.found) {
    const named = JSON.stringify(String(wanted).slice(0, 40));
    return `found nothing on this page for ${named} - read_page() to see what the page holds`;
  }
  if (end && !seen.atEnd) {
    if (seen.exhausted) {
      return `${seen.root} is as far as it goes, and this page cannot show that its last words are on screen - the text it reports is not the text it draws, so capture_page() or read_page() is the proof`;
    }
    return `moved ${seen.movedPx} of the way and the page still has text below`;
  }
  if (!seen.movedPx && !seen.target?.visible) {
    return `nothing moved: ${seen.root} had no room to move (travelPx ${seen.travelPx ?? 'unknown'})`;
  }
  return '';
}

export function createObserveMethods({ cdp, primitives, capped }) {
  const readRows = async (limit) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: snapshotExpression(limit),
      returnByValue: true,
      awaitPromise: false
    });
    return Array.isArray(result?.value) ? result.value : [];
  };

  const readState = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PAGE_STATE_TEXT_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { title: '', url: '', text: '' };
  };

  const pageState = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PAGE_STATE_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { url: '', title: '', textChars: 0, focus: null };
  };

  async function viewport() {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: VIEWPORT_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { width: 0, height: 0, dpr: 1 };
  }

  // WHY A CAPTURE ANSWERS WITH THE SPACE IT WAS TAKEN IN.
  // Measured live by resizing this machine's browser window: the viewport went 1144x714 -> 1186x670 and the capture went 1430x963 -> 1483x838, with the scale factor constant at 1.25.
  // So the picture is the CSS viewport times the device's scale, and both move under the agent's feet: a window resized, a window dragged to a monitor with another scale.
  // An agent given a picture and nothing else has to guess that number, and it guesses wrong - which is how a click lands on the wrong thing while every answer says the click was delivered.
  async function captureSized({ format = 'jpeg', quality = 60, fullPage = false } = {}) {
    const view = await viewport();
    const data = await capture({ format, quality, fullPage });
    const pixels = await imageSize(data, format);
    return {
      data,
      viewport: { width: view.width, height: view.height },
      dpr: view.dpr,
      image: pixels,
      note: fullPage
        ? 'a full-page capture is the whole document, not the window: convert through the page, not the viewport'
        : `image pixels are css pixels times ${view.dpr}`
    };
  }

  async function capture({ format = 'jpeg', quality = 60, fullPage = false } = {}) {
    if (fullPage) {
      const metrics = await cdp.send('Page.getLayoutMetrics', {});
      const content = metrics?.contentSize ?? {};
      const width = Number(content.width);
      const height = Number(content.height);
      if (!(width > 0 && height > 0)) throw new Error('Full-page capture needs a content size the page did not report.');
      const scale = Math.min(1, 1600 / width, 2400 / height);
      const { data } = await cdp.send('Page.captureScreenshot', {
        format,
        quality,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale }
      });
      return data;
    }
    const { width, height } = await viewport();
    const { data } = await cdp.send('Page.captureScreenshot', {
      format,
      quality,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    });
    return data;
  }

  async function resolveRow({ role, name, limit = 120 } = {}) {
    const rows = await readRows(capped(limit));
    const want = String(name ?? '').toLowerCase();
    const row = rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase() === want)
      ?? rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase().includes(want));
    if (!row) {
      const visible = rows.filter((r) => r.role === role).map((r) => r.name).slice(0, 12).join(' | ');
      throw new Error(`no ${role} matching "${name}". Visible: ${visible}`);
    }
    if (row.node === undefined) return { ...row, handle: null };
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `window.__operaNodes[${row.node}]`,
      returnByValue: false
    });
    if (!result?.objectId) return { ...row, handle: null };
    const described = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    const backendNodeId = described?.node?.backendNodeId;
    return { ...row, handle: backendNodeId ? HANDLE_PREFIX + backendNodeId : null };
  }

  async function snapshot({ limit = 120 } = {}) {
    const rows = await readRows(capped(limit));
    return rows.map(({ node, ...row }) => row);
  }

  async function menuTree({ limit } = {}) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: menuTreeExpression(limit),
      returnByValue: true,
      awaitPromise: false
    });
    const rows = Array.isArray(result?.value) ? result.value : [];
    return rows.map((row) => ({ ...row, state: stateOf(row), revealedBy: revealOf(row), handle: null }));
  }

  async function openMenu({ path = [], clickLeaf = false, limit, timeoutMs = 8000 } = {}) {
    const wanted = path.map((step) => String(step ?? '').trim()).filter(Boolean);
    if (wanted.length === 0) return { opened: false, at: [], tree: await menuTree({ limit }) };
    let rows = await menuTree({ limit });
    const at = [];
    for (let index = 0; index < wanted.length; index += 1) {
      const name = wanted[index];
      const last = index + 1 === wanted.length;
      const deadline = Date.now() + timeoutMs;
      let node = findNode(name, rows.filter((row) => row.depth === index));
      let here = rows.filter((row) => row.depth === index);
      while (!node && Date.now() < deadline) {
        await primitives.waitForRow({ role: 'menuitem', name, timeoutMs: 400, intervalMs: 120 });
        rows = await menuTree({ limit });
        here = rows.filter((row) => row.depth === index);
        node = findNode(name, here);
      }
      if (!node) {
        const levelNames = [...new Set(here.map((row) => row.name))];
        return {
          opened: false,
          at,
          brokeAt: name,
          level: index,
          visible: levelNames.slice(0, 20),
          nearest: nearestNames(name, levelNames),
          tree: rows
        };
      }
      at.push(node.name);
      const row = await primitives.resolveHandle(node);
      const alreadyOpen = Boolean(node.expanded) && here.some((r) => r.depth === index + 1);
      let acted = false;
      if (!alreadyOpen) {
        // WHY A TOP-LEVEL MENU IS CLICKED AND EVERYTHING BELOW IT IS HOVERED.
        // Measured live on Google Docs: a menu on the bar is a toggle - hover does nothing and it only opens on a click - while a submenu opens on hover.
        // And a leaf that turns out to be a command is never clicked on the way to anywhere else: "Upload from computer" opens the operating system's own file dialog, which nothing here can close again.
        // So a click goes out for the bar item that opens the menu, and for a leaf only when the caller said this item is the command to run.
        if (index === 0) {
          await primitives.clickAt(row.x, row.y);
          acted = true;
        } else if (node.branch) {
          await primitives.hoverRow(row);
        } else if (last && clickLeaf) {
          await primitives.clickAt(row.x, row.y);
          acted = true;
        }
        const hoverAgain = index > 0 && node.branch;
        const childDeadline = Date.now() + timeoutMs;
        for (;;) {
          rows = await menuTree({ limit });
          if (rows.some((found) => found.depth === index + 1) || Date.now() >= childDeadline) break;
          if (hoverAgain) await primitives.hoverRow(row);
          await primitives.settle();
        }
      } else {
        rows = await menuTree({ limit });
      }
      if (last) {
        return { opened: true, at, acted, row: findNode(name, rows.filter((r) => r.depth === index)) ?? node, tree: rows };
      }
    }
    return { opened: true, at, acted, tree: rows };
  }

  // WHY ONE CALL, AND WHY IT ANSWERS WHAT IT DID.
  // A scroll that moved the page and a scroll that moved the right thing look identical from outside, so the answer carries the scroller that moved and by how much, and - for a target - whether that target is on screen now.
  // Nothing here is aimed for: every fact is read after the fact.

  // WHY "AT THE END" CAN BE FALSE AND MEANS NOTHING MOVED.
  // Measured live on a Google Doc: an end scroll moved the document element 56 pixels and answered atEnd true, because the document is not what scrolls on a canvas editor.
  // So atEnd is true only when the page reports its last text on screen, and the scroller that answers is named - a refusal to claim an end it did not reach is the whole value here.
  async function scroll({ y, end = false, text, selector } = {}) {
    const probe = { y: Number.isFinite(Number(y)) ? Number(y) : undefined, end: end === true, text, selector };
    void end;
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: scrollExpression(probe),
      returnByValue: true
    });
    const seen = result?.value ?? {
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      scroller: { name: 'unknown', from: 0, to: 0 },
      movedPx: 0,
      atEnd: false,
      root: 'unknown',
      target: { found: false, visible: false, y: 0, text: '' }
    };
    const wanted = text ?? selector;
    return {
      from: seen.from,
      to: seen.to,
      scroller: seen.scroller,
      movedPx: seen.movedPx,
      atEnd: seen.atEnd === true,
      travelPx: seen.travelPx ?? null,
      root: seen.root,
      target: seen.target,
      why: scrollWhy({ seen, wanted, end })
    };
  }

  async function computed({ x, y, selector } = {}) {
    const probe = {
      selector: selector ?? undefined,
      x: Number.isFinite(Number(x)) ? Number(x) : undefined,
      y: Number.isFinite(Number(y)) ? Number(y) : undefined
    };
    if (!probe.selector && (probe.x === undefined || probe.y === undefined)) {
      throw new Error('computed needs a selector, or an x and a y inside the viewport');
    }
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: computedExpression(probe),
      returnByValue: true
    });
    const seen = result?.value ?? null;
    if (!seen) {
      return {
        found: false,
        why: probe.selector
          ? `no element on this page matches ${JSON.stringify(String(selector).slice(0, 40))}`
          : `nothing at ${probe.x},${probe.y} - ax_snapshot() to see what is on screen`
      };
    }
    return { found: true, ...seen };
  }

  return {
    readRows,
    readState,
    pageState,
    viewport,
    capture,
    captureSized,
    resolveRow,
    snapshot,
    menuTree,
    openMenu,
    scroll,
    computed
  };
}
