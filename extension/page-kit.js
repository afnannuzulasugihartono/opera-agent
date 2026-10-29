// @last-edited: 2026-10-29 UTC+7.
// @title: page-kit — the pure helpers and the limits every page module shares.
// @state: clamp, clean, normalizeObservableText, normalizeText and currentRouteKey, plus the four MAX_* caps and the two text regexes; no DOM of its own.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// Every module below the entry needs the same six helpers, and a helper that lives in the entry is a helper eight files reach into the dispatcher for.
// This is the leaf, like lib/log.js was for the worker split: it imports nothing and is imported by everything.

(() => {
  'use strict';
  if (globalThis.OperaAgentPageKit) return;

  const MAX_TEXT_CHUNK = 12000;
  const MAX_ELEMENTS = 200;
  const MAX_QUERY = 100;
  const MAX_LINKS = 500;

  const PUA_GLYPH_RE = /[\uE000-\uF8FF\u200B\u200C\uFEFF]|\u200D/g;
  const VISITED_SUFFIX_RE = /\s*visited link\s*$/i;

  function clamp(
    value,
    min,
    max,
    fallback = min
  ) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clean(
    value,
    max = 500
  ) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeObservableText(
    value,
    max = 500
  ) {
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

  globalThis.OperaAgentPageKit = Object.freeze({
    MAX_TEXT_CHUNK,
    MAX_ELEMENTS,
    MAX_QUERY,
    MAX_LINKS,
    PUA_GLYPH_RE,
    VISITED_SUFFIX_RE,
    clamp,
    clean,
    normalizeObservableText,
    normalizeText,
    currentRouteKey
  });
})();
