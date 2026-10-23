// @last-edited: 2026-10-23 UTC+7.
// @title: input — the typing and key primitives, and the proof that the text landed.
// @state: type, append, key, keys, selectAll and clear, over the edit signature that says the page moved.
// @dependencies: ./page-expressions.js.

// WHY THIS MODULE EXISTS

// Text is where a drive spends most of its round trips, and it is the one thing the protocol cannot confirm: Input.insertText answers ok on a page with no caret and nothing lands.
// So the verbs that send text and keys live here beside the reads that prove the page took them, and nothing else.

// Typing does not replace a selection.
// That was measured against a real Google Docs canvas, where selecting all and then typing appended instead of overwriting, duplicated the document, and returned ok:true with nothing to indicate it had.
// The primitives therefore expose the two halves separately -- select, then delete, then type -- rather than a convenient replace that does not exist at the protocol level.

// A newline is a real paragraph break, and a key event is not.
// Measured in the same document: text inserted with \n produced separately styled paragraphs, which is what lets a whole paper go in as one call rather than hundreds.
// The same document ignored a dispatched Enter key event entirely and still reported success, merging every paragraph into one.
// Both paths reach the editor, only one of them is read, and the result is indistinguishable from working unless the document is captured and looked at.
// So callers break paragraphs through type() and never through key('Enter').

// Structure is applied before content, never after.
// Measured in the same document: a paragraph style applied to a paragraph that already held its text did not take, while the identical chord applied to an empty paragraph did.
// The chord returns ok either way, so the outline is the only witness.

// Text belongs to the key only when nothing is held down.
// A chord is exactly two events — keyDown and keyUp with the modifiers mask, the virtual codes, and no text — and no separate modifier press around them.
// Measured 2026-10-13: the previous six-event frame, modifier downs plus a rawKeyDown, leaked its character into a Docs canvas under rapid fire ("e1Laporan", doc 11nW) while the two-event frame the extension sends styled cleanly on the same document at the same speed.
// Two events are also three round trips fewer per chord, which is what makes a twenty-key walk feel instant instead of deliberate.

// Tab carries no text.
// A real Tab keypress produces none, and the tab character this driver used to send moved the Sheets selection while stranding focus in the formula bar, which then swallowed every following key.
// Measured 2026-10-13: three identically misfilled sheets, then a name-box trace naming Tab as the poison and a textless Tab moving cleanly with focus intact.

// Text insertion is chunked.
// A single Input.insertText carries a practical limit, and a long document arriving in one piece can be dropped or truncated partway with no error.
// Chunking bounds the blast radius of that.

// Keys travel as a stream.
// Every lone key pays a full round trip, so a twenty-key menu walk costs twenty trips one at a time and one as a stream: order preserved, gaps ride along for UI that needs a beat, text and chords share the sequence.

import {
  EDIT_POLLS,
  EDIT_POLL_MS,
  EDIT_SIGNATURE_EXPRESSION,
  FOCUS_EXPRESSION,
  KEY_BEAT_MS,
  describeKey,
  locateExpression,
  modifierMask,
  splitText
} from './page-expressions.js';

