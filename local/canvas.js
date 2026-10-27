// @last-edited: 2026-10-27 UTC+7.
// @title: canvas — the reads a surface that is not a page full of text can answer, and the guard in front of the one that moves a caret.
// @state: the ladder walk for read, the caret line read, and the generic selection copy they share.
// @dependencies: ./page-expressions.js, ./surface-profile.js, ./caret-guard.js.

// WHY THIS MODULE EXISTS

// A canvas surface is not a page full of text, so reading it is a different question from reading a DOM page.
// This module asks that question: it measures what the surface is, walks the ladder of reads in the order the measurement justifies, and puts a gate in front of the one read that costs the user something.
// What used to live here was one site's answer to that question, written as that site's selectors; what lives here now is the question.

// WHY THE READ WALKS A LADDER INSTEAD OF ASKING THE URL.
// The read this replaces recognised one site by its address and then ran that site's clipboard trick on it, which is why every other canvas page came back empty.
// A profile measured from the page itself says which reads are available and what each costs, and the ladder is walked in that order.
// The step that moves a caret is gated, because the measurement behind it showed a canvas caret cannot be put back.

// WHY A CANVAS SURFACE NEVER REACHES THE DOM STEP.
// A canvas editor keeps real text in the DOM around its canvas, so reading it would answer with the chrome and stop.
// The ladder has already put the accessibility tree ahead of this step for such a page, and the guard in the step is what stops a poor tree from falling back onto the chrome.

// WHY THE DOM READ TAKES TWO SAMPLES.
// readyState lies: measured live, a page reported complete with a tenth of its text and reached the rest 600ms later.
// So the read settles and looks again, and answers with whether the text stood still and by how much it grew.

// WHY THE CONSENT IS ASKED BEFORE THE SELECTION IS BORROWED.
// The borrow is the destructive half of this read, and a caller who did not ask for it must not pay for it.
// The caret verdict rides along whatever the copy returned, so a caller learns what the read cost even when it succeeded.

import { SELECTION_TEXT_EXPRESSION } from './page-expressions.js';
import { SURFACE_PROBE_EXPRESSION, MIN_DOM_TEXT, measureAx, buildProfile, describeProfile } from './surface-profile.js';
import { createCaretGuard, gateRead } from './caret-guard.js';

export function createCanvasMethods({
  cdp,
  primitives,
  readState,
  readLadder,
  describeProfile,
  measureAx,
  buildProfile
}) {
  // WHY THE COPY READS THE SELECTION AND NOT A SITE'S CLIPBOARD TRICK.
  // The expression this replaces found one site's hidden editable frame by name, asked it to fill itself on a copy event, and stripped the invisible characters that site inserts - which is per-site code, and it is gone.
  // What is left is the technique without the site: borrow the selection, then read it back from whichever frame holds it.
  // A surface that mirrors its text through the selection answers; a surface that holds its text as pixels does not, and that is reported rather than papered over.
  const COPY_SELECTION_EXPRESSION = `(() => {
    try {
      const frames = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
      let best = '';
      for (const doc of frames) {
        let sel = null;
        try { sel = doc.getSelection ? doc.getSelection() : null; } catch { continue; }
        if (!sel || sel.rangeCount === 0) continue;
        const text = String(sel);
        if (text.length > best.length) best = text;
      }
      return best.length > 0 ? best : null;
    } catch { return null; }
  })()`;

  const copySelection = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: COPY_SELECTION_EXPRESSION,
      returnByValue: true
    });
    return typeof result?.value === 'string' ? result.value : null;
  };

  const guard = createCaretGuard({ evaluate: primitives.evaluate, key: primitives.key, settle: primitives.settle });

  const readAxText = async (ax) => {
    if (!ax || ax.axRich !== true) return null;
    const text = String(ax.documentText || '');
    return text.trim().length > 0 ? text : null;
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

  async function read(options = {}) {
    const allowCaretMove = options.allowCaretMove === true;
    const probe = await primitives.evaluate(SURFACE_PROBE_EXPRESSION);
    const ax = await measureAx({ ask: primitives.ask });
    const surface = buildProfile({ probe, ax });
    const ladder = readLadder(surface);
    const skipped = [];

    for (const step of ladder) {
      if (step.harm !== 'none') {
        const gate = gateRead({ harm: step.harm, allowCaretMove });
        if (!gate.allowed) {
          skipped.push({ strategy: step.strategy, harm: step.harm, why: gate.why });
          continue;
        }
      }

      if (step.strategy === 'dom') {
        if (surface.canvas === true) continue;
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
            caretMoved: false,
            caretRestored: true,
            viewRestored: true,
            caretWhy: ''
          };
        }
        continue;
      }

      if (step.strategy === 'ax') {
        const text = await readAxText(ax);
        if (text) {
          return {
            title: '',
            url: '',
            text,
            surface,
            strategy: step.strategy,
            harm: step.harm,
            skipped,
            description: describeProfile(surface),
            caretMoved: false,
            caretRestored: true,
            viewRestored: true,
            caretWhy: ''
          };
        }
        continue;
      }

      if (step.strategy === 'select-all') {
        const answer = await guardedSelectAll(allowCaretMove);
        if (answer) {
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
            caretMoved: true,
            caretRestored: answer.caret.restored,
            viewRestored: false,
            caretWhy: answer.caret.why
          };
        }
        skipped.push({ strategy: step.strategy, harm: step.harm, why: 'the caret could not be remembered, so the borrow was refused' });
        continue;
      }

      if (step.strategy === 'vision') {
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
          visionWhy: 'this surface offers no text to any read that asks nothing of it; call capture_page for the picture'
        };
      }
    }

    return {
      title: '',
      url: '',
      text: '',
      surface,
      strategy: 'none',
      harm: 'none',
      skipped,
      description: describeProfile(surface),
      visionWhy: 'every read this surface offers was skipped; call capture_page for the picture'
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
    let line = await primitives.evaluate(SELECTION_TEXT_EXPRESSION);
    if (typeof line !== 'string' || line.length === 0) line = await copySelection();
    await primitives.key('End').catch(() => null);
    const back = await guard.verdict(mark);
    return {
      line: typeof line === 'string' ? line : '',
      caretMoved: true,
      caretRestored: back.restored,
      viewRestored: false,
      caretWhy: back.why
    };
  }

  return { read, caretLine };
}
