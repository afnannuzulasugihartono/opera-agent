(() => {
  'use strict';
  if (globalThis.__operaAgentContentV2) return;
  globalThis.__operaAgentContentV2 = true;

  const MAX_TEXT_CHUNK = 12000;
  const MAX_ELEMENTS = 200;
  const MAX_QUERY = 100;
  const MAX_LINKS = 500;
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'option', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]', '[contenteditable="true"]'
  ].join(',');
  const NAV_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space', ' '
  ]);
  const SENSITIVE_RE = /(?:password|passwd|passcode|pin\b|one[-_ ]?time|otp\b|2fa|two[-_ ]?factor|verification\s*code|security\s*code|cvv|cvc|card\s*code)/i;

  const documentId = crypto.randomUUID();
  let refCounter = 0;
  let disposed = false;
  let mutationEpoch = 0;
  const refs = new WeakMap();
  const reverseRefs = new Map();
  const textCache = new Map();

  const mutationObserver = new MutationObserver(() => {
    mutationEpoch += 1;
    if (textCache.size > 8) textCache.clear();
  });
  try {
    mutationObserver.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch {}

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
    if (el.labels) for (const label of el.labels) parts.push(label.innerText || label.textContent || '');
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
      type, autocomplete, el.getAttribute?.('name'), el.getAttribute?.('id'),
      el.getAttribute?.('placeholder'), el.getAttribute?.('aria-label'), getAssociatedLabel(el)
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

  function interactiveElements(maxElements = 120) {
    const requested = Number(maxElements);
    if (Number.isFinite(requested) && requested <= 0) return [];
    const max = clamp(maxElements, 1, MAX_ELEMENTS, 120);
    return [...document.querySelectorAll(INTERACTIVE_SELECTOR)]
      .filter((el) => el.isConnected)
      .slice(0, max)
      .map((el) => serialize(el));
  }

  function rootForSelector(selector) {
    if (!selector) return document.body || document.documentElement;
    try {
      return document.querySelector(String(selector));
    } catch {
      throw new Error('Invalid CSS selector.');
    }
  }

  function normalizedPageText(selector = '') {
    const key = String(selector || '');
    const cached = textCache.get(key);
    if (cached && cached.epoch === mutationEpoch) return cached.text;
    const root = rootForSelector(key);
    if (!root) throw new Error('Read root selector did not match an element.');
    const text = normalizeText(root.innerText || root.textContent || '');
    textCache.set(key, { epoch: mutationEpoch, text });
    return text;
  }

  function pageRead(args) {
    const selector = String(args.selector || '');
    const fullText = normalizedPageText(selector);
    const offset = clamp(args.offset, 0, Math.max(0, fullText.length), 0);
    const limit = clamp(args.limit ?? args.maxText, 300, MAX_TEXT_CHUNK, 6000);
    const text = fullText.slice(offset, offset + limit);
    const nextOffset = offset + text.length;
    const includeElements = args.includeElements !== false;
    return {
      ok: true,
      page: {
        documentId,
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        selector: selector || null,
        text,
        textOffset: offset,
        textChars: text.length,
        totalTextChars: fullText.length,
        nextOffset: nextOffset < fullText.length ? nextOffset : null,
        hasMore: nextOffset < fullText.length,
        elements: includeElements ? interactiveElements(args.maxElements) : []
      }
    };
  }

  function queryNodes(selector, visibleOnly = true) {
    if (!selector || String(selector).length > 500) throw new Error('Invalid selector.');
    let nodes;
    try { nodes = [...document.querySelectorAll(String(selector))]; }
    catch { throw new Error('Invalid CSS selector.'); }
    return visibleOnly === false ? nodes : nodes.filter(isVisible);
  }

  function matchesSemantic(el, args) {
    const text = clean(args.text, 300).toLowerCase();
    const role = clean(args.role, 80).toLowerCase();
    const tag = clean(args.tag, 80).toLowerCase();
    if (role && clean(el.getAttribute?.('role'), 80).toLowerCase() !== role) return false;
    if (tag && String(el.tagName || '').toLowerCase() !== tag) return false;
    if (!text) return true;
    const hay = `${getAssociatedLabel(el)} ${clean(el.innerText || el.textContent || '', 300)} ${clean(el.getAttribute?.('placeholder'), 200)}`.toLowerCase();
    return args.exact ? hay.trim() === text : hay.includes(text);
  }

  function semanticNodes(args) {
    let nodes = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
    if (args.visibleOnly !== false) nodes = nodes.filter(isVisible);
    return nodes.filter((el) => matchesSemantic(el, args));
  }

  function resolveTarget(args = {}) {
    if (args.ref) {
      const el = resolveRef(args.ref);
      if (!el) throw new Error('Element not found or reference is stale.');
      return el;
    }
    const index = Number.isInteger(args.index) ? args.index : 0;
    if (args.selector) {
      const nodes = queryNodes(args.selector, args.visibleOnly);
      const el = nodes[index];
      if (!el) throw new Error('Target selector did not match an element.');
      return el;
    }
    if (args.text || args.role || args.tag) {
      const nodes = semanticNodes(args);
      const el = nodes[index];
      if (!el) throw new Error('Semantic target did not match an element.');
      return el;
    }
    throw new Error('Target requires ref, selector, or semantic text/role/tag.');
  }

  function pageQuery(args) {
    const nodes = queryNodes(args.selector, args.visibleOnly);
    const limit = clamp(args.limit, 1, MAX_QUERY, 30);
    const items = nodes.slice(0, limit).map((el) => serialize(el, { includeValue: !!args.includeValue }));
    const index = Number.isInteger(args.index) ? args.index : 0;
    return { ok: true, count: nodes.length, item: items[index] ?? null, items };
  }

  function pageFind(args) {
    const nodes = semanticNodes(args);
    const limit = clamp(args.limit, 1, MAX_QUERY, 30);
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
    const el = resolveTarget(args);
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload interaction is blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus?.({ preventScroll: true });
    el.click();
    return { ok: true, ref: getRef(el), method: 'synthetic' };
  }

  function fill(args) {
    const el = resolveTarget(args);
    assertEditableSafe(el);
    const value = String(args.value ?? '').slice(0, 20000);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    nativeSetValue(el, value);
    return { ok: true, ref: getRef(el), valueLength: value.length };
  }

  function focus(args) {
    const el = resolveTarget(args);
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload interaction is blocked.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    return { ok: true, ref: getRef(el), sensitive: !!sensitiveDescriptor(el) };
  }

  function clickInfo(args) {
    const el = resolveTarget(args);
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload interaction is blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return { ok: true, ref: getRef(el), rect: rectOf(el), sensitive: !!sensitiveDescriptor(el) };
  }

  function scroll(args) {
    const x = clamp(args.x, -1000000, 1000000, 0);
    const y = clamp(args.y, -1000000, 1000000, 0);
    const behavior = args.behavior === 'smooth' ? 'smooth' : 'instant';
    if (args.ref || args.selector || args.text || args.role || args.tag) {
      const el = resolveTarget(args);
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
    let target = document.activeElement || document.body;
    if (args.ref || args.selector || args.text || args.role || args.tag) {
      target = resolveTarget(args);
      if (sensitiveDescriptor(target) === 'file') throw new Error('File upload interaction is blocked.');
      target.focus?.({ preventScroll: true });
    }
    const blocked = target && sensitiveDescriptor(target);
    if (blocked) throw new Error(`Keyboard input blocked on sensitive field (${blocked}).`);
    const common = { key: keyName, code: args.code || '', bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', common));
    target.dispatchEvent(new KeyboardEvent('keyup', common));
    return { ok: true, key: args.key, ref: target ? getRef(target) : null };
  }

  function stateMatches(el, state) {
    if (!state) return true;
    for (const [keyName, expected] of Object.entries(state)) {
      let actual;
      if (keyName === 'visible') actual = isVisible(el);
      else if (keyName === 'enabled') actual = !el.disabled;
      else if (keyName === 'checked') actual = !!el.checked;
      else if (keyName === 'selected') actual = !!el.selected;
      else if (keyName === 'ariaPressed') actual = el.getAttribute('aria-pressed');
      else if (keyName === 'ariaChecked') actual = el.getAttribute('aria-checked');
      else if (keyName === 'ariaExpanded') actual = el.getAttribute('aria-expanded');
      else if (keyName === 'ariaSelected') actual = el.getAttribute('aria-selected');
      else actual = el.getAttribute?.(keyName);
      if (String(actual) !== String(expected)) return false;
    }
    return true;
  }

  function waitCandidates(args) {
    let candidates;
    if (args.ref) {
      const el = resolveRef(args.ref);
      candidates = el ? [el] : [];
    } else if (args.selector) {
      candidates = queryNodes(args.selector, false);
    } else {
      candidates = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
    }
    const text = clean(args.text, 300).toLowerCase();
    return candidates.filter((el) => {
      if (args.visibleOnly !== false && !isVisible(el)) return false;
      if (text) {
        const hay = `${getAssociatedLabel(el)} ${clean(el.innerText || el.textContent || '', 300)} ${clean(el.getAttribute?.('placeholder'), 200)}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return stateMatches(el, args.state);
    });
  }

  async function waitFor(args) {
    const timeoutMs = clamp(args.timeoutMs, 50, 30000, 8000);
    const absent = !!args.absent;
    const check = () => {
      const matches = waitCandidates(args);
      if (absent) return matches.length === 0 ? { ok: true, item: null, absent: true } : null;
      return matches[0] ? { ok: true, item: serialize(matches[0], { includeValue: !!args.includeValue }), absent: false } : null;
    };
    const initial = check();
    if (initial) return initial;

    return await new Promise((resolve) => {
      let finished = false;
      let observer;
      let interval;
      let timer;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        try { observer?.disconnect(); } catch {}
        if (interval) clearInterval(interval);
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const run = () => {
        try {
          const result = check();
          if (result) finish(result);
        } catch (error) {
          finish({ ok: false, error: String(error?.message || error).slice(0, 1000) });
        }
      };
      observer = new MutationObserver(run);
      try { observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {}
      interval = setInterval(run, 250);
      timer = setTimeout(() => finish({ ok: false, error: 'wait_for timeout' }), timeoutMs);
    });
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
      case 'content.ping': return { ok: true, documentId, readyState: document.readyState, url: location.href };
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

  try { chrome.runtime.onMessage.addListener(onMessage); }
  catch { disposed = true; }

  window.addEventListener('pagehide', () => {
    disposed = true;
    reverseRefs.clear();
    textCache.clear();
    try { mutationObserver.disconnect(); } catch {}
  }, { once: true });
})();
