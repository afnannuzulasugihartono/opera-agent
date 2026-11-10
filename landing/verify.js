// @last-edited: 2026-11-10 UTC+7.
// @title: verify - two commands, typed where the reader can see them, nothing else.
// @state: owns the animation inside the verify fold only (the two lines get typed once when the fold scrolls into view); it owns no other state on the page.
// @dependencies: none.

// WHY THE COMMANDS ARE TYPED, NOT PRINTED: the reader is about to run these two lines themselves, and a line they watched assemble is a line they know how to run; a wall of code they never watched looks like noise.
// WHY REDUCED MOTION GETS THE ANSWER INSTANTLY: a reader who asked for stillness gets the same two lines, immediately, with no animation to wait through.

(() => {
  'use strict';

  const panel = document.getElementById('verifyPanel');
  if (!panel) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CURL = 'curl.exe -sI https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip | findstr /i x-opera-sha256';
  const LOCAL = 'Get-FileHash .\\opera-agent-*.zip -Algorithm SHA256';

  const curlType = document.getElementById('curlType');
  const localType = document.getElementById('localType');
  const curlCaret = document.getElementById('curlCaret');
  const localCaret = document.getElementById('localCaret');

  const copy = (button) => {
    const text = button.getAttribute('data-copy') || '';
    const done = () => {
      button.classList.add('is-copied');
      window.setTimeout(() => button.classList.remove('is-copied'), 1400);
    };
    const failed = () => {
      const target = button.closest('.verifyBlock').querySelector('pre code');
      if (!target) return;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, failed);
    } else {
      failed();
    }
  };

  panel.querySelectorAll('.verifyCopy').forEach((button) => {
    button.addEventListener('click', () => copy(button));
  });

  const typeLine = (el, caret, text, done) => {
    el.textContent = '';
    caret.classList.add('is-on');
    let index = 0;
    const tick = () => {
      el.textContent = text.slice(0, ++index);
      if (index >= text.length) {
        if (done) done();
        return;
      }
      window.setTimeout(tick, 20 + (index % 4) * 9);
    };
    tick();
  };

  const begin = () => {
    if (reduce) {
      curlType.textContent = CURL;
      localType.textContent = LOCAL;
      localCaret.classList.add('is-on');
      return;
    }
    typeLine(curlType, curlCaret, CURL, () => {
      curlCaret.classList.remove('is-on');
      typeLine(localType, localCaret, LOCAL, () => {
        localCaret.classList.add('is-on');
      });
    });
  };

  if (!('IntersectionObserver' in window)) {
    begin();
    return;
  }

  const seen = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    seen.disconnect();
    begin();
  }, { rootMargin: '40% 0px' });
  seen.observe(panel);
})();
