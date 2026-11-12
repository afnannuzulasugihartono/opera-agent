/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: copy - one engine behind every [data-copy] button on the site.
 * @state: delegated listener on the document; copies the textContent of the element the button names by id; feedback label follows the page language.
 * @dependencies: none.
 */

// WHY THE COPY ENGINE IS ITS OWN FILE: five pages grew the same handler five times with two semantics for one attribute (id reference here, literal text there); the install page that needed it most shipped without any.
// WHY data-copy MEANS AN ELEMENT ID, NEVER THE TEXT ITSELF: a text held in an attribute is a text nobody can proofread or translate; an id names the block the reader already sees.
// WHY delegated: the window list is long and the page is static, so one listener outlives every button on it; a button re-rendered by the harness demo keeps working.
// WHY the feedback follows the page lang: the button is the only control on the page a reader touches to leave with the config; it must speak the same language as the page around it.

(function () {
  'use strict';

  const lang = () => window.OperaAgentI18n?.getLang?.() ?? document.documentElement.lang ?? 'id';

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const target = document.getElementById(button.getAttribute('data-copy'));
    if (!target) return;
    const text = target.innerText;

    const flash = () => {
      const label = button.textContent;
      button.textContent = lang() === 'en' ? 'Copied!' : 'Tersalin!';
      button.classList.add('is-copied');
      window.setTimeout(() => { button.textContent = label; button.classList.remove('is-copied'); }, 1500);
    };

    const done = flash;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(target, done));
    } else {
      fallbackCopy(target, done);
    }

    function fallbackCopy(element, after) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      try { document.execCommand('copy'); } catch { after(); return; }
      selection?.removeAllRanges();
      after();
    }
  });
})();
