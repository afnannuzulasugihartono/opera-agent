// @last-edited: 2026-11-10 UTC+7.
// @title: verify - paste two fingerprints, get the verdict, never compare 64 characters with the naked eye.
// @state: one panel state machine, waiting for one hash, waiting for the other, match, mismatch; it owns nothing else on the page.
// @dependencies: none.

// WHY THE PANEL COMPARES IN THE BROWSER: _headers pins connect-src 'none', so the server's digest cannot be fetched from JavaScript; the two commands above are the source of truth and the panel reads their output as typed.
// WHY THE 64-HEX WORD IS EXTRACTED FROM WHATEVER IS PASTED: the server line arrives as "x-opera-sha256: <hex>" and the local line as bare hex in mixed case, so the panel takes the first 64 hex word and compares lowercase.

(() => {
  'use strict';

  const panel = document.getElementById('verifyPanel');
  if (!panel) return;

  const serverInput = document.getElementById('digestServer');
  const localInput = document.getElementById('digestLocal');
  const statusText = document.getElementById('verifyStatusText');
  const verdictText = document.getElementById('verifyVerdictText');

  const STRINGS = {
    id: {
      waiting: 'Menunggu dua hash…',
      one: '1 dari 2 hash terisi',
      match: 'Cocok — ini build yang sama dengan yang diserve server.',
      mismatch: 'Tidak cocok — jangan pasang; unduh ulang.',
      pasteBoth: 'Tempel kedua sebaris di atas untuk membandingkan.'
    },
    en: {
      waiting: 'Waiting for both hashes…',
      one: '1 of 2 hashes filled',
      match: 'Match — this is the build the server serves.',
      mismatch: 'No match — do not install; download again.',
      pasteBoth: 'Paste both lines above to compare.'
    }
  };

  const say = (key) => {
    const lang = window.OperaAgentI18n && window.OperaAgentI18n.getLang ? window.OperaAgentI18n.getLang() : 'id';
    const table = STRINGS[lang] || STRINGS.id;
    return table[key];
  };

  const hexOf = (value) => {
    const found = String(value).match(/[0-9a-fA-F]{64}/);
    return found ? found[0].toLowerCase() : '';
  };

  const paintInput = (input, hash) => input.classList.toggle('is-valid', Boolean(hash));

  const setText = (status, verdict) => {
    statusText.textContent = status;
    verdictText.textContent = verdict;
  };

  const evaluate = () => {
    const server = hexOf(serverInput.value);
    const local = hexOf(localInput.value);
    paintInput(serverInput, server);
    paintInput(localInput, local);
    panel.classList.toggle('is-match', Boolean(server) && server === local);
    panel.classList.toggle('is-mismatch', Boolean(server) && Boolean(local) && server !== local);
    if (!server && !local) setText(say('waiting'), say('pasteBoth'));
    else if (!server || !local) setText(say('one'), say('pasteBoth'));
    else if (server === local) setText(say('match'), say('match'));
    else setText(say('mismatch'), say('mismatch'));
  };

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

  serverInput.addEventListener('input', evaluate);
  localInput.addEventListener('input', evaluate);

  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => window.setTimeout(evaluate, 0));
  });

  evaluate();
})();
