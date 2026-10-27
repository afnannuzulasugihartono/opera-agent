// @last-edited: 2026-10-27 UTC+7.
// @title: canvas — the reads a surface that is not a page full of text can answer, and the guard in front of the one that moves a caret.
// @state: the ladder walk for read, the caret line read, and the generic selection copy they share.
// @dependencies: ./page-expressions.js, ./surface-profile.js, ./caret-guard.js, ./read-strategy.js.

// WHY THIS MODULE EXISTS

// A canvas surface is not a page full of text, so reading it is a different question from reading a DOM page.
// This module asks that question: it measures what the surface is, walks the ladder of reads in the order the measurement justifies, and puts a gate in front of the one read that costs the user something.
// What used to live here was one site's answer to that question, written as that site's selectors; what lives here now is the question.

// WHY THE READ WALKS A LADDER INSTEAD OF ASKING THE URL.
// The read this replaces recognised one site by its address and then ran that site's clipboard trick on it, which is why every other canvas page came back empty.
// A profile measured from the page itself says which reads are available and what each costs, and the ladder is walked in that order.
// The step that moves a caret is gated, because the measurement behind it showed a canvas caret cannot be put back.

// WHY ONLY AN EDITABLE CANVAS VETOES THE DOM STEP.
// A canvas editor keeps its chrome in the DOM and its document in pixels, so reading the DOM would answer with the chrome and stop.
// A canvas without an editable host is a picture beside text - a chart, a map, a viewer - and the text around it is the page's own text, so vetoing that read throws away the only text there is.

// WHY THE DOM READ TAKES TWO SAMPLES.
// readyState lies: measured live, a page reported complete with a tenth of its text and reached the rest 600ms later.
// So the read settles and looks again, and answers with whether the text stood still and by how much it grew.

// WHY THE CONSENT IS ASKED BEFORE THE SELECTION IS BORROWED.
// The borrow is the destructive half of this read, and a caller who did not ask for it must not pay for it.
// The caret verdict rides along whatever the copy returned, so a caller learns what the read cost even when it succeeded.

// WHY THE ACCESSIBILITY TREE IS MEASURED ONLY WHEN IT CAN REORDER THE LADDER.
// Measured on the owner's profile: a full accessibility tree answers a canvas document in 19-30ms, and one innerText answers an ordinary page in a single call.
// On a page with no canvas the DOM leads whatever the tree holds, so the tree is paid for there only when the DOM answers nothing.
// A profile call still measures both halves: it is the answer to "what is this", and that answer is worth the round trip.

// WHY AN EMPTY COPY IS NOT AN EMPTY DOCUMENT.
// A canvas editor that selects and copies nothing either has an empty document or a mirror that did not fill, and the two are not the same thing.
// Reporting the empty string as the read would call both of them an empty page, so the ladder continues to the picture and the caret cost stays in the answer.

import { SELECTION_STATE_EXPRESSION } from './page-expressions.js';
import { probeSurface, measureAx, buildProfile, describeProfile } from './surface-profile.js';
import { createCaretGuard, gateRead } from './caret-guard.js';
import {
  HARM_NONE,
  STRATEGY_AX,
  STRATEGY_DOM,
  STRATEGY_SELECT_ALL,
  STRATEGY_VISION,
  readLadder
} from './read-strategy.js';

const VIEW_WHY = 'the borrow selected the whole document, so the view is left where the selection ended; the caret verdict says whether the caret itself came back';

