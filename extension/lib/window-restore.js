// @last-edited: 2026-10-25 UTC+7.
// @title: window-restore — the one window update that takes a window off the taskbar.
// @state: a pure decision over a chrome window: minimize is restored with focus, an unfocused window is focused, a focused window is left alone.
// @dependencies: none.

// WHY THIS IS A DECISION AND NOT A CALL.
// chrome.windows.update is the only thing in this tree that can restore a minimized window, and the two asks are not the same ask: focused:true alone leaves a window on the taskbar, measured live on this machine.
// The decision is pure so the rule can be checked without a browser, and the live check is the one that proves the browser obeys it.

// WHY THE WINDOW IS READ BEFORE IT IS WRITTEN.
// chrome.windows.update with state:'normal' on a window that is already normal is a no-op that still costs a round trip and still says nothing about whether the focus ask worked.
// Reading first means the answer can name which of the three cases it was, and a caller can tell a restore from a focus from nothing at all.

export function windowUpdateFor(window, options = {}) {
  if (options.focus === false) return null;
  const state = String(window?.state || '');
  if (state === 'minimized') return { focused: true, state: 'normal' };
  if (window?.focused === true) return null;
  return { focused: true };
}

// WHY THE ANSWER NAMES THE CASE.
// A drive that asked for a window and got one that is merely behind another application is in a different situation from one that was on the taskbar, and the second one is the only one that ever dropped text.
// So the answer carries the word, and the caller reports it instead of inferring it from a silence.

export function windowUpdateCase(update) {
  if (!update) return 'left-alone';
  return update.state === 'normal' ? 'restored' : 'focused';
}
