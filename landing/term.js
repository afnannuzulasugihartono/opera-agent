/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: term - the three OS tabs under the terminal line; the command swaps with the selection.
 * @state: one click, one command; a reader without script keeps the macOS default, which is the honest install for the audience.
 * @dependencies: beranda.css (.termBar, .termTab, .termLine).
 */

// WHY THREE COMMANDS AND NO MORE: the page advertises one install path per operating system; a fourth option would be a fourth thing to trust.
// WHY THE TABS ARE BUTTONS: a tab that opens nothing is a lie to the keyboard reader; buttons activate with Enter and Space.

(function () {
  'use strict';

  var cmds = {
    mac: 'curl -fsSL https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip -o opera-agent.zip && unzip opera-agent.zip',
    linux: 'curl -fsSL https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip -o opera-agent.zip && unzip opera-agent.zip',
    win: 'irm https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip -OutFile opera-agent.zip; Expand-Archive opera-agent.zip .',
  };

  var bar = document.querySelector('.termBar');
  if (!bar) return;
  var cmd = bar.querySelector('#termCmd');
  var tabs = Array.from(bar.querySelectorAll('.termTab'));

  function select(active) {
    for (const tab of tabs) {
      var on = tab === active;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    cmd.textContent = cmds[active.dataset.os] || cmds.mac;
  }

  for (const tab of tabs) tab.addEventListener('click', function () { select(tab); });
})();
