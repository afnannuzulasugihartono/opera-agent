/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: portal - the account fold in the masthead: a dialog the reader opens and closes; its banner carries three facts the reader can walk past.
 * @state: click toggles, Escape closes, click outside closes, Tab walks the doors inside; the banner chevrons cycle the three messages, and the timer only turns while the fold is open.
 * @dependencies: site.css (.portalMenu, .navPortal, .portalBannerMsg).
 */

// WHY THE PORTAL FOLDS FROM THE NAV, NOT THE BODY: the account door is a door in the masthead; a page-wide overlay is for a question, not for choosing where your work lives.
// WHY IT CLOSES ON ESCAPE AND ON A CLICK OUTSIDE: a reader who opens it must be able to wave it away without finding the close button.

(function () {
  'use strict';

  var toggle = document.getElementById('navPortalToggle');
  var menu = document.getElementById('portalMenu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
  }

  function isOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  toggle.addEventListener('click', function () {
    setOpen(!isOpen());
  });

  menu.addEventListener('click', function (event) {
    var door = event.target.closest('a');
    if (door) setOpen(false);
  });

  document.addEventListener('pointerdown', function (event) {
    if (!isOpen()) return;
    var inside = menu.contains(event.target) || toggle.contains(event.target);
    if (!inside) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !isOpen()) return;
    setOpen(false);
    toggle.focus();
  });

  var msgs = menu.querySelectorAll('.portalBannerMsg');
  var prev = document.getElementById('portalBannerPrev');
  var next = document.getElementById('portalBannerNext');

  if (msgs.length > 1 && prev && next) {
    var index = 0;
    var reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function show(i) {
      index = ((i % msgs.length) + msgs.length) % msgs.length;
      for (var k = 0; k < msgs.length; k += 1) {
        msgs[k].hidden = k !== index;
      }
    }

    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });

    if (!reduced) {
      window.setInterval(function () {
        if (isOpen() && !document.hidden) show(index + 1);
      }, 4500);
    }
  }
})();
