// @last-edited: 2026-10-15 UTC+7.
// @title: focus-guard — one answer to "is anything going to hear this click".
// @state: a short memory, the page asked first, the machine asked only when it must.
// @dependencies: ./window-focus.js.

// WHY AN INPUT ACTION CHECKS THE WINDOW ITSELF. Asking the human to press a key in
// the middle of a drive is the one thing this product promised not to need, so the
// check happens where the action happens, and every answer says which of the two
// things ran.
//
// WHY THE PAGE IS ASKED FIRST, AND WHY THAT IS ENOUGH. Measured live on this
// machine, with the drive typing into a Google Docs document:
//
//   - browser behind another application: the page still reported focus, and the
//     typed text landed in the document. A window that is behind is not the
//     problem, and taking the user's attention away to fix it would be a cost paid
//     for nothing.
//   - browser minimized: the page reported no focus, and text typed after the window
//     came back did not land until something put the caret back. A window that is
//     not there at all is the problem, and this is the case worth a PowerShell
//     launch.
//
// The page answers the second case for one evaluation, so the machine is only asked
// when the page says it is not listening.
//
// WHY THE ANSWER IS CACHED FOR A BEAT. A drive fires a dozen actions in a row, and
// asking the page every time would be a dozen evaluations to answer a question that
// cannot have changed in between. A second is short enough to be harmless and long
// enough to cover a burst. The memory belongs to the machine and not to a tab, so it
// is shared by every tab.
//
// WHY IT IS BUILT RATHER THAN WRITTEN. The rules are one closure over three things a
// test can hold still - the machine call, the clock and the memory - so the claims
// below are checked without a PowerShell launch and without waiting a second.

import { focusWindow } from './window-focus.js';

export function createFocusGuard({ focus = focusWindow, ttlMs = 1000, clock = () => Date.now() } = {}) {
  let heard = { at: 0, focused: false };

  return async function ensureFront({ hasFocus, match = '' } = {}) {
    if (typeof hasFocus !== 'function') {
      return { window: 'this driver cannot tell whether the window is there', checked: 'nothing' };
    }
    if (clock() - heard.at < ttlMs && heard.focused) {
      return { window: 'the page hears input', checked: 'memory' };
    }
    const listening = await hasFocus().catch(() => false);
    if (listening) {
      heard = { at: clock(), focused: true };
      return { window: 'the page hears input', checked: 'page' };
    }
    const out = await focus(match);
    heard = { at: clock(), focused: out?.focused === true };
    return {
      window: out?.focused ? `brought ${out.title} forward` : `could not bring a window forward: ${out?.why ?? 'the machine said nothing'}`,
      checked: 'machine',
      foreground: out?.foreground ?? ''
    };
  };
}

// WHY ONE GUARD FOR THE WHOLE PROCESS. Two guards would answer differently about the
// same machine at the same moment - one would have asked the page, the other would
// still be trusting a memory - and two answers about one window is the kind of thing
// this product exists to stop.

export const ensureFront = createFocusGuard();
