// @last-edited: 2026-10-25 UTC+7.
// @title: focus-guard — whether anything is going to hear this click, and the one case worth fixing.
// @state: the page asked every time, the machine asked once in a while and only when the page is deaf.
// @dependencies: ./window-focus.js.

// WHY AN INPUT ACTION CHECKS THE WINDOW ITSELF.
// Asking the human to press a key in the middle of a drive is the one thing this product promised not to need, so the check happens where the action happens, and every answer says what it found.

// WHY THE PAGE IS ASKED FIRST, EVERY TIME.
// Measured live on this machine, with the drive typing into a Google Docs document:

// - browser behind another application: the page reported focus, and the typed text landed.
//   A window that is behind is not the problem.
// - browser minimized, caret in place: the page reported no focus, and four typed characters went nowhere.
//   A window that is on the taskbar is the problem.

// The page answers the first case for one evaluation, so nothing is spent when there is nothing to fix, and the machine is asked only when the page says it is deaf.

// WHY THE MACHINE IS ASKED AT ALL, GIVEN THE PAGE SAYS THE SAME THING FOR A BACKGROUND TAB.
// Because that is the whole difficulty: a background tab and a minimized window both report no focus and not visible, so the page cannot tell them apart, and they need opposite answers - one goes ahead, the other has to have its window brought back.
// Only the machine can tell, so it is asked, and the answer is held for a beat because a shell launch is the most expensive thing in this file.

// WHY THE PAGE IS NOT HELD FOR A BEAT.
// It costs one evaluation, and it is the answer that changes fastest: a human who brings the window back should not have to wait a second for the drive to notice.

// WHY IT IS BUILT RATHER THAN WRITTEN.
// The rules are one closure over the two things a test can hold still - the machine and the clock - so the claims below are checked without launching a shell and without waiting a second.

import {
  focusWindow,
  windowState
} from './window-focus.js';

export function createFocusGuard({
  focus = focusWindow,
  read = windowState,
  machineTtlMs = 1500,
  settleMs = 120,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => Date.now()
} = {}) {
  let seen = {
    at: 0,
    state: null
  };

  const machine = async () => {
    if (clock() - seen.at < machineTtlMs && seen.state) return {
      state: seen.state,
      asked: false
    };
    const state = await read().catch(() => null);
    seen = {
      at: clock(),
      state
    };
    return {
      state,
      asked: true
    };
  };

  return async function ensureFront({
    hasFocus,
    match = ''
  } = {}) {
    if (typeof hasFocus !== 'function') {
      return {
        window: 'this driver cannot tell whether the window is there',
        checked: 'nothing'
      };
    }
    if (await hasFocus().catch(() => false)) {
      return {
        window: 'the page hears input',
        checked: 'page'
      };
    }

    const {
      state,
      asked
    } = await machine();
    const wanted = String(match ?? '').trim().toLowerCase();

    // WHY NO BLIND FALLBACK TO THE FIRST MINIMIZED WINDOW.
    // Measured live on this machine: a read-only burst on a page that was merely behind another application brought a minimized Settings window to the front, because nothing named the browser and the guard took whatever was on the taskbar.
    // A drive that types after that would type into Settings.
    // So a window is restored only when the caller named a piece of its title, and the driver names the tab it is about to drive.

    // WHY THE SESSION'S OWN WINDOW IS THE EXCEPTION.
    // Browser.getWindowForTarget says whether the window this session is attached to is minimized, and it carries no title because there is nothing to tell apart: that window is the one and only answer.
    // So it is restored on the session's word, while the OS list - which holds every application on the machine - still needs a name.
    const own = state?.ownWindow === true ? (state?.minimized ?? [])[0] ?? '' : '';
    const minimized = own || (wanted
      ? (state?.minimized ?? []).find((title) => title.toLowerCase().includes(wanted)) ?? ''
      : '');

    // WHY A RESTORE IS NOT THE END OF THE CHECK.
    // A title can name two windows at once: measured live on this machine, two Chrome windows both held "Untitled document - Google Docs - Google Chrome", the machine brought forward the one that was awake, and the minimized one stayed on the taskbar.
    // The answer said it had brought a window back while the page still could not hear input, so the page is asked again before the drive is allowed to send anything.
    if (minimized) {
      const out = await focus(minimized);
      seen = {
        at: clock(),
        state: null
      };
      if (!out?.focused) {
        return {
          window: `the window is on the taskbar and the machine would not bring ${minimized} back: ${out?.why ?? 'it said nothing'}`,
          checked: 'machine',
          foreground: out?.foreground ?? state?.foreground ?? '',
          focused: false,
          blocked: true
        };
      }

      await sleep(settleMs).catch(() => null);
      const heard = await hasFocus().catch(() => false);
      return {
        window: heard
          ? `brought ${out.title} back from the taskbar`
          : `brought ${out.title} back from the taskbar, but the page still cannot hear input`,
        checked: 'machine',
        foreground: out?.foreground ?? state?.foreground ?? '',
        focused: heard,
        ...(heard ? {} : { blocked: true })
      };
    }
    return {
      window: `the page is in the background and hears input anyway; ${state?.foreground || 'another window'} is in front`,
      checked: asked ? 'machine' : 'memory',
      foreground: state?.foreground ?? ''
    };
  };
}

// WHY ONE GUARD PER SESSION.
// Two guards would answer differently about the same machine at the same moment - one would have asked the page, the other would still be holding an old shell - and two answers about one window is the kind of thing this product exists to stop.
// The session builds its own, and the page it asks about is the session's, so the guard and the thing it guards are created together in sessions.js.
