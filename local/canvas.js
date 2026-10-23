// @last-edited: 2026-10-23 UTC+7.
// @title: canvas — Google Docs reads and caret restore on a canvas editor.
// @state: read, caretLine, and the helpers that borrow and return the caret.
// @dependencies: ./page-expressions.js.

// WHY THIS MODULE EXISTS

// A Google Doc is not a page full of text.
// It is a canvas with a caret, so reading means borrowing the selection, copying it, and putting the caret back where it was.
// Keeping that dance here keeps primitives.js from owning a document editor's caret machinery.

import {
  CARET_TOLERANCE_PX,
  CARET_SCROLL_ATTEMPTS,
  DOCS_COPY_EXPRESSION,
  LOCAL_CARET_EXPRESSION,
  SCROLL_MARK,
  SELECTION_TEXT_EXPRESSION,
  isDocsDocument
} from './page-expressions.js';

export function createCanvasMethods({ cdp, primitives, sleep, readState }) {
  const caretHostExpression = `
    const drawn = (() => { ${LOCAL_CARET_EXPRESSION} })();
    if (drawn) return drawn;
    try {
      const sel = document.getSelection();
      if (sel && sel.rangeCount === 1 && sel.isCollapsed) return sel.getRangeAt(0).startContainer.parentElement;
    } catch { /* a range that will not hand over its node is simply no host */ }
    return null;`;

  const scrollChainExpression = `
    const chain = [];
    for (let el = host.parentElement; el; el = el.parentElement) {
      chain.push(el);
      if (el === document.documentElement) break;
    }
    return chain;`;

  // WHY THE BOXES THAT SCROLL ARE FOUND BY A MARK AND NOT BY THE CARET.
  // Measured live: while the whole document is selected the page draws no caret at all, so anything that walks up from the caret has nothing to walk up from - and the view stayed at the end of the document, putting the caret onto a picture.
  // The boxes are marked while the caret is still there to be measured, and the marks are taken off again as soon as the restore is done with them.
  const markedChainExpression = `
    return [...document.querySelectorAll('[${SCROLL_MARK}]')]
      .sort((a, b) => Number(a.getAttribute('${SCROLL_MARK}')) - Number(b.getAttribute('${SCROLL_MARK}')));`;

  const clearMarkExpression = `
    document.querySelectorAll('[${SCROLL_MARK}]').forEach((el) => el.removeAttribute('${SCROLL_MARK}'));`;

  const scrollSumExpression = `
    return chain.reduce((acc, el) => ({ x: acc.x + el.scrollLeft, y: acc.y + el.scrollTop }), { x: 0, y: 0 });`;

  const rememberCaret = async () => primitives.evaluate(`(() => {
    const host = (() => { ${caretHostExpression} })();
    if (!host) return null;
    const box = host.getBoundingClientRect();
    if (!box || (!box.width && !box.height)) return null;
    const chain = (() => { ${scrollChainExpression} })();
    (() => { ${clearMarkExpression} })();
    chain.forEach((el, i) => el.setAttribute('${SCROLL_MARK}', String(i)));
    const sum = (() => { ${scrollSumExpression} })();
    const y = Math.round(box.top + box.height / 2);
    return {
      x: Math.round(box.left),
      y,
      absX: Math.round(box.left + sum.x),
      absY: Math.round(y + sum.y),
      scroll: chain.map((el) => [el.scrollLeft, el.scrollTop])
    };
  })()`);

  const lost = (caretWhy, viewRestored = false) => ({ caretRestored: false, viewRestored, caretWhy });

  const putCaretBack = async (mark) => {
    if (!mark || !Array.isArray(mark.scroll)) return lost('the page showed no caret to remember');
    const pairs = JSON.stringify(mark.scroll.map(([x, y]) => [Number(x) || 0, Number(y) || 0]));
    const where = JSON.stringify([Number(mark.absX) || 0, Number(mark.absY) || 0]);
    let point = null;
    for (let attempt = 1; attempt <= CARET_SCROLL_ATTEMPTS; attempt += 1) {
      point = await primitives.evaluate(`(() => {
        const chain = (() => { ${markedChainExpression} })();
        const want = ${pairs};
        if (!chain.length || chain.length !== want.length) return { why: 'the page no longer has the boxes that were scrolling, so the place is not the one that was measured' };
        chain.forEach((el, i) => { el.scrollLeft = want[i][0]; el.scrollTop = want[i][1]; });
        const settled = chain.every((el, i) => el.scrollLeft === want[i][0] && el.scrollTop === want[i][1]);
        const now = (() => { ${scrollSumExpression} })();
        const mark = ${where};
        let x = Math.round(mark[0] - now.x);
        let y = Math.round(mark[1] - now.y);
        const inner = chain[0];
        if (inner && (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth)) {
          const dy = y < 0 ? y - 8 : Math.max(0, y - window.innerHeight + 8);
          const dx = x < 0 ? x - 8 : Math.max(0, x - window.innerWidth + 8);
          inner.scrollTop += dy;
          inner.scrollLeft += dx;
          x -= dx;
          y -= dy;
        }
        return { x, y, settled };
      })()`);
      if (point?.why) return lost(point.why);
      if (attempt > 1 && point.settled) break;
      await primitives.settle();
    }
    if (point.settled) await primitives.clickAt(point.x, point.y).catch(() => null);
    await primitives.settle();
    const seen = await primitives.evaluate(`(() => {
      const chain = (() => { ${markedChainExpression} })();
      const want = ${pairs};
      if (chain.length === want.length) {
        chain.forEach((el, i) => { el.scrollLeft = want[i][0]; el.scrollTop = want[i][1]; });
      }
      (() => { ${clearMarkExpression} })();
      const host = (() => { ${caretHostExpression} })();
      if (!host) return { why: 'the page showed no caret after the click' };
      const box = host.getBoundingClientRect();
      const sum = (() => { ${scrollSumExpression} })();
      return {
        absX: Math.round(box.left + sum.x),
        absY: Math.round(box.top + box.height / 2 + sum.y),
        settled: chain.every((el, i) => el.scrollLeft === want[i][0] && el.scrollTop === want[i][1])
      };
    })()`);
    if (!seen || seen.why) return lost(seen?.why ?? 'the page lost the caret again', point.settled);
    const same = Math.abs(seen.absX - mark.absX) <= CARET_TOLERANCE_PX
      && Math.abs(seen.absY - mark.absY) <= CARET_TOLERANCE_PX;
    if (!same) {
      return lost(point.settled
        ? 'the caret is not where it was left, so the click did not take'
        : 'the view did not go back where it was, so the place no longer holds the caret', point.settled && seen.settled);
    }
    return { caretRestored: true, viewRestored: seen.settled, caretWhy: '' };
  };

  const copyDocsText = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: DOCS_COPY_EXPRESSION,
      returnByValue: true
    });
    return typeof result?.value === 'string' ? result.value : null;
  };

  const focusDocsCanvas = async () => {
    const point = await primitives.evaluate(`(() => {
      const tile = document.querySelector('.kix-canvas-tile-content');
      if (!tile) return null;
      const r = tile.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(150, r.height / 2)) };
    })()`);
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      await primitives.clickAt(point.x, point.y);
    } else {
      const { width } = await primitives.viewport();
      await primitives.clickAt(Math.round(width * 0.45), 200);
    }
  };

  const readDocsText = async () => {
    try {
      await primitives.key('a', ['Control']);
      await sleep(150);
      let text = await copyDocsText();
      if (text === '') {
        await focusDocsCanvas();
        await primitives.key('a', ['Control']);
        await sleep(150);
        text = await copyDocsText();
      }
      return text;
    } finally {
      await primitives.key('End').catch(() => null);
    }
  };

  async function read() {
    const state = await readState();
    if (!isDocsDocument(state.url)) {
      await primitives.settle();
      const again = await readState();
      return {
        title: again.title,
        url: again.url,
        text: again.text,
        ready: again.ready ?? null,
        settled: again.text === state.text,
        grewBy: again.text.length - state.text.length,
        caretMoved: false,
        caretRestored: true,
        viewRestored: true,
        caretWhy: ''
      };
    }
    const mark = await rememberCaret();
    const text = await readDocsText();
    const back = await putCaretBack(mark);

    // WHY settled IS UNKNOWN HERE RATHER THAN GUESSED.
    // This text comes from a selection copy, and asking whether it has stopped changing would mean a second copy - another select-all and another caret move, on the one path where a caret move is the expensive thing.
    // So the read reports what it did not measure, and names the cost of measuring it.
    return {
      ...state,
      text: text ?? state.text,
      ready: state.ready ?? null,
      settled: null,
      settledWhy: 'the text came from a selection copy; a second copy would move the caret twice, so read again after wait_still() or take capture_page() as the proof',
      caretMoved: true,
      ...back
    };
  }

  async function caretLine() {
    const { url } = await readState();
    const mark = await rememberCaret();
    await primitives.key('Home');
    await primitives.settle();
    await primitives.key('End', ['Shift']);
    await primitives.settle();
    const line = isDocsDocument(url) ? await copyDocsText() : await primitives.evaluate(SELECTION_TEXT_EXPRESSION);
    await primitives.key('End').catch(() => null);
    const back = await putCaretBack(mark);
    return { line: typeof line === 'string' ? line : '', caretMoved: true, ...back };
  }

  return { read, caretLine };
}