export function createCanvasMethods({ cdp, primitives, readState }) {
  // WHY THE COPY READS THE SELECTION AND NOT A SITE'S CLIPBOARD TRICK.
  // The expression this replaces found one site's hidden editable frame by name, asked it to fill itself on a copy event, and stripped the invisible characters that site inserts - which is per-site code, and it is gone.
  // What is left is the technique without the site: borrow the selection, then read it back from whichever frame holds it.
  // A surface that mirrors its text through the selection answers; a surface that holds its text as pixels does not, and that is reported rather than papered over.
  // It reads the same expression the caret guard reads, so the text and the caret verdict come from one frame rather than from two that may not be the same.

  const copySelection = async () => {
    const state = await primitives.evaluate(SELECTION_STATE_EXPRESSION);
    const text = state && typeof state.text === 'string' ? state.text : '';
    return text.length > 0 ? text : null;
  };

  const guard = createCaretGuard({ evaluate: primitives.evaluate });

  let measured = null;
  const axOf = async () => {
    if (!measured) measured = await measureAx({ ask: primitives.ask });
    return measured;
  };

  // WHY THE REGION TEXT IS RETURNED EVEN WHEN THE TREE IS THIN.
  // The rich bar decides which read leads, not whether a text is worth returning.
  // On a page with no canvas the DOM has already answered nothing, so the tree is the only text there is; on a canvas page a thin region is the chrome around the picture, and returning it would name the menu as the document.
  const readAxText = (ax, surface) => {
    const text = String(ax?.documentText || '');
    if (text.trim().length === 0) return null;
    if (ax.axRich === true || surface.canvas !== true) return text;
    return null;
  };

  const guardedSelectAll = async (allowCaretMove) => {
    const mark = await guard.remember();
    if (mark.restorable !== true && allowCaretMove !== true) return null;
    await primitives.key('a', ['Control']);
    await primitives.settle();
    const copied = await copySelection();
    await primitives.key('End').catch(() => null);
    const caret = await guard.verdict(mark);
    return { text: copied ?? '', caret };
  };

  // The caret fields a read that never borrowed carries, and the ones a read that did carries, kept in one place so no answer can claim more than it measured.
  const untouched = { caretMoved: false, caretRestored: true, viewRestored: true, caretWhy: '', viewWhy: '' };
  const afterBorrow = (borrow) => borrow === null
    ? untouched
    : {
      caretMoved: true,
      caretRestored: borrow.caret.restored,
      viewRestored: false,
      caretWhy: borrow.caret.why,
      viewWhy: VIEW_WHY
    };

  async function read(options = {}) {
    const allowCaretMove = options.allowCaretMove === true;
    const probe = await probeSurface({ evaluate: primitives.evaluate });
    const ax = probe.canvas?.value === true ? await axOf() : {};
    const surface = buildProfile({ probe, ax });
    const ladder = readLadder(surface);
    const skipped = [];
    let borrow = null;

    for (const step of ladder) {
      if (step.harm !== HARM_NONE) {
        const gate = gateRead({ harm: step.harm, allowCaretMove });
        if (!gate.allowed) {
          skipped.push({ strategy: step.strategy, harm: step.harm, why: gate.why });
          continue;
        }
      }

      if (step.strategy === STRATEGY_DOM) {
        if (surface.canvas === true && surface.editable === true) continue;
        const state = await readState();
        if ((state.text || '').trim().length > 0) {
          await primitives.settle();
          const again = await readState();
          return {
            title: again.title,
            url: again.url,
            text: again.text,
            ready: again.ready ?? null,
            settled: again.text === state.text,
            grewBy: again.text.length - state.text.length,
            surface,
            strategy: step.strategy,
            harm: step.harm,
            skipped,
            description: describeProfile(surface),
            ...untouched
          };
        }
        continue;
      }

      if (step.strategy === STRATEGY_AX) {
        const text = readAxText(await axOf(), surface);
        if (text) {
          // The title and url are one cheap call the caller expects on every read; whether the text has stopped moving is not something one sample of the tree can answer.
          const state = await readState();
          return {
            title: state.title,
            url: state.url,
            text,
            ready: state.ready ?? null,
            settled: null,
            settledWhy: 'this read sampled the accessibility tree once, so it can say what the text is and not that it stopped moving; wait_still() is the proof of that',
            surface,
            strategy: step.strategy,
            harm: step.harm,
            skipped,
            description: describeProfile(surface),
            ...untouched
          };
        }
        continue;
      }

      if (step.strategy === STRATEGY_SELECT_ALL) {
        const answer = await guardedSelectAll(allowCaretMove);
        if (answer) {
          borrow = { caret: answer.caret, text: answer.text };
          if (answer.text.length > 0) {
            return {
              title: '',
              url: '',
              text: answer.text,
              caret: answer.caret,
              surface,
              strategy: step.strategy,
              harm: step.harm,
              skipped,
              description: describeProfile(surface),
              settled: null,
              settledWhy: 'the text came from a selection copy; a second copy would move the caret twice, so read again after wait_still() or take capture_page() as the proof',
              ...afterBorrow(borrow)
            };
          }
          skipped.push({ strategy: step.strategy, harm: step.harm, why: 'the selection answered no text, which is not the same as an empty document; the ladder continues to the picture' });
          continue;
        }
        skipped.push({ strategy: step.strategy, harm: step.harm, why: 'the caret could not be remembered, so the borrow was refused' });
        continue;
      }

      if (step.strategy === STRATEGY_VISION) {
        // The driver does not read pixels, and does not pretend to: it names the one tool that returns a picture, so the caller decides rather than receiving an empty string that looks like an empty page.
        return {
          title: '',
          url: '',
          text: '',
          surface,
          strategy: step.strategy,
          harm: step.harm,
          skipped,
          description: describeProfile(surface),
          visionWhy: 'this surface offers no text to any read that asks nothing of it; call capture_page for the picture',
          ...afterBorrow(borrow)
        };
      }
    }

    return {
      title: '',
      url: '',
      text: '',
      surface,
      strategy: 'none',
      harm: HARM_NONE,
      skipped,
      description: describeProfile(surface),
      visionWhy: 'every read this surface offers was skipped; call capture_page for the picture',
      ...afterBorrow(borrow)
    };
  }

  // WHY THE LINE IS READ FROM THE SELECTION FIRST.
  // This read used to ask the url whether the page was a document editor and then chose the clipboard for it, which is the site recognition this change removes.
  // The selection is the cheaper answer and works wherever the page holds its text; the selection copy is the fallback for a surface whose mirror only holds what a selection put there, and which one is needed is a question the page answers.
  // The verdict rides along, so a caret this read could not put back is reported rather than assumed.
  async function caretLine() {
    const mark = await guard.remember();
    await primitives.key('Home');
    await primitives.settle();
    await primitives.key('End', ['Shift']);
    await primitives.settle();
    let line = await copySelection();
    await primitives.key('End').catch(() => null);
    const back = await guard.verdict(mark);
    return {
      line: typeof line === 'string' ? line : '',
      caretMoved: true,
      caretRestored: back.restored,
      viewRestored: false,
      caretWhy: back.why,
      viewWhy: VIEW_WHY
    };
  }

  return { read, caretLine };
}
