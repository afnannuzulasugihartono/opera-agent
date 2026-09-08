(() => {
  'use strict';
  if (globalThis.__operaAgentContentV1) return;
  globalThis.__operaAgentContentV1 = true;

  const MAX_TEXT_CHUNK = 12000;
  const MAX_ELEMENTS = 200;
  const MAX_QUERY = 100;
  const MAX_LINKS = 500;
  const documentId = crypto.randomUUID();
  let refCounter = 0;
  const refs = new WeakMap();
  const reverseRefs = new Map();
  let disposed = false;

  const NAV_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space', ' '
  ]);

  const SENSITIVE_RE = /(?:password|passwd|passcode|pin\b|one[-_ ]?time|otp\b|2fa|two[-_ ]?factor|verification\s*code|security\s*code|cvv|cvc|card\s*code)/i;

  function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clean(value, max = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getRef(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    let ref = refs.get(el);
    if (!ref) {
      refCounter += 1;
      ref = `oa_${documentId.slice(0, 8)}_${refCounter.toString(36)}`;
      refs.set(el, ref);
      reverseRefs.set(ref, el);
    }
    return ref;
  }

  function resolveRef(ref) {
    const el = reverseRefs.get(String(ref || ''));
    return el && el.isConnected ? el : null;
  }

  function getAssociatedLabel(el) {
    const parts = [];
    const aria = el.getAttribute?.('aria-label');
    if (aria) parts.push(aria);
    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || '');
      }
    }
    if (el.labels) {
      for (const label of el.labels) parts.push(label.innerText || label.textContent || '');
    }
    const title = el.getAttribute?.('title');
    if (title) parts.push(title);
    const placeholder = el.getAttribute?.('placeholder');
    if (placeholder) parts.push(placeholder);
    if (!parts.length) parts.push(el.innerText || el.textContent || '');
    return clean(parts.filter(Boolean).join(' '), 300);
  }

  function isVisible(el) {
    if (!el?.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function rectOf(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2
    };
  }

  function sensitiveDescriptor(el) {
    const type = clean(el.getAttribute?.('type'), 50).toLowerCase();
    const autocomplete = clean(el.getAttribute?.('autocomplete'), 120).toLowerCase();
    const descriptor = [
      type,
      autocomplete,
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      getAssociatedLabel(el)
    ].filter(Boolean).join(' ');
    if (type === 'password') return 'password';
    if (type === 'file') return 'file';
    if (/(?:current-password|new-password|one-time-code)/i.test(autocomplete)) return 'credential';
    if (SENSITIVE_RE.test(descriptor)) return 'sensitive';
    return null;
  }

  function assertEditableSafe(el) {
    if (!el) throw new Error('Element not found or reference is stale.');
    const blocked = sensitiveDescriptor(el);
    if (blocked) throw new Error(`Sensitive field blocked (${blocked}).`);
    if (el instanceof HTMLInputElement && el.type === 'file') throw new Error('File upload fields are blocked.');
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
      throw new Error('Element is not editable.');
    }
    if (el.disabled || el.readOnly) throw new Error('Element is disabled or read-only.');
  }

  function serialize(el, options = {}) {
    const includeValue = !!options.includeValue;
    const blocked = sensitiveDescriptor(el);
    const data = {
      ref: getRef(el),
      tag: String(el.tagName || '').toLowerCase(),
      role: clean(el.getAttribute?.('role'), 80),
      text: clean(el.innerText || el.textContent || '', 300),
      label: getAssociatedLabel(el),
      href: el instanceof HTMLAnchorElement ? clean(el.href, 1200) : '',
      type: clean(el.getAttribute?.('type'), 80),
      name: clean(el.getAttribute?.('name'), 120),
      placeholder: clean(el.getAttribute?.('placeholder'), 200),
      checked: 'checked' in el ? !!el.checked : undefined,
      selected: 'selected' in el ? !!el.selected : undefined,
      disabled: 'disabled' in el ? !!el.disabled : undefined,
      ariaPressed: el.getAttribute?.('aria-pressed') ?? null,
      ariaChecked: el.getAttribute?.('aria-checked') ?? null,
      ariaExpanded: el.getAttribute?.('aria-expanded') ?? null,
      ariaSelected: el.getAttribute?.('aria-selected') ?? null,
      visible: isVisible(el),
      sensitive: !!blocked,
      rect: rectOf(el)
    };
    if (includeValue && !blocked && ('value' in el || el.isContentEditable)) {
      data.value = clean(el.isContentEditable ? el.textContent : el.value, 2000);
    }
    return data;
  }

  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'option', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]', '[contenteditable="true"]'
  ].join(',');

  function interactiveElements(maxElements = 120) {
    const max = clamp(maxElements, 1, MAX_ELEMENTS, 120);
    return [...document.querySelectorAll(INTERACTIVE_SELECTOR)]
      .filter((el) => el.isConnected)
      .slice(0, max)
      .map((el) => serialize(el));
  }

  function pageRead(args) {
    const fullText = normalizeText(document.body?.innerText || document.documentElement?.innerText || '');
    const offset = clamp(args.offset, 0, Math.max(0, fullText.length), 0);
    const limit = clamp(args.limit ?? args.maxText, 300, MAX_TEXT_CHUNK, 6000);
    const text = fullText.slice(offset, offset + limit);
    const nextOffset = offset + text.length;
    return {
      ok: true,
      page: {
        documentId,
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        text,
        textOffset: offset,
        textChars: text.length,
        totalTextChars: fullText.length,
        nextOffset: nextOffset < fullText.length ? nextOffset : null,
        hasMore: nextOffset < fullText.length,
        elements: interactiveElements(args.maxElements)
      }
    };
  }

  function pageQuery(args) {
    const selector = String(args.selector || '');
    if (!selector || selector.length > 500) throw new Error('Invalid selector.');
    const limit = clamp(args.limit, 1, MAX_QUERY, 30);
    let nodes;
    try {
      nodes = [...document.querySelectorAll(selector)];
    } catch {
      throw new Error('Invalid CSS selector.');
    }
    if (args.visibleOnly !== false) nodes = nodes.filter(isVisible);
    const items = nodes.slice(0, limit).map((el) => serialize(el, { includeValue: !!args.includeValue }));
    const index = Number.isInteger(args.index) ? args.index : null;
    return {
      ok: true,
      count: nodes.length,
      item: index != null && index >= 0 ? items[index] ?? null : items[0] ?? null,
      items
    };
  }

  function pageFind(args) {
    const text = clean(args.text, 300).toLowerCase();
    const role = clean(args.role, 80).toLowerCase();
    const tag = clean(args.tag, 80).toLowerCase();
    const exact = !!args.exact;
    const limit = clamp(args.limit, 1, MAX_QUERY, 30);
    let nodes = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
    if (args.visibleOnly !== false) nodes = nodes.filter(isVisible);
    nodes = nodes.filter((el) => {
      const s = serialize(el);
      if (role && String(s.role).toLowerCase() !== role) return false;
      if (tag && String(s.tag).toLowerCase() !== tag) return false;
      if (!text) return true;
      const hay = `${s.label} ${s.text} ${s.placeholder}`.toLowerCase();
      return exact ? hay.trim() === text : hay.includes(text);
    });
    const items = nodes.slice(0, limit).map((el) => serialize(el, { includeValue: !!args.includeValue }));
    const index = Number.isInteger(args.index) ? args.index : 0;
    return { ok: true, count: nodes.length, item: items[index] ?? null, items };
  }

  function collectLinks(args) {
    const max = clamp(args.limit, 1, MAX_LINKS, 200);
    const sameOrigin = !!args.sameOrigin;
    const seen = new Set();
    const links = [];
    for (const a of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(a.href, location.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (sameOrigin && url.origin !== location.origin) continue;
      url.hash = '';
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ url: key, text: clean(a.innerText || a.textContent || a.getAttribute('aria-label') || '', 300) });
      if (links.length >= max) break;
    }
    return { ok: true, links, count: links.length };
  }

  function nativeSetValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickSynthetic(args) {
    const el = resolveRef(args.ref);
    if (!el) throw new Error('Element not found or reference is stale.');
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload fields are blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus?.({ preventScroll: true });
    el.click();
    return { ok: true, ref: args.ref, method: 'synthetic' };
  }

  function fill(args) {
    const el = resolveRef(args.ref);
    assertEditableSafe(el);
    const value = String(args.value ?? '').slice(0, 20000);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    nativeSetValue(el, value);
    return { ok: true, ref: args.ref, valueLength: value.length };
  }

  function focus(args) {
    const el = resolveRef(args.ref);
    if (!el) throw new Error('Element not found or reference is stale.');
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload fields are blocked.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    return { ok: true, ref: args.ref, sensitive: !!sensitiveDescriptor(el) };
  }

  function clickInfo(args) {
    const el = resolveRef(args.ref);
    if (!el) throw new Error('Element not found or reference is stale.');
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload fields are blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = rectOf(el);
    return { ok: true, ref: args.ref, rect, sensitive: !!sensitiveDescriptor(el) };
  }

  function scroll(args) {
    const x = clamp(args.x, -1000000, 1000000, 0);
    const y = clamp(args.y, -1000000, 1000000, 0);
    const behavior = args.behavior === 'smooth' ? 'smooth' : 'instant';
    if (args.ref) {
      const el = resolveRef(args.ref);
      if (!el) throw new Error('Element not found or reference is stale.');
      el.scrollIntoView({ block: args.block || 'center', inline: args.inline || 'center', behavior });
    } else if (args.absolute) {
      scrollTo({ left: x, top: y, behavior });
    } else {
      scrollBy({ left: x, top: y, behavior });
    }
    return { ok: true, scrollX, scrollY };
  }

  function key(args) {
    const keyName = args.key === 'Space' ? ' ' : String(args.key || '');
    if (!NAV_KEYS.has(args.key) && !NAV_KEYS.has(keyName)) throw new Error('Key is not allowlisted.');
    const target = document.activeElement || document.body;
    const blocked = target && sensitiveDescriptor(target);
    if (blocked) throw new Error(`Keyboard input blocked on sensitive field (${blocked}).`);
    const common = { key: keyName, code: args.code || '', bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', common));
    target.dispatchEvent(new KeyboardEvent('keyup', common));
    return { ok: true, key: args.key };
  }

  function stateMatches(el, state) {
    if (!state) return true;
    for (const [key, expected] of Object.entries(state)) {
      let actual;
      if (key === 'visible') actual = isVisible(el);
      else if (key === 'enabled') actual = !el.disabled;
      else if (key === 'checked') actual = !!el.checked;
      else if (key === 'selected') actual = !!el.selected;
      else if (key === 'ariaPressed') actual = el.getAttribute('aria-pressed');
      else if (key === 'ariaChecked') actual = el.getAttribute('aria-checked');
      else if (key === 'ariaExpanded') actual = el.getAttribute('aria-expanded');
      else if (key === 'ariaSelected') actual = el.getAttribute('aria-selected');
      else actual = el.getAttribute?.(key);
      if (String(actual) !== String(expected)) return false;
    }
    return true;
  }

  async function waitFor(args) {
    const timeoutMs = clamp(args.timeoutMs, 50, 30000, 8000);
    const intervalMs = clamp(args.intervalMs, 25, 1000, 75);
    const deadline = Date.now() + timeoutMs;
    const text = clean(args.text, 300).toLowerCase();
    while (Date.now() <= deadline) {
      let candidates = [];
      if (args.ref) {
        const el = resolveRef(args.ref);
        if (el) candidates = [el];
      } else if (args.selector) {
        try { candidates = [...document.querySelectorAll(String(args.selector))]; } catch { throw new Error('Invalid CSS selector.'); }
      } else {
        candidates = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
      }
      const found = candidates.find((el) => {
        if (args.visibleOnly !== false && !isVisible(el)) return false;
        if (text) {
          const s = serialize(el);
          const hay = `${s.label} ${s.text} ${s.placeholder}`.toLowerCase();
          if (!hay.includes(text)) return false;
        }
        return stateMatches(el, args.state);
      });
      if (found) return { ok: true, item: serialize(found, { includeValue: !!args.includeValue }) };
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { ok: false, error: 'wait_for timeout' };
  }

  function mediaElement(index = 0) {
    return [...document.querySelectorAll('video,audio')][clamp(index, 0, 50, 0)] || null;
  }

  function mediaState(args) {
    const all = [...document.querySelectorAll('video,audio')];
    const el = all[clamp(args.index, 0, Math.max(0, all.length - 1), 0)] || null;
    if (!el) return { ok: true, media: { present: false, count: 0 } };
    return {
      ok: true,
      media: {
        present: true,
        count: all.length,
        tag: el.tagName.toLowerCase(),
        paused: el.paused,
        ended: el.ended,
        currentTime: Number.isFinite(el.currentTime) ? el.currentTime : null,
        duration: Number.isFinite(el.duration) ? el.duration : null,
        muted: el.muted,
        volume: el.volume,
        readyState: el.readyState
      }
    };
  }

  async function mediaAction(method, args) {
    const el = mediaElement(args.index);
    if (!el) throw new Error('No media element found.');
    if (method === 'media.play') await el.play();
    else if (method === 'media.pause') el.pause();
    else if (method === 'media.seek') {
      const seconds = Number(args.seconds);
      if (!Number.isFinite(seconds)) throw new Error('Invalid seek time.');
      const max = Number.isFinite(el.duration) ? el.duration : Math.max(seconds, 0);
      el.currentTime = Math.max(0, Math.min(max, seconds));
    }
    return mediaState(args);
  }

  async function handle(method, args = {}) {
    if (disposed) throw new Error('Extension context invalidated.');
    switch (method) {
      case 'page.read': return pageRead(args);
      case 'page.query': return pageQuery(args);
      case 'page.find': return pageFind(args);
      case 'page.collect_links': return collectLinks(args);
      case 'page.click': return clickSynthetic(args);
      case 'page.click_info': return clickInfo(args);
      case 'page.fill': return fill(args);
      case 'page.focus': return focus(args);
      case 'page.scroll': return scroll(args);
      case 'page.key': return key(args);
      case 'page.wait_for': return waitFor(args);
      case 'page.active_state': {
        const el = document.activeElement;
        return { ok: true, active: el ? serialize(el, { includeValue: false }) : null, sensitive: !!(el && sensitiveDescriptor(el)) };
      }
      case 'media.state': return mediaState(args);
      case 'media.play':
      case 'media.pause':
      case 'media.seek': return mediaAction(method, args);
      default: throw new Error('Unsupported content method.');
    }
  }

  function onMessage(message, _sender, sendResponse) {
    if (!message || message.scope !== 'opera-agent-content') return false;
    Promise.resolve(handle(message.method, message.params || {}))
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 1000) }));
    return true;
  }

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {
    disposed = true;
  }

  window.addEventListener('pagehide', () => {
    disposed = true;
    reverseRefs.clear();
  }, { once: true });
})();
