(() => {
  'use strict';
  if (globalThis.__operaAgentContentV1) return;
  globalThis.__operaAgentContentV1 = true;
  // R9-C: published by role-reconcile.js, which the manifest loads before this
  // file. Content scripts are classic scripts and cannot import, so the same
  // global pattern as the semantic engines is used.
  const { implicitRole } = globalThis.OperaAgentRoleReconcile || {};
  if (typeof implicitRole !== 'function') throw new Error('Role reconcile runtime is unavailable.');

  const MAX_TEXT_CHUNK = 12000;
  const MAX_ELEMENTS = 200;
  const MAX_QUERY = 100;
  const MAX_LINKS = 500;
  const documentId = crypto.randomUUID();
  const semanticIdentity = globalThis.OperaAgentSemanticIdentity?.createIdentityEngine({ documentId });
  if (!semanticIdentity) throw new Error('Semantic identity runtime is unavailable.');
  const semanticViews = globalThis.OperaAgentSemanticViews?.createViewEngine();
  if (!semanticViews) throw new Error('Semantic view runtime is unavailable.');
  let refCounter = 0;
  let refs = new WeakMap();
  let reverseRefs = new Map();
  let actionRefDescriptors = new Map();
  let semanticRouteKey = globalThis.OperaAgentSemanticIdentity.stableHash(`${location.origin}${location.pathname}${location.search}`);
  let semanticRuntimeEpoch = null;
  let disposed = false;
  let mutationVersion = 0;

  const mutationObserver = new MutationObserver(() => {
    mutationVersion += 1;
    scheduleWatchCheck();
  });
  mutationObserver.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  const NAV_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space', ' '
  ]);

  const SENSITIVE_RE = /(?:password|passwd|passcode|pin\b|one[-_ ]?time|otp\b|2fa|two[-_ ]?factor|verification\s*code|security\s*code|cvv|cvc|card\s*(?:code|number)|credit\s*card|expiry|expiration|payment)/i;

  function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clean(value, max = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // Model-facing labels pick up private-use glyphs (icon fonts) and status
  // suffixes like "Visited link" that break exact matching; strip them before
  // the text reaches results or find matching.
  const PUA_GLYPH_RE = /[\uE000-\uF8FF\u200B\u200C\uFEFF]|\u200D/g;
  const VISITED_SUFFIX_RE = /\s*visited link\s*$/i;
  function normalizeObservableText(value, max = 500) {
    const text = clean(value, max + 40).replace(PUA_GLYPH_RE, ' ').replace(/\s+/g, ' ').trim();
    const untagged = VISITED_SUFFIX_RE.test(text) ? text.replace(VISITED_SUFFIX_RE, '').trim() : text;
    return untagged.slice(0, max);
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function currentRouteKey() {
    return globalThis.OperaAgentSemanticIdentity.stableHash(
      `${location.origin}${location.pathname}${location.search}`
    );
  }

  function actionRefDescriptor(el, options = {}) {
    const identity = stableElementIdentity(el);
    return {
      documentId,
      routeKey: currentRouteKey(),
      stableKey: identity.stableKey,
      stableKeySource: identity.stableKeySource,
      id: clean(el.id, 200),
      tag: String(el.tagName || '').toLowerCase(),
      role: clean(el.getAttribute?.('role'), 80),
      name: clean(el.getAttribute?.('name'), 120),
      type: clean(el.getAttribute?.('type'), 80),
      label: getAssociatedLabel(el),
      href: el instanceof HTMLAnchorElement ? clean(el.href, 1200) : '',
      sensitive: !!sensitiveDescriptor(el),
      rectAtMint: options.rectAtMint ?? null,
      mutationVersionAtMint: options.mutationVersionAtMint ?? null
    };
  }

  function descriptorMatchesElement(descriptor, el) {
    if (!descriptor || !el?.isConnected) return false;
    if (descriptor.documentId !== documentId || descriptor.routeKey !== currentRouteKey()) return false;
    const current = actionRefDescriptor(el);
    return (
      current.documentId === descriptor.documentId
      && current.routeKey === descriptor.routeKey
      && current.stableKey === descriptor.stableKey
      && current.stableKeySource === descriptor.stableKeySource
      && current.id === descriptor.id
      && current.tag === descriptor.tag
      && current.role === descriptor.role
      && current.name === descriptor.name
      && current.type === descriptor.type
      && current.label === descriptor.label
      && current.href === descriptor.href
      && current.sensitive === descriptor.sensitive
    );
  }

  // U-I (I1): a ref minted before a geometric relocation must not silently
  // rebind to an element that now sits somewhere else — that produced the
  // production Street-View mis-click. Rebind is allowed only when the current
  // target still sits within the mint-time geometry tolerance. Comparison
  // happens in document coordinates so ordinary scrolling never trips it.
  const GEOMETRY_DRIFT_TOLERANCE_PX = 24;

  function documentRectOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  }

  function geometryMatchesMint(el, descriptor) {
    if (!descriptor?.rectAtMint) return true;
    const rect = documentRectOf(el);
    const mint = descriptor.rectAtMint;
    return (
      Math.abs(rect.x - mint.x) <= GEOMETRY_DRIFT_TOLERANCE_PX
      && Math.abs(rect.y - mint.y) <= GEOMETRY_DRIFT_TOLERANCE_PX
      && Math.abs(rect.width - mint.width) <= GEOMETRY_DRIFT_TOLERANCE_PX
      && Math.abs(rect.height - mint.height) <= GEOMETRY_DRIFT_TOLERANCE_PX
    );
  }

  // U-I (I4, live T041 evidence 2026-09-21 07:47:45Z): the keyed rebind pool
  // goes empty when the page recreates a control whose keyed successor is
  // rewritten without its original id (YouTube rebuilt the Skip button during
  // the ad lifecycle between find and click). Match a unique replacement by
  // intrinsic signature instead: identical visible key, tag, and explicit
  // fields, still actionable and non-sensitive. Uniqueness is enforced by the
  // caller (candidates must be exactly one) and the mint-time geometry guard
  // still decides, so a same-place successor rebinds but a moved or ambiguous
  // one fails closed.
  function signatureRebindCandidates(descriptor) {
    const expectedKey = clean(descriptor.label || descriptor.text, 300);
    if (!expectedKey) return [];
    let pool = [];
    try {
      pool = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].slice(0, 500);
    } catch {
      return [];
    }
    return pool.filter((el) => {
      const visibleKey = clean(getAssociatedLabel(el) || el.innerText || el.textContent || '', 300);
      if (visibleKey !== expectedKey) return false;
      if (String(el.tagName || '').toLowerCase() !== descriptor.tag) return false;
      if (descriptor.href && !(el instanceof HTMLAnchorElement && clean(el.href, 1200) === descriptor.href)) return false;
      if (descriptor.role && clean(el.getAttribute?.('role'), 80) !== descriptor.role) return false;
      if (descriptor.type && clean(el.getAttribute?.('type'), 80) !== descriptor.type) return false;
      if (descriptor.name && clean(el.getAttribute?.('name'), 120) !== descriptor.name) return false;
      const state = actionabilityState(el);
      return state.actionable && !state.sensitive;
    });
  }

  function revalidationCandidates(descriptor) {
    if (!descriptor || descriptor.documentId !== documentId || descriptor.routeKey !== currentRouteKey()) return [];
    let pool = [];
    if (descriptor.stableKeySource === 'id' && descriptor.id) {
      try {
        pool = [...document.querySelectorAll(`#${CSS.escape(descriptor.id)}`)];
      } catch {
        return [];
      }
    } else if (descriptor.stableKeySource === 'href' && descriptor.href) {
      pool = [...document.querySelectorAll('a[href]')].filter(
        (el) => clean(el.href, 1200) === descriptor.href
      );
    } else {
      const maxScan = 500;
      pool = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].slice(0, maxScan);
    }
    const keyed = pool.filter((el) => {
      if (!descriptorMatchesElement(descriptor, el)) return false;
      const state = actionabilityState(el);
      return state.actionable && !state.sensitive;
    });
    if (keyed.length > 0 || descriptor.stableKeySource === 'semantic') return keyed;
    // Keyed successor recreated without its id: fall back to the intrinsic
    // signature pool. The caller still requires exactly one candidate and the
    // geometry guard still applies before any rebind.
    return keyed.concat(signatureRebindCandidates(descriptor));
  }

  function getRef(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    let ref = refs.get(el);
    if (!ref) {
      refCounter += 1;
      ref = `oa_${documentId.slice(0, 8)}_${refCounter.toString(36)}`;
      refs.set(el, ref);
      reverseRefs.set(ref, el);
      actionRefDescriptors.set(ref, actionRefDescriptor(el, { rectAtMint: documentRectOf(el), mutationVersionAtMint: mutationVersion }));
    }
    return ref;
  }

  function resolveRef(ref) {
    const key = String(ref || '');
    const el = reverseRefs.get(key);
    return el && el.isConnected ? el : null;
  }

  function resolveActionRef(ref) {
    const key = String(ref || '');
    const descriptor = actionRefDescriptors.get(key);
    if (!descriptor) return null;
    if (descriptor.documentId !== documentId || descriptor.routeKey !== currentRouteKey()) return null;

    const connected = resolveRef(key);
    if (connected) {
      if (!descriptorMatchesElement(descriptor, connected)) return null;
      // Preserve the historical explicit file-upload rejection without granting
      // sensitive revalidation authority. Only the original connected file
      // target may reach the caller's immediate fail-closed file guard.
      if (descriptor.sensitive) {
        return sensitiveDescriptor(connected) === 'file' ? connected : null;
      }
      return connected;
    }

    if (descriptor.sensitive) return null;
    const candidates = revalidationCandidates(descriptor);
    if (candidates.length !== 1) return null;

    const replacement = candidates[0];
    if (!geometryMatchesMint(replacement, descriptor)) {
      const currentCandidates = candidates.slice(0, 3).map((el) => {
        const s = serialize(el);
        return { label: s.label || s.text, tag: s.tag, rect: rectOf(el) };
      });
      throw new Error(
        `Ref target moved beyond the geometry tolerance since mint `
        + `(mutationVersion ${descriptor.mutationVersionAtMint ?? 'unknown'} -> ${mutationVersion}); `
        + `refusing automatic rebind. Current plausible candidates: ${JSON.stringify(currentCandidates)}. `
        + `Re-run page.find and use a fresh ref.`
      );
    }
    const existingRef = refs.get(replacement);
    if (existingRef && existingRef !== key) reverseRefs.delete(existingRef);
    refs.set(replacement, key);
    reverseRefs.set(key, replacement);
    actionRefDescriptors.set(key, actionRefDescriptor(replacement));
    return replacement;
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

  // U-P1 (research P1): document.elementFromPoint retargets at open shadow
  // boundaries, so a control inside an open shadow root hit-tests as its
  // host element. Accept a hit when it is the element, a light-DOM
  // descendant, or a host on the element's composed path.
  function composedHostChain(el) {
    const hosts = [];
    let node = el;
    while (node) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      hosts.push(root.host);
      node = root.host;
    }
    return hosts;
  }

  function hitTestAcceptable(el, hit) {
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    for (const host of composedHostChain(el)) {
      if (hit === host || host.contains(hit) || hit.contains(host)) return true;
    }
    return false;
  }

  function hitTestReachable(el, rect) {
    const left = Math.max(0, rect.left);
    const right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return false;
    const insetX = Math.min(1, (right - left) / 4);
    const insetY = Math.min(1, (bottom - top) / 4);
    const points = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + insetX, top + insetY],
      [right - insetX, top + insetY],
      [left + insetX, bottom - insetY],
      [right - insetX, bottom - insetY]
    ];
    return points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hitTestAcceptable(el, hit);
    });
  }

  // inViewport keeps its original overlap semantics; fullyInViewport adds
  // strict viewport containment and viewportClipped reports whether an
  // ancestor's overflow box actually cut the element (transformed Maps-style
  // panels report large negative x without any ancestor clipping).
  function viewportFlags(el) {
    if (!isVisible(el)) return { inViewport: false, fullyInViewport: false, viewportClipped: false };
    const rect = el.getBoundingClientRect();
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return { inViewport: false, fullyInViewport: false, viewportClipped: false };
    }
    let left = rect.left;
    let right = rect.right;
    let top = rect.top;
    let bottom = rect.bottom;
    let clippedByAncestor = false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clipsX = /^(?:auto|scroll|hidden|clip)$/.test(style.overflowX);
      const clipsY = /^(?:auto|scroll|hidden|clip)$/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const parentRect = parent.getBoundingClientRect();
      const newLeft = clipsX ? Math.max(left, parentRect.left) : left;
      const newRight = clipsX ? Math.min(right, parentRect.right) : right;
      const newTop = clipsY ? Math.max(top, parentRect.top) : top;
      const newBottom = clipsY ? Math.min(bottom, parentRect.bottom) : bottom;
      if (newRight <= newLeft || newBottom <= newTop) {
        if (hitTestReachable(el, rect)) {
          const fully = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
          return { inViewport: true, fullyInViewport: fully, viewportClipped: false };
        }
        return { inViewport: false, fullyInViewport: false, viewportClipped: true };
      }
      if (newLeft !== left || newRight !== right || newTop !== top || newBottom !== bottom) clippedByAncestor = true;
      left = newLeft;
      right = newRight;
      top = newTop;
      bottom = newBottom;
    }
    const fully = left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight;
    return { inViewport: true, fullyInViewport: fully, viewportClipped: clippedByAncestor };
  }

  function isInViewport(el) {
    return viewportFlags(el).inViewport;
  }

  function actionabilityState(el, sensitiveReason = undefined) {
    const visible = isVisible(el);
    const viewport = visible ? viewportFlags(el) : { inViewport: false, fullyInViewport: false, viewportClipped: false };
    const sensitive = sensitiveReason === undefined ? !!sensitiveDescriptor(el) : !!sensitiveReason;
    const ariaDisabled = clean(el?.getAttribute?.('aria-disabled'), 20).toLowerCase() === 'true';
    const nativeDisabled = !!(el && 'disabled' in el && el.disabled);
    const readOnly = !!(el && 'readOnly' in el && el.readOnly);
    const enabled = !nativeDisabled && !readOnly && !ariaDisabled;
    const pointerEnabled = visible && getComputedStyle(el).pointerEvents !== 'none';
    return {
      visible,
      inViewport: viewport.inViewport,
      fullyInViewport: viewport.fullyInViewport,
      viewportClipped: viewport.viewportClipped,
      enabled,
      sensitive,
      pointerEnabled,
      actionable: visible && viewport.inViewport && enabled && !sensitive && pointerEnabled
    };
  }

  function actionabilityRank(el) {
    const state = actionabilityState(el);
    if (state.actionable) return 0;
    if (state.sensitive) return 5;
    if (!state.visible) return 4;
    if (state.inViewport) return 1;
    if (state.enabled) return 2;
    return 3;
  }

  function prioritizeActionableNodes(nodes) {
    return nodes
      .map((el, index) => ({ el, index, rank: actionabilityRank(el) }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((entry) => entry.el);
  }

  function stableHash(value) {
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second = Math.imul(second, 33) ^ code;
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function stableElementIdentity(el) {
    const tag = String(el.tagName || '').toLowerCase();
    const href = el instanceof HTMLAnchorElement ? clean(el.href, 1200) : '';
    const id = clean(el.id, 200);
    const role = clean(el.getAttribute?.('role'), 80);
    const name = clean(el.getAttribute?.('name'), 120);
    const label = getAssociatedLabel(el);
    const text = clean(el.innerText || el.textContent || '', 300);
    const source = href ? `href:${href}` : id ? `id:${id}` : `semantic:${tag}|${role}|${name}|${label}|${text}`;
    return { stableKey: `oa_${stableHash(source)}`, stableKeySource: href ? 'href' : id ? 'id' : 'semantic' };
  }

  function viewportState() {
    const root = document.scrollingElement || document.documentElement;
    const visual = globalThis.visualViewport;
    return {
      width: innerWidth,
      height: innerHeight,
      scrollX,
      scrollY,
      documentWidth: Math.max(root?.scrollWidth || 0, document.documentElement?.scrollWidth || 0),
      documentHeight: Math.max(root?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
      devicePixelRatio,
      visualScale: Number.isFinite(visual?.scale) ? visual.scale : 1,
      visualOffsetX: Number.isFinite(visual?.offsetLeft) ? visual.offsetLeft : 0,
      visualOffsetY: Number.isFinite(visual?.offsetTop) ? visual.offsetTop : 0
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
    const actionability = actionabilityState(el, blocked);
    const text = normalizeObservableText(el.innerText || el.textContent || '', 300);
    const label = normalizeObservableText(getAssociatedLabel(el), 300);
    // U-P1: attach the computed accessible name only when it adds signal the
    // label/text fields do not already carry, keeping payloads bounded.
    const accessibleName = computeAccessibleName(el);
    // R9-C: an explicit author role still wins; otherwise derive the role the
    // platform would report from the element's own markup, so an unannotated
    // <button> is no longer serialized as role ''.
    const tag = String(el.tagName || '').toLowerCase();
    const explicitRole = clean(el.getAttribute?.('role'), 80);
    const role = explicitRole || implicitRole({
      tag,
      type: clean(el.getAttribute?.('type'), 80),
      href: el instanceof HTMLAnchorElement ? clean(el.href, 1200) : '',
      contenteditable: el.isContentEditable === true
    });
    const data = {
      ...stableElementIdentity(el),
      ref: getRef(el),
      tag,
      role,
      text,
      label,
      href: el instanceof HTMLAnchorElement ? clean(el.href, 1200) : '',
      type: clean(el.getAttribute?.('type'), 80),
      name: normalizeObservableText(el.getAttribute?.('name'), 120),
      placeholder: normalizeObservableText(el.getAttribute?.('placeholder'), 200),
      checked: 'checked' in el ? !!el.checked : undefined,
      selected: 'selected' in el ? !!el.selected : undefined,
      disabled: 'disabled' in el ? !!el.disabled : undefined,
      ariaPressed: el.getAttribute?.('aria-pressed') ?? null,
      ariaChecked: el.getAttribute?.('aria-checked') ?? null,
      ariaExpanded: el.getAttribute?.('aria-expanded') ?? null,
      ariaSelected: el.getAttribute?.('aria-selected') ?? null,
      accessibleName: accessibleName && accessibleName !== label && accessibleName !== text
        ? accessibleName
        : undefined,
      visible: actionability.visible,
      inViewport: actionability.inViewport,
      fullyInViewport: actionability.fullyInViewport,
      viewportClipped: actionability.viewportClipped,
      sensitive: actionability.sensitive,
      actionable: actionability.actionable,
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

  // U-P1 (research P1): flat document scans miss controls inside open shadow
  // roots; collect through open shadow boundaries with a bounded traversal.
  // Closed roots stay invisible (fail closed) and deeper trees stop at the
  // bounds below, so the walk stays proportional to existing observation work.
  const MAX_SHADOW_ROOTS = 120;
  const MAX_COLLECTED_NODES = 600;
  function collectInteractiveNodes() {
    const nodes = [];
    const seen = new Set();
    let shadowRoots = 0;
    const visit = (root) => {
      let matches;
      try { matches = [...root.querySelectorAll(INTERACTIVE_SELECTOR)]; } catch { return; }
      for (const el of matches) {
        if (!el.isConnected || seen.has(el)) continue;
        seen.add(el);
        nodes.push(el);
        if (nodes.length >= MAX_COLLECTED_NODES) return;
      }
      for (const el of root.querySelectorAll('*')) {
        const shadow = el.shadowRoot;
        if (!shadow) continue;
        shadowRoots += 1;
        if (shadowRoots > MAX_SHADOW_ROOTS || nodes.length >= MAX_COLLECTED_NODES) return;
        visit(shadow);
      }
    };
    visit(document);
    return nodes;
  }

  // U-P1 (research P1): compute a bounded accessible name for icon-only
  // controls whose DOM text is glyphs or whitespace. The priority follows the
  // W3C accessible-name subset the serializer already resolves via
  // getAssociatedLabel (aria-label, aria-labelledby, label, title,
  // placeholder); descendant img alt and svg title add the icon vocabulary
  // plain DOM text never carries.
  function computeAccessibleName(el) {
    const primary = normalizeObservableText(getAssociatedLabel(el), 300);
    if (primary) return primary;
    const parts = [];
    for (const img of el?.querySelectorAll?.('img[alt]') || []) {
      const alt = clean(img.getAttribute('alt'), 120);
      if (alt) parts.push(alt);
      if (parts.length >= 5) break;
    }
    for (const title of el?.querySelectorAll?.('svg title') || []) {
      const text = normalizeObservableText(title.textContent, 120);
      if (text) parts.push(text);
      if (parts.length >= 10) break;
    }
    return parts.join(' ');
  }

  function semanticRegionObservation(maxElements = 120) {
    const max = clamp(maxElements, 1, MAX_ELEMENTS, 120);
    const nodes = prioritizeActionableNodes(collectInteractiveNodes()).slice(0, max);
    const regionNodes = new Set([document.body || document.documentElement]);
    const semanticSelector = 'main,nav,aside,header,footer,form,dialog,[role="dialog"],[role="feed"],[role="list"],[role="listbox"],[role="grid"],[role="table"]';
    for (const node of document.querySelectorAll(semanticSelector)) {
      regionNodes.add(node);
      if (regionNodes.size >= 30) break;
    }
    const inspectedAncestors = new Set();
    for (const node of nodes) {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (inspectedAncestors.has(parent)) continue;
        inspectedAncestors.add(parent);
        const style = getComputedStyle(parent);
        if (/^(?:auto|scroll)$/.test(style.overflowY) && parent.scrollHeight - parent.clientHeight > 2) regionNodes.add(parent);
      }
    }
    const boundedRegions = [...regionNodes].filter(Boolean).slice(0, 50);
    const regionIds = new Map();
    const regionKeyCounts = new Map();
    const regions = boundedRegions.map((node) => {
      if (node === document.body || node === document.documentElement) {
        regionIds.set(node, 'rg_document');
        return { regionId: 'rg_document', kind: 'document', role: 'document', label: document.title, scroll: scrollState(node) };
      }
      const tag = String(node.tagName || '').toLowerCase();
      const role = clean(node.getAttribute?.('role'), 80);
      const label = getAssociatedLabel(node);
      const kind = tag === 'form' ? 'form' : tag === 'dialog' || role === 'dialog' ? 'dialog'
        : ['feed', 'list', 'listbox', 'grid', 'table'].includes(role) ? 'repeated'
          : ['main', 'nav', 'aside', 'header', 'footer'].includes(tag) ? 'landmark' : 'scroll';
      const intrinsic = clean(node.id, 120);
      const regionKey = intrinsic ? `id:${intrinsic}` : `${tag}|${role}|${label}`;
      const ordinal = regionKeyCounts.get(regionKey) || 0;
      regionKeyCounts.set(regionKey, ordinal + 1);
      const regionId = `rg_${stableHash(ordinal ? `${regionKey}|${ordinal}` : regionKey)}`;
      regionIds.set(node, regionId);
      const scrollable = node.scrollHeight - node.clientHeight > 2 || node.scrollWidth - node.clientWidth > 2;
      return { regionId, kind, role: role || tag, label, scroll: scrollable ? scrollState(node) : null };
    });
    const items = nodes.map((node) => {
      const item = serialize(node);
      let region = node.parentElement;
      while (region && !regionIds.has(region)) region = region.parentElement;
      item.regionKey = regionIds.get(region) || 'rg_document';
      return item;
    });
    return { regions, items };
  }

  function resetActionRefs() {
    // Keep refCounter monotonic for this content-script lifetime. Reusing a ref
    // after an SPA/runtime reset could revive stale action authority.
    refs = new WeakMap();
    reverseRefs = new Map();
    actionRefDescriptors = new Map();
  }

  function syncSemanticScope(args) {
    let resetReason = null;
    const routeKey = globalThis.OperaAgentSemanticIdentity.stableHash(`${location.origin}${location.pathname}${location.search}`);
    if (routeKey !== semanticRouteKey) {
      semanticRouteKey = routeKey;
      semanticIdentity.reset('SPA_ROUTE');
      semanticViews.reset();
      resetActionRefs();
      resetReason = 'SPA_ROUTE';
    }
    const epoch = clean(args.__semanticRuntimeEpoch, 120);
    if (epoch && semanticRuntimeEpoch && epoch !== semanticRuntimeEpoch) {
      semanticIdentity.reset('EXTENSION_RESTART');
      semanticViews.reset();
      resetActionRefs();
      resetReason = 'EXTENSION_RESTART';
    }
    if (epoch) semanticRuntimeEpoch = epoch;
    return resetReason;
  }

  function observeSemanticBounded(maxElements = 120) {
    const regional = semanticRegionObservation(maxElements);
    const observation = semanticIdentity.observe(regional.items);
    const views = semanticViews.observe({
      regions: regional.regions,
      items: observation.items,
      semanticState: observation.state,
      delta: observation.delta,
    });
    return { regional, observation, views };
  }

  function compactElementProjection(item) {
    const projected = {
      ref: item.ref,
      logicalId: item.logicalId,
      stableKey: item.stableKey,
      tag: item.tag,
      role: item.role,
      text: item.text,
      label: item.label,
      accessibleName: item.accessibleName,
      href: item.href,
      type: item.type,
      name: item.name,
      placeholder: item.placeholder,
      checked: item.checked,
      selected: item.selected,
      disabled: item.disabled,
      ariaPressed: item.ariaPressed,
      ariaChecked: item.ariaChecked,
      ariaExpanded: item.ariaExpanded,
      ariaSelected: item.ariaSelected,
      visible: !!item.visible,
      inViewport: !!item.inViewport,
      actionable: !!item.actionable,
      rect: item.rect
    };
    return Object.fromEntries(
      Object.entries(projected).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  function compactObservationElements(items, delta, limit = 16) {
    const changed = new Set(
      (Array.isArray(delta?.changes) ? delta.changes : [])
        .map((change) => String(change?.logicalId || ''))
        .filter(Boolean)
    );
    const selected = [];
    const selectedIds = new Set();
    const add = (item) => {
      if (!item || item.sensitive || item.stale) return;
      const key = String(item.logicalId || item.ref || item.stableKey || '');
      if (!key || selectedIds.has(key) || selected.length >= limit) return;
      selectedIds.add(key);
      selected.push(compactElementProjection(item));
    };

    for (const item of items) {
      if (changed.has(String(item.logicalId || ''))) add(item);
    }
    for (const item of items) {
      if (item.actionable && item.inViewport) add(item);
    }
    for (const item of items) {
      if (item.visible && item.inViewport) add(item);
    }
    return selected;
  }

  function pageRead(args) {
    syncSemanticScope(args);
    const fullText = normalizeText(document.body?.innerText || document.documentElement?.innerText || '');
    const offset = clamp(args.offset, 0, Math.max(0, fullText.length), 0);
    const limit = clamp(args.limit ?? args.maxText, 300, MAX_TEXT_CHUNK, 6000);
    const text = fullText.slice(offset, offset + limit);
    const nextOffset = offset + text.length;
    const page = {
      documentId,
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      text,
      textOffset: offset,
      textChars: text.length,
      totalTextChars: fullText.length,
      nextOffset: nextOffset < fullText.length ? nextOffset : null,
      hasMore: nextOffset < fullText.length
    };
    page.viewport = viewportState();
    page.mutationVersion = mutationVersion;
    const compactView = args.view === 'compact';
    if (compactView) page.compactView = true;
    if (args.includeElements !== false) {
      const regional = semanticRegionObservation(args.maxElements);
      const observation = semanticIdentity.observe(regional.items);
      if (compactView) {
        // Advance the existing semantic view engine so internal canonical state
        // stays current, but project only task-useful facts to the model.
        semanticViews.observe({
          regions: regional.regions,
          items: observation.items,
          semanticState: observation.state,
          delta: observation.delta,
        });
        page.elements = compactObservationElements(observation.items, observation.delta);
        page.semanticDelta = observation.delta;
      } else {
        page.elements = observation.items;
        page.semanticState = observation.state;
        page.semanticDelta = observation.delta;
        page.semanticViews = semanticViews.observe({
          regions: regional.regions,
          items: observation.items,
          semanticState: observation.state,
          delta: observation.delta,
        });
      }
    }
    return {
      ok: true,
      page
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
    nodes = prioritizeActionableNodes(nodes);
    const items = nodes.slice(0, limit).map((el) => serialize(el, { includeValue: !!args.includeValue }));
    const index = Number.isInteger(args.index) ? args.index : null;
    return {
      ok: true,
      count: nodes.length,
      item: index != null && index >= 0 ? items[index] ?? null : items[0] ?? null,
      items
    };
  }

  // U-I (I2): disambiguation hints make ranked candidate lists actionable
  // without another round trip — the model sees why each rank was produced
  // and how to select a specific candidate explicitly.
  function findDisambiguationHint(el, position) {
    const state = actionabilityState(el);
    const facts = [];
    facts.push(state.actionable ? 'actionable' : 'not actionable');
    facts.push(state.inViewport ? 'in viewport' : 'outside viewport');
    if (state.sensitive) facts.push('sensitive');
    return `chose:${position + 1} — ${facts.join(', ')}; select explicitly with index:${position} or narrow the query`;
  }

  // U-I (I3): Docs-style surfaces show the target text in the page but attach
  // it to no interactive element, so exact field matching returns zero.
  // Surface the closest actionable element near the visible text so the model
  // can act in one round trip instead of a capture/re-read loop.
  function findVisibleTextCandidate(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const maxTextNodes = 2000;
    let node;
    let scanned = 0;
    while ((node = walker.nextNode()) && scanned < maxTextNodes) {
      scanned += 1;
      if (!(node.nodeValue || '').toLowerCase().includes(text)) continue;
      const anchor = node.parentElement?.getBoundingClientRect?.();
      if (!anchor || (anchor.width === 0 && anchor.height === 0)) continue;
      const centerX = anchor.left + anchor.width / 2;
      const centerY = anchor.top + anchor.height / 2;
      let best = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const el of collectInteractiveNodes()) {
        if (!actionabilityState(el).actionable) continue;
        const rect = el.getBoundingClientRect();
        const distance = Math.hypot(rect.left + rect.width / 2 - centerX, rect.top + rect.height / 2 - centerY);
        if (distance < bestDistance) {
          best = el;
          bestDistance = distance;
        }
      }
      if (best) return best;
    }
    return null;
  }

  function pageFind(args) {
    const text = clean(args.text, 300).toLowerCase();
    const role = clean(args.role, 80).toLowerCase();
    const tag = clean(args.tag, 80).toLowerCase();
    const exact = !!args.exact;
    const limit = clamp(args.limit, 1, MAX_QUERY, 30);
    let entries = collectInteractiveNodes().map((el, index) => {
      const s = serialize(el);
      const fields = [s.label, s.text, s.placeholder, s.accessibleName].map((value) => String(value || '').trim().toLowerCase());
      return { el, index, s, fields, hay: fields.join(' '), exactTextMatch: !!text && fields.includes(text) };
    });
    if (args.visibleOnly !== false) entries = entries.filter(({ el }) => isVisible(el));
    entries = entries.filter(({ s, hay, exactTextMatch }) => {
      if (role && String(s.role).toLowerCase() !== role) return false;
      if (tag && String(s.tag).toLowerCase() !== tag) return false;
      if (!text) return true;
      return exact ? exactTextMatch || hay.trim() === text : hay.includes(text);
    });
    entries = entries
      .map((entry) => ({ ...entry, rank: actionabilityRank(entry.el) }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index);
    const dominant = entries.filter((entry) => entry.exactTextMatch && entry.rank === 0);
    let projected = entries;
    if (args.limit == null && args.index == null && dominant.length === 1) projected = dominant;
    const rawItems = projected.slice(0, limit).map(({ el }) => serialize(el, { includeValue: !!args.includeValue }));
    // U-I (I2): ambiguous candidate lists carry rank + disambiguation hints so
    // the model can pick explicitly instead of guessing or re-reading.
    const items = rawItems.length > 1
      ? rawItems.map((entry, position) => ({
          ...entry,
          candidateRank: position + 1,
          hint: findDisambiguationHint(projected[position].el, position)
        }))
      : rawItems;
    const index = Number.isInteger(args.index) ? args.index : 0;
    const item = args.index == null && dominant.length === 1
      ? serialize(dominant[0].el, { includeValue: !!args.includeValue })
      : items[index] ?? null;
    // U-I (I2): a bare zero forces the model into capture/re-read loops.
    // When the exact-field search finds nothing, project one bounded fuzzy
    // candidate with an explicit hint so recovery costs one round trip.
    if (text && entries.length === 0) {
      const fuzzyMatch = collectInteractiveNodes()
        .find((el) => serialize(el).text.toLowerCase().includes(text));
      const fallbackEl = fuzzyMatch || findVisibleTextCandidate(text);
      if (fallbackEl) {
        const serialized = serialize(fallbackEl, { includeValue: !!args.includeValue });
        return {
          ok: true,
          count: 0,
          item: { ...serialized, candidateRank: 1, hint: findDisambiguationHint(fallbackEl, 0) },
          items: [],
          fuzzy: true,
          hint: 'No exact field match; exact-match fallback from fuzzy text match. Verify the target before acting.'
        };
      }
    }
    return { ok: true, count: entries.length, item, items };
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

  function preparePostAction(ref) {
    syncSemanticScope({});
    const baseline = observeSemanticBounded(120).observation;
    return {
      schemaVersion: 1,
      documentId,
      routeKey: currentRouteKey(),
      ref: String(ref || ''),
      url: String(location.href),
      beforeMutationVersion: mutationVersion,
      semanticRevision: baseline.state.observationRevision
    };
  }

  // U-V1: expected-state checks evaluated in-page right after the settle, so
  // verifying an action costs no extra round trip and no full re-read.
  function normalizeExpectSpec(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const spec = {};
    if (raw.urlChanged === true) spec.urlChanged = true;
    if (typeof raw.urlContains === 'string' && raw.urlContains.trim()) spec.urlContains = raw.urlContains.trim().toLowerCase().slice(0, 300);
    if (typeof raw.selectorAppears === 'string' && raw.selectorAppears.trim() && raw.selectorAppears.length <= 500) spec.selectorAppears = raw.selectorAppears.trim();
    if (typeof raw.selectorGone === 'string' && raw.selectorGone.trim() && raw.selectorGone.length <= 500) spec.selectorGone = raw.selectorGone.trim();
    if (typeof raw.textGone === 'string' && raw.textGone.trim()) spec.textGone = raw.textGone.trim().toLowerCase().slice(0, 300);
    const minDelta = Number(raw.minMutationDelta);
    if (Number.isFinite(minDelta) && minDelta >= 0) spec.minMutationDelta = Math.floor(minDelta);
    return Object.keys(spec).length ? spec : null;
  }

  function evaluateExpectations(spec, before) {
    const expectations = [];
    let verified = true;
    const check = (key, pass) => {
      expectations.push({ key, pass: pass === true });
      verified = verified && pass === true;
    };
    const url = String(location.href);
    if ('urlContains' in spec) check('urlContains', url.toLowerCase().includes(spec.urlContains));
    if ('urlChanged' in spec) check('urlChanged', url !== String(before.url || ''));
    if ('selectorAppears' in spec) {
      try { check('selectorAppears', document.querySelector(spec.selectorAppears) != null); } catch { check('selectorAppears', false); }
    }
    if ('selectorGone' in spec) {
      try { check('selectorGone', document.querySelector(spec.selectorGone) == null); } catch { check('selectorGone', false); }
    }
    if ('textGone' in spec) check('textGone', !(document.body?.innerText || '').toLowerCase().includes(spec.textGone));
    if ('minMutationDelta' in spec) check('minMutationDelta', (mutationVersion - Number(before.beforeMutationVersion ?? mutationVersion)) >= spec.minMutationDelta);
    return { verified, expectations };
  }

  async function waitForPostActionSettle(maxWaitMs = 400, stableRoundsRequired = 2) {
    const startedAt = performance.now();
    let stableRounds = 0;
    let previousMutationVersion = mutationVersion;
    while (performance.now() - startedAt < maxWaitMs && stableRounds < stableRoundsRequired) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (mutationVersion === previousMutationVersion) stableRounds += 1;
      else stableRounds = 0;
      previousMutationVersion = mutationVersion;
    }
    return {
      settled: stableRounds >= stableRoundsRequired,
      stabilizationMs: Math.round((performance.now() - startedAt) * 100) / 100
    };
  }

  // U-R: SPA-slow transitions (OAuth redirects, heavy SPA route changes) do
  // not complete inside the 400 ms settle window; a single early evaluation
  // declares verified:false and drives a harmful re-click. When an expect spec
  // is present, poll the expectations until they pass or the bounded window
  // ends, so verification is only reported once it had a fair chance.
  const EXPECT_VERIFY_WINDOW_MS = 2000;

  async function waitForExpectVerification(spec, before, budgetMs = EXPECT_VERIFY_WINDOW_MS) {
    const startedAt = performance.now();
    let verification = evaluateExpectations(spec, before);
    while (!verification.verified && performance.now() - startedAt < budgetMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      verification = evaluateExpectations(spec, before);
    }
    return verification;
  }

  function summarizeSemanticDelta(delta) {
    const changes = Array.isArray(delta?.changes) ? delta.changes : [];
    return {
      schemaVersion: 1,
      sourceRevision: Number(delta?.sourceRevision || 0),
      resultingRevision: Number(delta?.resultingRevision || 0),
      classification: String(delta?.classification || 'NO_RELEVANT_CHANGE'),
      changeTypes: [...new Set(changes.map((change) => String(change?.type || '')).filter(Boolean))].slice(0, 8),
      changedEntityIds: changes.map((change) => String(change?.logicalId || '')).filter(Boolean).slice(0, 20),
      completeSnapshotRequired: !!delta?.completeSnapshotRequired,
      ...(delta?.resetReason ? { resetReason: clean(delta.resetReason, 80) } : {})
    };
  }

  async function postActionEvidence(args) {
    const before = args.before && typeof args.before === 'object' ? args.before : {};
    const settled = await waitForPostActionSettle();
    const resetReason = syncSemanticScope({});
    // Post-action verification must never consume the canonical semantic delta.
    // Baseline observation happens before the action; after the action we only
    // inspect revision/reset metadata and leave UPDATE/RESET delivery to the
    // next canonical page observation.
    const semanticState = semanticIdentity.inspect();
    const semantic = {
      schemaVersion: 1,
      sourceRevision: semanticState.observationRevision,
      resultingRevision: semanticState.observationRevision,
      classification: resetReason ? 'RESET' : 'NO_RELEVANT_CHANGE',
      changeTypes: [],
      changedEntityIds: [],
      completeSnapshotRequired: !!resetReason,
      ...(resetReason ? { resetReason } : {})
    };
    const target = resolveRef(args.ref);
    const sameContinuity = before.documentId === documentId && before.routeKey === currentRouteKey();
    const beforeMutationVersion = Number.isFinite(Number(before.beforeMutationVersion))
      ? Number(before.beforeMutationVersion)
      : mutationVersion;
    const expectSpec = normalizeExpectSpec(args.expect);
    let verification = expectSpec ? evaluateExpectations(expectSpec, before) : null;
    if (verification && !verification.verified) {
      verification = await waitForExpectVerification(expectSpec, before);
    }
    const fallbackHref = verification && !verification.verified && target instanceof HTMLAnchorElement && target.href
      ? String(target.href)
      : null;
    return {
      schemaVersion: 1,
      documentId,
      continuity: sameContinuity ? 'SAME_DOCUMENT_ROUTE' : 'RESET_OR_ROUTE_CHANGE',
      beforeMutationVersion,
      mutationVersion,
      mutationChanged: mutationVersion !== beforeMutationVersion,
      settled: settled.settled,
      stabilizationMs: settled.stabilizationMs,
      semantic,
      target: {
        ref: String(args.ref || ''),
        present: !!target
      },
      completionClaim: false,
      ...(verification ? { verified: verification.verified, expectations: verification.expectations } : {}),
      ...(fallbackHref ? { fallbackHref } : {})
    };
  }

  async function clickSynthetic(args) {
    const attempts = Math.max(1, Math.min(3, Number(args.retry?.attempts) || 1));
    let el = resolveActionRef(args.ref);
    if (!el) throw new Error('Element not found or reference is stale.');
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload fields are blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    let result = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      el = resolveActionRef(args.ref);
      if (!el) break;
      const before = preparePostAction(args.ref);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus?.({ preventScroll: true });
      el.click();
      const postAction = await postActionEvidence({ ref: args.ref, before, expect: args.expect });
      result = { ok: true, ref: args.ref, method: 'synthetic', attempts: attempt, postAction };
      if (postAction.verified !== false) break;
      if (el instanceof HTMLAnchorElement && el.href) result.fallbackHref = String(el.href);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return result;
  }

  // U-R: fill gains the same retry/expect parity as click — re-verify through
  // postActionEvidence, re-fill only on verification failure, bounded 1..3.
  async function fill(args) {
    const attempts = Math.max(1, Math.min(3, Number(args.retry?.attempts) || 1));
    const value = String(args.value ?? '').slice(0, 20000);
    let result = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const el = resolveRef(args.ref);
      assertEditableSafe(el);
      const before = preparePostAction(args.ref);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus({ preventScroll: true });
      nativeSetValue(el, value);
      const postAction = await postActionEvidence({ ref: args.ref, before, expect: args.expect });
      result = { ok: true, ref: args.ref, valueLength: value.length, attempts: attempt, postAction };
      if (postAction.verified !== false) break;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return result;
  }

  function fillInfo(args) {
    const el = resolveRef(args.ref);
    assertEditableSafe(el);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select();
    } else if (el.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return { ok: true, ref: args.ref, contentEditable: !!el.isContentEditable, postActionBefore: preparePostAction(args.ref) };
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
    const el = resolveActionRef(args.ref);
    if (!el) throw new Error('Element not found or reference is stale.');
    if (sensitiveDescriptor(el) === 'file') throw new Error('File upload fields are blocked.');
    if (!isVisible(el)) throw new Error('Element is not visible.');
    const postActionBefore = preparePostAction(args.ref);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = rectOf(el);
    return { ok: true, ref: args.ref, rect, sensitive: !!sensitiveDescriptor(el), postActionBefore };
  }

  // U-V Action Pipeline (2026-09-23): compact resolve snapshot for the
  // background host. Reuses resolveActionRef (the U-I rebind machinery) so
  // rebind authority stays in one place; ambiguity is read from the existing
  // geometry-guard refusal, which already carries the candidate list.
  function actionState(args) {
    const key = String(args?.ref || '');
    const before = resolveRef(key);
    let el;
    try {
      el = resolveActionRef(key);
    } catch (error) {
      const msg = String(error?.message || error);
      if (msg.includes('refusing automatic rebind')) {
        const m = msg.match(/candidates: (\[.*?\])/);
        let candidates;
        try { candidates = m ? JSON.parse(m[1]) : []; } catch { candidates = []; }
        return { present: true, actionable: false, ambiguous: true, candidates, refusal: msg };
      }
      throw error;
    }
    if (!el) {
      // Sensitive targets are fail-closed from ref resolution (rebind
      // authority never hands them over), but they ARE present and owned by
      // the executor's own guard. Report masked instead of not-found so the
      // pipeline hands off immediately instead of waiting out the deadline.
      if (before && sensitiveDescriptor(before)) {
        return { present: true, actionable: false, ambiguous: false, masked: true };
      }
      return { present: false, actionable: false, ambiguous: false };
    }
    const state = actionabilityState(el);
    // Pipeline readiness is executor-contract readiness: click_info requires
    // only visibility and the trusted executor scrolls into view itself, so
    // inViewport must NOT gate the wait (offscreen-but-clickable is normal).
    return {
      present: true,
      // Sensitive is NOT an actionability gate: sensitive targets are owned by
      // the executor's own guard (which names the real reason - sensitive/
      // file), so the pipeline must hand off instead of waiting them out.
      actionable: state.visible && state.enabled && state.pointerEnabled,
      ambiguous: false,
      gates: { visible: state.visible, enabled: state.enabled, sensitive: state.sensitive, pointerEnabled: state.pointerEnabled, inViewport: state.inViewport },
      // Rebind recovery means the ref was NOT connected before the resolve and
      // IS resolved now (fresh refs and live refs resolve without recovery).
      ...(before == null && el != null ? { rebound: true } : {})
    };
  }

  function pointerTarget(args) {
    const x = Number(args.x);
    const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
      throw new Error('Pointer coordinates must be inside the visible viewport.');
    }
    const el = document.elementFromPoint(x, y);
    const blocked = el && sensitiveDescriptor(el);
    if (blocked) throw new Error(`Pointer blocked on sensitive target (${blocked}).`);
    if (args.showCursor) {
      const existing = document.getElementById('__opera_agent_pointer_cursor');
      existing?.remove();
      const cursor = document.createElement('div');
      cursor.id = '__opera_agent_pointer_cursor';
      cursor.setAttribute('aria-hidden', 'true');
      cursor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:16px;height:16px;border:2px solid #ef4444;border-radius:50%;background:#ef444433;transform:translate(-50%,-50%);pointer-events:none;z-index:2147483647;`;
      document.documentElement.append(cursor);
      setTimeout(() => cursor.remove(), 900);
    }
    return {
      ok: true,
      x,
      y,
      documentId,
      viewport: viewportState(),
      mutationVersion,
      target: el ? { ref: getRef(el), tag: el.tagName.toLowerCase(), label: getAssociatedLabel(el), ...stableElementIdentity(el) } : null,
      scrollTarget: scrollState(findScrollTarget(el))
    };
  }

  function capturePolicy() {
    const sensitiveFields = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')]
      .filter(isVisible)
      .map((el) => sensitiveDescriptor(el))
      .filter(Boolean);
    return {
      ok: true,
      allowed: sensitiveFields.length === 0,
      reason: sensitiveFields.length ? 'SENSITIVE_SURFACE' : null,
      documentId,
      viewport: viewportState(),
      sensitiveFieldCount: sensitiveFields.length
    };
  }

  function isScrollable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const style = getComputedStyle(el);
    const canY = /^(?:auto|scroll|overlay)$/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const canX = /^(?:auto|scroll|overlay)$/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    return canX || canY;
  }

  function findScrollTarget(el) {
    for (let current = el; current && current !== document.documentElement; current = current.parentElement) {
      if (isScrollable(current)) return current;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollState(target) {
    const root = document.scrollingElement || document.documentElement;
    const isDocument = !target || target === root || target === document.body || target === document.documentElement;
    const node = isDocument ? root : target;
    const top = isDocument ? scrollY : node.scrollTop;
    const left = isDocument ? scrollX : node.scrollLeft;
    const clientHeight = isDocument ? innerHeight : node.clientHeight;
    const clientWidth = isDocument ? innerWidth : node.clientWidth;
    const scrollHeight = node?.scrollHeight || clientHeight;
    const scrollWidth = node?.scrollWidth || clientWidth;
    const maxTop = Math.max(0, scrollHeight - clientHeight);
    const maxLeft = Math.max(0, scrollWidth - clientWidth);
    const epsilon = 2;
    return {
      kind: isDocument ? 'document' : 'element',
      ref: isDocument ? null : getRef(node),
      tag: isDocument ? 'document' : String(node.tagName || '').toLowerCase(),
      role: isDocument ? '' : clean(node.getAttribute?.('role'), 80),
      label: isDocument ? 'document' : getAssociatedLabel(node),
      scrollTop: Math.round(top * 100) / 100,
      scrollLeft: Math.round(left * 100) / 100,
      scrollHeight,
      scrollWidth,
      clientHeight,
      clientWidth,
      maxScrollTop: maxTop,
      maxScrollLeft: maxLeft,
      canScrollY: maxTop > epsilon,
      canScrollX: maxLeft > epsilon,
      reachedTop: top <= epsilon,
      reachedBottom: top >= maxTop - epsilon,
      reachedLeft: left <= epsilon,
      reachedRight: left >= maxLeft - epsilon
    };
  }

  function sameScrollPosition(left, right) {
    return !!left && !!right && left.kind === right.kind && left.ref === right.ref &&
      Math.abs(left.scrollTop - right.scrollTop) <= 1 && Math.abs(left.scrollLeft - right.scrollLeft) <= 1 &&
      left.scrollHeight === right.scrollHeight && left.scrollWidth === right.scrollWidth;
  }

  async function settleScroll(args) {
    const startedAt = performance.now();
    const maxWaitMs = clamp(args.maxWaitMs, 100, 1200, 800);
    const requiredStableRounds = clamp(args.stableRounds, 1, 5, 3);
    const intervalMs = 50;
    const before = args.before && typeof args.before === 'object' ? args.before : null;
    const beforeMutationVersion = Number(args.beforeMutationVersion ?? mutationVersion);
    const point = Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
      ? document.elementFromPoint(Number(args.x), Number(args.y))
      : null;
    let target = before?.kind === 'element' && before.ref ? resolveRef(before.ref) : findScrollTarget(point);
    if (!target) target = document.scrollingElement || document.documentElement;
    let previous = scrollState(target);
    let previousMutationVersion = mutationVersion;
    let stableRounds = 0;
    while (performance.now() - startedAt < maxWaitMs && stableRounds < requiredStableRounds) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const current = scrollState(target);
      stableRounds = sameScrollPosition(previous, current) && mutationVersion === previousMutationVersion ? stableRounds + 1 : 0;
      previous = current;
      previousMutationVersion = mutationVersion;
    }
    const after = scrollState(target);
    return {
      ok: true,
      before,
      after,
      scrollX,
      scrollY,
      moved: before ? Math.abs(after.scrollTop - Number(before.scrollTop || 0)) > 1 || Math.abs(after.scrollLeft - Number(before.scrollLeft || 0)) > 1 : null,
      contentChanged: mutationVersion !== beforeMutationVersion,
      beforeMutationVersion,
      mutationVersion,
      settled: stableRounds >= requiredStableRounds,
      stabilizationMs: Math.round((performance.now() - startedAt) * 100) / 100
    };
  }

  async function scrollTargetBy(args) {
    const point = Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
      ? document.elementFromPoint(Number(args.x), Number(args.y))
      : null;
    const requestedBefore = args.before && typeof args.before === 'object' ? args.before : null;
    const root = document.scrollingElement || document.documentElement;
    let target = requestedBefore?.kind === 'document' ? root : args.ref ? resolveRef(args.ref) : findScrollTarget(point);
    if (!target) target = document.scrollingElement || document.documentElement;
    const before = requestedBefore || scrollState(target);
    const beforeMutationVersion = Number(args.beforeMutationVersion ?? mutationVersion);
    const x = clamp(args.deltaX, -1200, 1200, 0);
    const y = clamp(args.deltaY, -1200, 1200, 0);
    if (target === root || target === document.body || target === document.documentElement) {
      scrollBy({ left: x, top: y, behavior: 'instant' });
      document.dispatchEvent(new Event('scroll'));
    } else {
      target.scrollBy({ left: x, top: y, behavior: 'instant' });
      target.dispatchEvent(new Event('scroll'));
    }
    return settleScroll({ before, beforeMutationVersion, x: args.x, y: args.y, maxWaitMs: 600, stableRounds: 3 });
  }

  async function scroll(args) {
    const x = clamp(args.x, -1000000, 1000000, 0);
    const y = clamp(args.y, -1000000, 1000000, 0);
    const behavior = args.behavior === 'smooth' ? 'smooth' : 'instant';
    let target = document.scrollingElement || document.documentElement;
    const beforeMutationVersion = mutationVersion;
    if (args.ref) {
      const el = resolveRef(args.ref);
      if (!el) throw new Error('Element not found or reference is stale.');
      target = findScrollTarget(el.parentElement);
      const before = scrollState(target);
      el.scrollIntoView({ block: args.block || 'center', inline: args.inline || 'center', behavior });
      return settleScroll({ before, beforeMutationVersion, maxWaitMs: behavior === 'smooth' ? 1000 : 500 });
    } else if (args.absolute) {
      const before = scrollState(target);
      scrollTo({ left: x, top: y, behavior });
      return settleScroll({ before, beforeMutationVersion, maxWaitMs: behavior === 'smooth' ? 1000 : 500 });
    } else {
      const before = scrollState(target);
      scrollBy({ left: x, top: y, behavior });
      return settleScroll({ before, beforeMutationVersion, maxWaitMs: behavior === 'smooth' ? 1000 : 500 });
    }
  }

  function key(args) {
    // The synthetic path stays unmodified-key only. Content scripts are classic
    // scripts and cannot import the shared lib/keyboard.js resolver, so allowing
    // chords here would mean a second, drifting copy of the allowlist. Chords
    // and text entry are refused with a pointer to the trusted path, which is
    // what every public tool actually uses.
    if (args?.modifiers != null || args?.text != null) {
      throw new Error('Key chords and text entry require the trusted path.');
    }
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
    const absent = args.absent === true;
    if (absent && !args.ref && !args.selector && !args.text) {
      throw new Error('absent wait requires ref, selector, or text.');
    }
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
        candidates = collectInteractiveNodes();
      }
      const found = candidates.find((el) => {
        if (args.visibleOnly !== false && !isVisible(el)) return false;
        if (text) {
          const s = serialize(el);
          const hay = `${s.label} ${s.text} ${s.placeholder} ${s.accessibleName || ''}`.toLowerCase();
          if (!hay.includes(text)) return false;
        }
        return stateMatches(el, args.state);
      });
      if (absent) {
        if (!found) return { ok: true, absent: true };
      } else if (found) {
        return { ok: true, item: serialize(found, { includeValue: !!args.includeValue }) };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return absent
      ? { ok: false, error: 'wait_for timeout', stillPresent: true }
      : { ok: false, error: 'wait_for timeout' };
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

  // ---- U-T Event-Triggered Workflows: page-side watch facts ----
  // content.js stays dumb: it only reports FACTS for armed rules (plus a
  // compact text snapshot for textMatch). Evaluation lives in background.
  const watchRules = [];
  let watchState = {};
  let watchChecking = false;
  let watchCheckQueued = false;

  function watchFacts(rules) {
    const facts = {};
    for (const rule of rules) {
      const sel = rule.trigger?.selector;
      if (!sel) continue;
      try {
        const el = document.querySelector(sel);
        facts[rule.ruleId] = { present: !!el };
      } catch {
        facts[rule.ruleId] = { present: false, invalidSelector: true };
      }
    }
    let text = null;
    if (rules.some((r) => r.trigger?.kind === 'textMatch')) {
      try { text = String(document.body?.innerText || '').slice(0, 20000); } catch { text = ''; }
    }
    return { facts, text };
  }

  function adShowingNow(adSelectors) {
    const list = Array.isArray(adSelectors) ? adSelectors.filter((s) => typeof s === 'string').slice(0, 8) : [];
    return list.some((sel) => {
      try { return !!document.querySelector(sel); } catch { return false; }
    });
  }

  function mediaTimeNow() {
    const v = document.querySelector('video');
    return v ? (Number(v.currentTime) || 0) : 0;
  }

  async function checkWatches() {
    if (disposed || watchChecking || !watchRules.length) return;
    watchChecking = true;
    try {
      const { facts, text } = watchFacts(watchRules);
      const snapshot = {
        rules: watchRules,
        facts,
        text,
        url: location.href,
        adState: adShowingNow(watchRules.flatMap((r) => (r.trigger?.kind === 'adState' && Array.isArray(r.trigger.adSelectors)) ? r.trigger.adSelectors : [])),
        mediaTime: mediaTimeNow(),
        now: Date.now(),
        state: watchState
      };
      const r = await chrome.runtime.sendMessage({ scope: 'opera-agent-watch', method: 'watch.facts', params: snapshot });
      if (r && r.state) watchState = r.state;
    } catch (watchError) {
      // extension context invalidated or transient; the next mutation retries
    } finally {
      watchChecking = false;
    }
  }

  function scheduleWatchCheck() {
    if (watchChecking || !watchRules.length) return;
    if (watchCheckQueued) return;
    watchCheckQueued = true;
    setTimeout(() => {
      watchCheckQueued = false;
      checkWatches();
    }, 100);
  }

  async function handle(method, args = {}) {
    if (disposed) throw new Error('Extension context invalidated.');
    switch (method) {
      case 'watch.arm': {
        const incoming = Array.isArray(args.rules) ? args.rules : [];
        watchRules.length = 0;
        for (const r of incoming) {
          if (r && typeof r.ruleId === 'string') watchRules.push(r);
        }
        watchState = args.state || {};
        scheduleWatchCheck();
        return { ok: true, armed: watchRules.length };
      }
      case 'content.ping': return { ok: true, documentId, readyState: document.readyState };
      case 'page.read': return pageRead(args);
      case 'page.query': return pageQuery(args);
      case 'page.find': return pageFind(args);
      case 'page.collect_links': return collectLinks(args);
      case 'page.click': return clickSynthetic(args);
      case 'page.click_info': return clickInfo(args);
      case 'page.action_state': return actionState(args);
      case 'page.post_action': return postActionEvidence(args);
      case 'page.pointer_target': return pointerTarget(args);
      case 'page.scroll_settle': return settleScroll(args);
      case 'page.scroll_target': return scrollTargetBy(args);
      case 'page.capture_policy': return capturePolicy();
      case 'page.fill': return fill(args);
      case 'page.fill_info': return fillInfo(args);
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
    mutationObserver.disconnect();
  }

  window.addEventListener('pagehide', () => {
    disposed = true;
    mutationObserver.disconnect();
    reverseRefs.clear();
    watchRules.length = 0;
  }, { once: true });
})();
