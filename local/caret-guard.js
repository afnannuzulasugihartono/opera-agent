// @last-edited: 2026-10-27 UTC+7.
// @title: caret-guard — the gate in front of a read that moves a caret, and the verdict that never claims a restore it did not measure.
// @state: the gate, the restorability rule, the verdict, and one factory that drives the DOM with injected primitives.
// @dependencies: ./read-strategy.js.

// WHY THE GATE AND THE DRIVER ARE THE SAME FILE.
// They answer one question from two sides: may this read run, and did it leave the page as it found it.
// Splitting them would let a caller pass the gate and then ignore the verdict, which is the exact failure this module exists to prevent.

// WHY A CANVAS CARET IS NOT RESTORABLE.
// Measured on a real Google Doc through CDP: the editor iframe's selection reads offset 0 on a node with no text, and it reads the same after Home and after End.
// The application holds the caret in its own model and the DOM does not carry it, so a promise to put it back would be a promise the DOM cannot keep.

// WHY THE SELECTION IS READ THROUGH EVERY FRAME.
// A canvas editor keeps its document in an iframe, and the selection that matters is the one inside it.
// Reading only the top document is what made the old restore report failure on a page that plainly had a caret.

import { HARM_CARET_MOVE, HARM_NONE } from './read-strategy.js';

const CARET_HOST_EXPRESSION = `(() => {
  const frames = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  for (const doc of frames) {
    let sel = null;
    try { sel = doc.getSelection ? doc.getSelection() : null; } catch { continue; }
    if (!sel || sel.rangeCount === 0) continue;
    const node = sel.getRangeAt(0).startContainer;
    const host = node.nodeType === 3 ? node.parentElement : node;
    if (!host) continue;
    return {
      rangeCount: sel.rangeCount,
      collapsed: sel.isCollapsed,
      anchorOffset: sel.anchorOffset,
      hostTextLength: String(node.textContent || '').length
    };
  }
  return { rangeCount: 0, collapsed: null, anchorOffset: 0, hostTextLength: 0 };
})()`;

export function rememberedState(selection = {}) {
  const hostTextLength = Number(selection.hostTextLength) || 0;
  const anchorOffset = Number(selection.anchorOffset) || 0;
  const restorable = Number(selection.rangeCount) > 0 && hostTextLength > 0;
  return {
    restorable,
    anchorOffset,
    hostTextLength,
    why: restorable
      ? 'the selection names a position inside a node that holds text'
      : 'the selection carries no position inside any text, so there is nothing to put back'
  };
}

export function gateRead({ harm = HARM_NONE, allowCaretMove = false } = {}) {
  if (harm === HARM_NONE) return { allowed: true, why: 'this read asks nothing of the page' };
  if (harm === HARM_CARET_MOVE) {
    return allowCaretMove === true
      ? { allowed: true, why: 'the caller recorded consent on this call' }
      : { allowed: false, why: 'this read moves the caret, and no consent was recorded on the call' };
  }
  return { allowed: false, why: 'this read changes content and is not a read' };
}

export function restoreVerdict({ before, after } = {}) {
  if (!before || before.restorable !== true) {
    return { restored: false, why: before?.why || 'there was no restorable position to return to' };
  }
  const same = before.anchorOffset === after?.anchorOffset && before.hostTextLength === after?.hostTextLength;
  return same
    ? { restored: true, why: 'the selection is where it was left' }
    : { restored: false, why: 'the selection is not where it was left, so the restore did not take' };
}

export function createCaretGuard({ evaluate, key, settle }) {
  const remember = async () => {
    const selection = await evaluate(CARET_HOST_EXPRESSION);
    return { ...rememberedState(selection), selection };
  };

  const verdict = async (mark) => {
    const after = await evaluate(CARET_HOST_EXPRESSION);
    return restoreVerdict({ before: mark, after });
  };

  return { remember, verdict };
}
