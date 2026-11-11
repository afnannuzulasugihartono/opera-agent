// @last-edited: 2026-11-11 UTC+7.
// @title: status-icons - the three states of the one status line, as inline SVG.
// @state: check, clock, power.
// @dependencies: none.

// WHY THE ICONS LIVE IN ONE MODULE.
// The popup and the update page both draw the same three states; a second copy of the shapes is a second thing to keep in step.

export const STATUS_ICONS = Object.freeze({
  check: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 8.5 6 12 13.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8V8l2.2 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  power: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.6 4.3a6 6 0 1 0 6.8 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
});
