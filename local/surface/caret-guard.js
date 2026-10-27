// @last-edited: 2026-10-27 UTC+7.
// @title: caret-guard — the gate in front of a read that moves a caret, and the verdict that never claims a restore it did not measure.
// @state: the gate, the restorability rule, the verdict, and one factory that drives the DOM with injected primitives.
// @dependencies: page-expressions, read-strategy.

// WHY THE GATE AND THE DRIVER ARE THE SAME FILE.
// They answer one question from two sides: may this read run, and did it leave the page as it found it.
// Splitting them would let a caller pass the gate and then ignore the verdict, which is the exact failure this module exists to prevent.

// WHY A CANVAS CARET IS NOT RESTORABLE.
// Measured on a real Google Doc through CDP: the editor iframe's selection reads offset 0 on a node with no text, and it reads the same after Home and after End.
// The application holds the caret in its own model and the DOM does not carry it, so a promise to put it back would be a promise the DOM cannot keep.

// WHY THE SELECTION IS READ THROUGH EVERY FRAME, BY ONE EXPRESSION.
// A canvas editor keeps its document in an iframe, and the selection that matters is the one inside it.
// Reading only the top document is what made the old restore report failure on a page that plainly had a caret.
// The expression that reads it is shared with the copy, so both answer from the same frame.

import { SELECTION_STATE_EXPRESSION } from '../drive/page-expressions.js';
import { HARM_CARET_MOVE, HARM_NONE } from './read-strategy.js';

// WHY A MISSING ANSWER IS A STATE AND NOT A CRASH.
// The expression runs in a page that may have navigated, or may refuse the evaluation, and a read that throws on a null answer takes the whole drive down over a question it could have answered with "there was nothing to remember".

export function rememberedState(selection) {
  const seen = selection && typeof selection === 'object' ? selection : {};
  const hostTextLength = Number(seen.hostTextLength) || 0;
  const anchorOffset = Number(seen.anchorOffset) || 0;
  const hostPath = typeof seen.hostPath === 'string' ? seen.hostPath : '';
  const restorable = Number(seen.rangeCount) > 0 && hostTextLength > 0;
  return {
    restorable,
    hostPath,
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
  const same = before.hostPath === after?.hostPath
    && before.anchorOffset === after?.anchorOffset
    && before.hostTextLength === after?.hostTextLength;
  return same
    ? { restored: true, why: 'the selection is where it was left' }
    : { restored: false, why: 'the selection is not where it was left, so the restore did not take' };
}

// WHY THE DRIVER IS ASKED FOR ONE THING.
// The guard only ever reads the page: the expression it runs measures the caret and nothing else, and the caller decides what to type.
// Taking the input primitives here would let a caller believe the guard puts the caret back, which is the claim the measurement already disproved.

export function createCaretGuard({ evaluate }) {
  const remember = async () => {
    const selection = await evaluate(SELECTION_STATE_EXPRESSION);
    return { ...rememberedState(selection), selection };
  };

  const verdict = async (mark) => {
    const after = await evaluate(SELECTION_STATE_EXPRESSION);
    return restoreVerdict({ before: mark, after });
  };

  return { remember, verdict };
}
