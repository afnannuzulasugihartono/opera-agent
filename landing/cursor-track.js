// @last-edited: 2026-11-10 UTC+7.
// @title: cursor-track - the caret finds the real buttons at any size.
// @state: one pass on load and on every resize; it sets the coordinates the animation rides on, it never moves anything by itself.
// @dependencies: none.

// WHY THE CARET IS COMPUTED, NOT TYPED IN: percentage stops baked into the stylesheet only landed on targets at one exact window size; a deployed page is read at whatever width the reader has.
// WHY IT RIDES ON CUSTOM PROPERTIES: the keyframes animate the same property with the measured values, so the loop stays declarative and the numbers never drift from the layout.
// WHY IT RUNS AFTER REVEAL: layout below the fold is still laid out for measurement even before the observer marks it visible.

(() => {
  'use strict';

  const TARGETS = [
    ['dockChrome', '.tChrome'],
    ['dockExplorer', '.tFolder'],
    ['dockTerm', '.tTerm'],
    ['dlBtn', '.dlBigBtn'],
    ['dlShelf', '.dlShelf'],
    ['extract', '.extractAll'],
    ['toggle', '.s3 .toggle'],
    ['load', '.loadReady'],
    ['manifest', '.pickTarget'],
    ['pick', '.pickBtn'],
    ['card', '.s4 .extCard'],
    ['pair', '.pairCreateBtn'],
    ['copy', '.pairCopyBtn'],
    ['trigger', '.extTrigger'],
    ['field', '.oaFieldEmpty']
  ];

  const measure = () => {
    const stage = document.querySelector('.demoStage');
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    for (const [name, selector] of TARGETS) {
      const el = stage.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x = (((r.left + r.width / 2 - box.left) / box.width) * 100).toFixed(2) + '%';
      const y = (((r.top + r.height / 2 - box.top) / box.height) * 100).toFixed(2) + '%';
      document.documentElement.style.setProperty('--c-' + name + '-x', x);
      document.documentElement.style.setProperty('--c-' + name + '-y', y);
    }
  };

  measure();
  window.addEventListener('load', measure);
  window.addEventListener('resize', measure);
})();
