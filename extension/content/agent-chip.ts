// @last-edited: 2026-11-14 UTC+7.
// @title: agent-chip - the small mark that tells a tab the agent has it.
// @state: renders only while the worker says it should; refuses on sensitive surfaces; removes itself on command; this file is injected into the held tab on demand and is idempotent.
// @dependencies: none.

// WHY THIS MAY NOT IMPORT.
// The manifest pipeline loads content modules as classic scripts; an import statement is a SyntaxError.
// Everything here is inline.

(function () {
  'use strict';
  var CHIP_ID = 'oa-agent-chip';
  if (document.getElementById(CHIP_ID)) return;

  // WHY THE REFUSAL IS FIRST AND INLINE.
  // No badge on a password page, no chip on an OTP, no chip on a payment surface: the marker never lies about a page that carries a credential.
  function isSensitiveSurface() {
    try {
      var nodes = document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"], [name*="cvv" i], [name*="otp" i]');
      var sensitive = nodes.length > 0;
      if (!sensitive) {
        sensitive = document.querySelector('input[name*="password" i], input[id*="password" i]') !== null;
      }
      return sensitive;
    } catch {
      return true;
    }
  }

  if (isSensitiveSurface()) return;

  var host = document.createElement('div');
  host.id = CHIP_ID;
  host.setAttribute('role', 'note');
  host.setAttribute('aria-label', 'Opera Agent sedang menggunakan tab ini');
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'pointer-events: none',
    'font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    'color-scheme: dark'
  ].join(';');

  var shadow = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = [
    '.chip {',
    '  display: flex; align-items: center; gap: 8px;',
    '  padding: 6px 12px 6px 10px; border-radius: 999px;',
    '  background: rgba(12, 12, 14, 0.88);',
    '  backdrop-filter: blur(8px);',
    '  border: 1px solid rgba(255, 255, 255, 0.08);',
    '  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);',
    '  font-size: 12px; font-weight: 500; color: #e8e8ea;',
    '  letter-spacing: 0.01em; line-height: 1;',
    '}',
    '.dot {',
    '  width: 8px; height: 8px; border-radius: 999px;',
    '  background: #34d399;',
    '  animation: pulse 1.6s ease-in-out infinite;',
    '}',
    '.label { color: #e8e8ea; }',
    '@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }'
  ].join('\n');
  var chip = document.createElement('div');
  chip.className = 'chip';
  var dot = document.createElement('span');
  dot.className = 'dot';
  var label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Opera Agent';
  chip.appendChild(dot);
  chip.appendChild(label);
  shadow.appendChild(style);
  shadow.appendChild(chip);
  document.documentElement.appendChild(host);

  function removeChip() {
    var existing = document.getElementById(CHIP_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || typeof message !== 'object') return;
    if (message.scope === 'opera-agent-content' && message.method === 'chip.hide') removeChip();
  });

  // If the page turns into a sensitive surface while the agent is in it, the mark goes away.
  var observer = new MutationObserver(function () {
    if (isSensitiveSurface()) {
      removeChip();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();