export function createInputMethods({ cdp, primitives, sleep, chunkSize = 2000 }) {
  const insertText = async (text) => {
    const parts = splitText(text, chunkSize);
    await Promise.all(parts.map((part) => cdp.send('Input.insertText', { text: part })));
    return { chunks: parts.length, chars: String(text ?? '').length };
  };

  const editSignature = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: EDIT_SIGNATURE_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { body: '', value: '', holds: false };
  };

  const moved = (before, after) => after.body !== before.body || after.value !== before.value;

  const sigLen = (sig) => Number(String(sig ?? '').split(':')[0]) || 0;

  const probeOf = (text) => String(text ?? '').replace(/^\s+/, '').slice(0, 32);

  const locateInsertion = async (text, before, after) => {
    const delta = (sigLen(after?.body) - sigLen(before?.body)) + (sigLen(after?.value) - sigLen(before?.value));
    const probe = probeOf(text);
    if (!probe) return { found: false, index: -1, field: false, before: '', after: '', delta };
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: locateExpression(probe), returnByValue: true });
      const at = result?.value;
      if (!at || typeof at.index !== 'number' || at.index < 0) {
        return { found: false, index: -1, field: false, before: String(at?.before ?? ''), after: '', delta };
      }
      return { found: true, index: at.index, field: at.field === true, before: String(at.before ?? ''), after: String(at.after ?? ''), delta };
    } catch {
      return { found: false, index: -1, field: false, before: '', after: '', delta };
    }
  };

  const waitForEdit = async (before) => {
    for (let ask = 0; ask < EDIT_POLLS; ask += 1) {
      if (ask > 0) await sleep(EDIT_POLL_MS);
      const now = await editSignature();
      if (moved(before, now)) return { moved: true, after: now };
    }
    return { moved: false, after: await editSignature() };
  };

  const focusNow = async () => {
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: FOCUS_EXPRESSION, returnByValue: true });
      return result?.value ?? null;
    } catch {
      return null;
    }
  };

  async function type(text) {
    const before = await editSignature();
    const out = await insertText(text);
    const seen = await waitForEdit(before);
    if (!seen.moved) {
      const focus = await focusNow();
      const where = focus?.tag
        ? `focus was on ${focus.trail}${focus.editable ? '' : ', which takes no text'}`
        : 'nothing on the page held focus';
      throw new Error(seen.after.holds
        ? `typed ${out.chars} characters and nothing on the page changed: ${where} - click_row the field that should receive it, or press Escape if a dialog is over it`
        : `typed ${out.chars} characters into a page that holds no text and no field to receive them`);
    }
    return { ...out, landed: true, placed: await locateInsertion(text, before, seen.after) };
  }

  // WHY AN APPEND AND NOT A TYPE.
  // Measured live while building a thesis: the road to the end of a document was click somewhere, press Ctrl+End, and trust the caret - and once it did not go where it was told, a whole batch landed inside a table cell and recovering cost four extra calls and an undo.
  // An append is that promise with the positioning inside it.

  // WHY "AT THE END" IS READ AND NOT AIMED FOR.
  // Moving a caret to the end of a long canvas document and reading the caret back is several round trips against a surface that mirrors into the DOM on the editor's own schedule.
  // What one evaluation can answer is whether anything follows the text that was just inserted: at the end, nothing does.
  // So atEnd is measured, and when the mirror is too stale to tell, the answer says found:false instead of claiming it.
  // Measured live on a Google Doc: five appends in a row each reported atEnd false, because what followed the inserted text was the editor's own chrome ("Banner hidden new line 1 by 1") rather than document text.
  // The appends were at the end; a strict measure cannot see past a canvas editor's chrome, so it names what followed rather than guessing either way.

  async function append(text) {
    const chars = String(text ?? '').length;
    await primitives.key('End', ['Control']);
    await primitives.settle();
    const typed = await type(text);
    const atEnd = typed.placed.found && String(typed.placed.after ?? '').trim() === '';
    return {
      ...typed,
      chars,
      atEnd,
      atEndWhy: typed.placed.found
        ? (atEnd ? 'nothing follows the inserted text' : `text follows it: "${String(typed.placed.after).trim().slice(0, 40)}"`)
        : 'the page could not say where the text went - read_page() is the proof on a canvas page'
    };
  }

  async function key(name, modifiers = []) {
    const mask = modifierMask(modifiers);
    const descriptor = describeKey(name);

    if (mask !== 0) {
      const chord = {
        key: descriptor.key,
        code: descriptor.code,
        windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
        nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode
      };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: mask, ...chord });
      await sleep(KEY_BEAT_MS);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...chord });
      return { key: name, modifiers: mask };
    }

    const printable = Object.prototype.hasOwnProperty.call(descriptor, 'text');
    const frame = printable
      ? { type: 'keyDown', modifiers: mask, ...descriptor }
      : { type: 'rawKeyDown', modifiers: mask, key: descriptor.key, code: descriptor.code, windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode };

    await cdp.send('Input.dispatchKeyEvent', frame);
    await sleep(KEY_BEAT_MS);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: mask, key: descriptor.key, code: descriptor.code,
      windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode
    });

    return { key: name, modifiers: mask };
  }

  // WHY A STREAM REPORTS THE COMPARISON INSTEAD OF A VERDICT.
  // A shortcut in the middle of a stream can change the page without the text ever landing, so "the page changed" is the strongest thing a stream can honestly say - and it is the thing an agent needs to decide whether to look again.

  async function keys(events) {
    if (!Array.isArray(events) || events.length === 0) throw new Error('keys needs a non-empty event array.');
    if (events.length > 100) throw new Error('keys holds at most 100 events.');
    for (const [index, event] of events.entries()) {
      const gapMs = event?.gapMs ?? 0;
      if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > 2000) throw new Error(`event ${index} gap must be between 0 and 2000 ms.`);
      if (event?.text != null && event?.key != null) throw new Error(`event ${index} must be text or a key, not both.`);
      if (event?.text == null && event?.key == null) throw new Error(`event ${index} needs text or a key.`);
      if (event?.key != null) describeKey(event.key);
    }
    const started = Date.now();
    const before = await editSignature();
    let chords = 0;
    let chars = 0;
    let settled = false;
    let run = [];
    // WHY A CHORD-ONLY STREAM DOES NOT POLL FOR TEXT.
    // A menu or style chord moves no text signature, so the twelve-poll edit wait could only ever report moved:false — after 1.8 s of waiting for a mirror that was never coming.
    // Text still gets the slow-mirror budget, because that lag is real; a chord gets one settle and one honest signature instead.
    // A text stream with nothing focused gets neither: text sent to a button cannot land, so one focus read is cheaper than a poll budget that can only report moved:false.
    const reportMoved = async () => {
      if (chars === 0) {
        await primitives.settle();
        settled = true;
        return moved(before, await editSignature());
      }
      const focus = await focusNow();
      if (focus && focus.editable === false) return false;
      return (await waitForEdit(before)).moved;
    };

    const flush = async () => {
      for (const job of run) {
        const out = await job.go();
        if (job.kind === 'text') chars += out.chars;
        else chords += 1;
      }
      run = [];
    };
    for (const event of events) {
      if (event.text != null) run.push({ kind: 'text', go: () => insertText(String(event.text)) });
      else run.push({ kind: 'chord', go: () => key(event.key, event.modifiers ?? []) });
      if ((event.gapMs ?? 0) > 0) {
        await flush();
        await sleep(event.gapMs);
      }
    }
    await flush();
    return { events: events.length, chords, chars, moved: await reportMoved(), settled, execMs: Date.now() - started };
  }

  async function selectAll() {
    return key('a', ['Control']);
  }

  async function clear() {
    await selectAll();
    await key('Delete');
  }

  return { type, append, key, keys, selectAll, clear };
}
