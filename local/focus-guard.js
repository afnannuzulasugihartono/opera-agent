// @last-edited: 2026-11-01 UTC+7.
// @title: focus-guard — whether the screen is the drive's, and the one question worth asking.
// @state: the machine is asked what is in front, the person is asked once, and the answer is held for the rest of the run.
// @dependencies: ./window-focus.js, ./focus-confirm.js.

// WHY AN INPUT ACTION CHECKS THE SCREEN ITSELF.
// Asking the human to press a key in the middle of a drive is the one thing this product promised not to need, so the check happens where the action happens, and every answer says what it found.

// WHY THE MACHINE IS ASKED AND NOT THE PAGE.
// Measured live on this machine, with the drive typing into a Google Docs document:

// - browser behind another application: the page reported focus, and the typed text landed.
//   The page cannot tell that the screen is somebody else's.
// - browser minimized, caret in place: the page reported no focus, and four typed characters went nowhere.
//   A window that is on the taskbar is the problem.

// So the page is not the one that answers whether the screen is the drive's - the machine is, and it answers in one read.
// The page is still asked after the screen is taken, because a window in front and a page that hears input are two different facts.

// WHY THE PERSON IS ASKED ONCE AND THE ANSWER IS HELD.
// The person asked for a window lock: while the drive works, the screen cannot wander off to another tab, another browser or another program.
// So the first time the machine says the screen is somebody else's, the person is asked in the window they are in, and the answer is held for the rest of the run.
// An answer of no is held too: the screen stays where the person put it, and the drive goes on in the background.

// WHY IT IS BUILT RATHER THAN WRITTEN.
// The rules are one closure over the two things a test can hold still - the machine and the clock - so the claims below are checked without launching a shell and without waiting a second.

import {
  focusWindow,
  windowState
} from './window-focus.js';
import {
  askFocus
} from './focus-confirm.js';

// WHY THE GUARD'S BUDGET IS THIRTY-TWO MILLISECONDS AND NOT A HUNDRED AND TWENTY.
// Measured live: a page that will hear input answers hasFocus in under a millisecond, and one that will not never answers at all - so the wait was paid in full, twice, on the path that takes the screen.
// The click proves its own press now, so a window that is still settling cannot lose one; the budget is the settle's own quiet window, which is the same proof every action already accepts.

export function createFocusGuard({
  focus = focusWindow,
  read = windowState,
  front = async () => null,
  browser = async () => null,
  ask = askFocus,
  machineTtlMs = 1500,
  settleMs = 32,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => Date.now()
} = {}) {
  let seen = {
    at: 0,
    state: null
  };
  let personAnswered = false;
  let mayHold = false;

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

  // WHY THE SCREEN IS MATCHED WITH THE WINDOW AND NOT WITH THE TAB ALONE.
  // Two windows can carry the same page title - one in Chrome and one in Brave - and the title of the window in front would then say the drive is already there while the screen is about to move to another browser.
  // So the browser travels with the title, the same way it travels when a window is brought forward.

  const screenIsOurs = (
    state,
    wanted,
    ours
  ) => {
    const front_ = String(state?.foreground ?? '').toLowerCase();
    if (front_ === '') return false;
    const named = wanted === '' ? ours !== '' : front_.includes(wanted);
    const sameBrowser = ours === '' || ours === 'unknown' || front_.includes(ours);
    return named && sameBrowser;
  };

  // WHY THE GUARD ASKS THE PAGE UNTIL IT HEARS INSTEAD OF SLEEPING A FIXED TIME.
  // Measured on the fixture: every input call whose screen the drive had to take paid two fixed 120 ms sleeps, while the page answered hasFocus in under a millisecond the whole time.
  // The wait is for a fact, so the fact is asked for until it arrives or the budget runs out; a press that a window still swallows is retried by the click itself, so a short wait costs no correctness.
  // The attempts are capped as well as the clock, because a test hands in a clock that does not move.

  const heardWithin = async (
    ask,
    budgetMs
  ) => {
    const deadline = clock() + budgetMs;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await ask().catch(() => false) === true) return true;
      if (clock() >= deadline) return false;
      await sleep(Math.min(16, Math.max(1, budgetMs))).catch(() => null);
    }
    return false;
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

    const wanted = String(match ?? '').trim().toLowerCase();
    const {
      state
    } = await machine();
    const driving = await Promise.resolve().then(() => browser()).catch(() => null);
    const ours = String(driving?.name ?? '').toLowerCase();
    const foreground = state?.foreground ?? '';

    if (screenIsOurs(state, wanted, ours)) {
      return {
        window: 'the drive holds the screen',
        checked: 'machine',
        foreground,
        focused: true
      };
    }

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
          foreground: out?.foreground ?? foreground,
          focused: false,
          blocked: true
        };
      }

      const heard = await heardWithin(hasFocus, settleMs);
      return {
        window: heard
          ? `brought ${out.title} back from the taskbar`
          : `brought ${out.title} back from the taskbar, but the page still cannot hear input`,
        checked: 'machine',
        foreground: out?.foreground ?? foreground,
        focused: heard,
        ...(heard ? {} : { blocked: true })
      };
    }

    // WHY A DRIVE WITHOUT A NAME STOPS HERE.
    // The window is found by a piece of its title, and a drive that named nothing has nothing to look for - so there is nothing to ask about and nothing to take.

    if (!match && !driving?.name) {
      return {
        window: `the screen is the person's: ${foreground || 'another window'} is in front`,
        checked: 'person',
        foreground,
        focused: false
      };
    }

    // WHY THE PERSON IS ASKED BEFORE THE DRIVE TAKES THE SCREEN BACK.
    // The person may have moved on to another tab, another browser or another program while the drive was working, and taking the screen back under their hands takes that away without asking.
    // So the question is asked in the window they are in, and it is asked once: an answer of yes is held for the rest of the run.

    if (!personAnswered) {
      personAnswered = true;
      const answer = await Promise.resolve().then(() => ask({
        what: `the "${match || 'browser'}" window`
      })).catch(() => ({
        allowed: false,
        answer: 'error'
      }));
      mayHold = Boolean(answer?.allowed);
    }

    if (!mayHold) {
      return {
        window: `the screen is the person's: ${foreground || 'another window'} is in front, and the drive will not take it`,
        checked: 'person',
        foreground,
        focused: false
      };
    }

    // WHY THE TAB COMES FORWARD FIRST.
    // A screen that is not the drive's is usually a tab that is not the one the person is looking at, and bringing the tab forward is what makes the window carry the title the machine looks for.

    const moved = await Promise.resolve().then(() => front()).catch(() => null);
    if (moved !== null && moved !== false) {
      await heardWithin(hasFocus, settleMs);
    }

    // WHY THE WINDOW IS BROUGHT FORWARD WITHOUT ASKING AGAIN.
    // The person already said yes, so the window of the browser being driven is brought forward as well, and the browser travels with the title so the right window is the one that comes forward.

    const out = await Promise.resolve().then(() => focus(match || driving?.name || '', {
      ask: false,
      os: true,
      browser: driving?.name ?? ''
    })).catch(() => null);
    const heard = await heardWithin(hasFocus, settleMs);
    return {
      window: out?.focused
        ? heard
          ? `took the screen back: ${out.title || match || driving?.name}`
          : `the window came forward, but the page still cannot hear input`
        : `the screen is the person's: ${out?.foreground || foreground || 'another window'} is in front`,
      checked: 'lock',
      foreground: out?.foreground ?? foreground,
      focused: Boolean(out?.focused) && heard
    };
  };
}
