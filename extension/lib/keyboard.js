// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: keyboard — chord and bounded text resolution into exact CDP key events.
// @state: pure resolver with no chrome dependency; modifiers OR into a CDP bitmask, unknown keys are rejected, and text is a separate length-bounded chunked path.
// @dependencies: none.

// Keyboard chords and bounded text entry: pure resolution
// from a declarative { key, modifiers } or { text } request to the exact CDP
// event payload. NO chrome dependency, so it is deterministic and testable in
// Node (pattern of lib/action-pipeline.js).
//
// Why this exists: the trusted key path carried a 12-entry table of unmodified
// keys with no modifier support at all. No Ctrl+A, no Ctrl+V, no Shift+Enter —
// which is why complex editors scored as "weak keyboard" next to Playwright.
// This module is purely additive: every previously valid key still resolves to
// byte-identical payloads, so existing callers and contracts are unchanged.
//
// Semantics locked by tests/focus-and-keyboard.test.mjs:
// - an unmodified named key resolves exactly as the historical KEY_MAP did
// - modifiers OR into a CDP bitmask (alt 1, control 2, meta 4, shift 8)
// - unknown keys and unknown modifiers are rejected, never passed through
// - text is a SEPARATE path from a key, is length-bounded, and is chunked
// - exactly one of key or text may be requested

export const MODIFIER_BITS = Object.freeze({ alt: 1, control: 2, meta: 4, shift: 8 });
export const MODIFIER_ALIASES = Object.freeze({
  alt: 'alt', option: 'alt',
  ctrl: 'control', control: 'control',
  cmd: 'meta', command: 'meta', meta: 'meta', super: 'meta', win: 'meta',
  shift: 'shift'
});
export const MAX_TEXT_CHARS = 20000;
export const TEXT_CHUNK_CHARS = 4000;

const NAMED_KEYS = Object.freeze({
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Comma: { key: ',', code: 'Comma', vk: 188 },
  Period: { key: '.', code: 'Period', vk: 190 },
  Slash: { key: '/', code: 'Slash', vk: 191 }
});

function namedKeySpec(name) {
  const spec = NAMED_KEYS[name];
  if (spec) return { ...spec };
  if (/^[a-z]$/.test(name)) {
    const upper = name.toUpperCase();
    return { key: name, code: `Key${upper}`, vk: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(name)) {
    return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0) };
  }
  if (/^[A-Z]$/.test(name)) {
    return { key: name.toLowerCase(), code: `Key${name}`, vk: name.charCodeAt(0), requiresShift: true };
  }
  return null;
}

export function keyNames() {
  return [
    ...Object.keys(NAMED_KEYS),
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    ...'0123456789'.split('')
  ];
}

export const KEY_ALLOWLIST = Object.freeze(keyNames());

export function resolveModifiers(modifiers) {
  if (modifiers == null) return { mask: 0, names: [] };
  const list = Array.isArray(modifiers) ? modifiers : [modifiers];
  if (list.length > 4) throw new Error('At most 4 modifiers are allowed.');
  const names = [];
  let mask = 0;
  for (const raw of list) {
    const canonical = MODIFIER_ALIASES[String(raw ?? '').trim().toLowerCase()];
    if (!canonical) throw new Error(`Key is not allowlisted (unknown modifier: ${String(raw)}).`);
    if (!names.includes(canonical)) names.push(canonical);
    mask |= MODIFIER_BITS[canonical];
  }
  return { mask, names };
}

function withImplicitShift(spec, mask, names) {
  if (!spec.requiresShift) return { spec, mask, names };
  if (mask & MODIFIER_BITS.shift) return { spec, mask, names };
  return {
    spec,
    mask: mask | MODIFIER_BITS.shift,
    names: [...names, 'shift']
  };
}

export function resolveChord(key, modifiers) {
  const name = String(key ?? '').trim();
  const spec = namedKeySpec(name);
  if (!spec) throw new Error('Key is not allowlisted.');
  const { mask, names } = resolveModifiers(modifiers);
  const shifted = withImplicitShift(spec, mask, names);
  return {
    kind: 'chord',
    name,
    key: shifted.spec.key,
    code: shifted.spec.code,
    modifiers: shifted.mask,
    modifierNames: shifted.names,
    windowsVirtualKeyCode: shifted.spec.vk,
    nativeVirtualKeyCode: shifted.spec.vk
  };
}

export function chunkText(text, size = TEXT_CHUNK_CHARS) {
  const value = String(text ?? '');
  const width = Math.max(1, Math.floor(Number(size) || TEXT_CHUNK_CHARS));
  const chunks = [];
  for (let index = 0; index < value.length; index += width) chunks.push(value.slice(index, index + width));
  return chunks;
}

export function resolveKeyInput({ key, modifiers, text } = {}) {
  const hasKey = key != null && String(key).trim() !== '';
  const hasText = text != null && String(text) !== '';
  if (hasKey && hasText) throw new Error('Request either a key chord or text, not both.');
  if (!hasKey && !hasText) throw new Error('Request requires a key or text.');
  if (hasText) {
    const value = String(text);
    if (value.length > MAX_TEXT_CHARS) throw new Error(`Text must be at most ${MAX_TEXT_CHARS} characters.`);

    if (modifiers != null) throw new Error('Text entry does not accept modifiers.');
    return { kind: 'text', text: value, chunks: chunkText(value), chars: value.length };
  }
  return resolveChord(key, modifiers);
}

// WHY A STREAM IS ONE REQUEST, NOT MANY. Every lone key pays a full round trip of
// roughly a second, so a twenty-key menu walk costs twenty seconds one key at a time
// while the device itself absorbs twenty keys in nineteen milliseconds, measured. A
// stream carries the whole walk in one command: one enqueue, one execution, one
// completion. Events keep their order, gaps ride along for menus that need a beat to
// open, and the total text stays within the same budget as a single text entry so a
// stream cannot smuggle in more than typing allows.

const MAX_STREAM_EVENTS = 100;
const MAX_STREAM_GAP_MS = 2000;

export function resolveKeyStream(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('A key stream needs at least one event.');
  }
  if (events.length > MAX_STREAM_EVENTS) {
    throw new Error(`A key stream holds at most ${MAX_STREAM_EVENTS} events.`);
  }

  let chars = 0;
  return events.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Stream event ${index} must be an object.`);
    }
    const gapMs = event.gapMs ?? 0;
    if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > MAX_STREAM_GAP_MS) {
      throw new Error(`Stream event ${index} gap must be between 0 and ${MAX_STREAM_GAP_MS} ms.`);
    }
    const resolved = resolveKeyInput(event);
    if (resolved.kind === 'text') chars += resolved.chars;
    if (chars > MAX_TEXT_CHARS) {
      throw new Error(`Stream text must total at most ${MAX_TEXT_CHARS} characters.`);
    }
    return { ...resolved, gapMs };
  });
}
