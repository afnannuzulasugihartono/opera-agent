/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: run - the work is shown doing itself: four steps tick off while the artefact lands.
 * @state: one IntersectionObserver; a stillness-seeking reader gets the complete frame, never the ticking.
 * @dependencies: beranda.css (.runWindow, .runSteps, .runResult).
 */

// WHY THE RUN RESETS ON RE-ENTER: the artefact looping is the argument, and a reader who scrolls away mid-run and returns deserves the whole job, not its remainder.

(function () {
  'use strict';

  var win = document.querySelector('.runWindow');
  if (!win) return;

  var steps = Array.prototype.slice.call(win.querySelectorAll('.runSteps li'));
  var result = win.querySelector('.runResult');
  var timers = [];
  var STEP_MS = [300, 2200, 4100, 6000];
  var REST_MS = 5000;

  function markAll() {
    for (var i = 0; i < steps.length; i += 1) steps[i].classList.add('is-done');
    if (result) result.classList.add('is-done');
  }

  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || typeof IntersectionObserver !== 'function') {
    markAll();
    return;
  }

  function clearTimers() {
    while (timers.length) window.clearTimeout(timers.pop());
  }

  function runCycle() {
    clearTimers();
    for (var i = 0; i < steps.length; i += 1) steps[i].classList.remove('is-done');
    if (result) result.classList.remove('is-done');
    for (var n = 0; n < steps.length; n += 1) {
      (function (n) {
        timers.push(window.setTimeout(function () {
          steps[n].classList.add('is-done');
          if (n === steps.length - 1 && result) result.classList.add('is-done');
        }, STEP_MS[n]));
      })(n);
    }
    timers.push(window.setTimeout(runCycle, STEP_MS[steps.length - 1] + REST_MS));
  }

  var observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) runCycle();
    else clearTimers();
  }, { threshold: 0.1 });
  observer.observe(win);
})();
