// R9 (2026-09-30) — focus stability + keyboard chord/text contracts.
//
// Two halves:
// 1. The pure policy modules (lib/focus-gate.js, lib/keyboard.js) are asserted
//    directly as behavior, not as source text.
// 2. The extension wiring is checked with a narrow safety assertion: the
//    trusted input executors must never activate a tab or focus a window. That
//    is a frozen product invariant (`userActiveTab != automationTargetTab`),
//    which is exactly the case where a structural assertion is warranted
//    instead of a behavioral one (precedent: event-driven-local-execution-p4).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FOCUS_GATE_ATTEMPTS,
  decideFocusGate,
  focusSampleSatisfied
} from '../extension/lib/focus-gate.js';
import {
  KEY_ALLOWLIST,
  MAX_TEXT_CHARS,
  MODIFIER_BITS,
  chunkText,
  resolveChord,
  resolveKeyInput,
  resolveModifiers
} from '../extension/lib/keyboard.js';

const FOCUSED = { tabActive: true, windowFocused: true };
const TAB_ONLY = { tabActive: true, windowFocused: false };
const WINDOW_ONLY = { tabActive: false, windowFocused: true };
const LOST = { tabActive: false, windowFocused: false };

test('R9-A: a satisfied foreground sample dispatches on the first attempt with no added latency', () => {
  const decision = decideFocusGate({ mode: 'foreground', sample: FOCUSED, attempt: 1 });
  assert.equal(decision.outcome, 'dispatch');
  assert.equal(decision.recovered, false);
  assert.equal(decision.attempt, 1);
});

test('R9-A: a lost-then-restored focus sample dispatches and reports the recovery', () => {
  const first = decideFocusGate({ mode: 'foreground', sample: TAB_ONLY, attempt: 1 });
  assert.equal(first.outcome, 'retry');
  const second = decideFocusGate({ mode: 'foreground', sample: FOCUSED, attempt: 2 });
  assert.equal(second.outcome, 'dispatch');
  assert.equal(second.recovered, true);
  assert.equal(second.attempt, 2);
});

test('R9-A: a focus sample that never satisfies refuses on the final attempt and carries the observed state', () => {
  let decision = null;
  for (let attempt = 1; attempt <= FOCUS_GATE_ATTEMPTS; attempt += 1) {
    decision = decideFocusGate({ mode: 'foreground', sample: LOST, attempt });
  }
  assert.equal(decision.outcome, 'refuse');
  assert.equal(decision.attempt, FOCUS_GATE_ATTEMPTS);
  assert.deepEqual(decision.sample, LOST);
});

test('R9-A: the gate never exceeds its attempt budget', () => {
  const decisions = [];
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    decisions.push(decideFocusGate({ mode: 'foreground', sample: LOST, attempt }).outcome);
  }
  assert.deepEqual(decisions.slice(0, FOCUS_GATE_ATTEMPTS - 1), ['retry', 'retry']);
  assert.equal(decisions[FOCUS_GATE_ATTEMPTS - 1], 'refuse');
  assert.ok(decisions.slice(FOCUS_GATE_ATTEMPTS).every((outcome) => outcome === 'refuse'));
});

test('R9-A: background mode dispatches immediately regardless of the observed focus sample', () => {
  for (const sample of [FOCUSED, LOST, TAB_ONLY, WINDOW_ONLY, null, undefined]) {
    assert.equal(focusSampleSatisfied('background', sample), true);
    const decision = decideFocusGate({ mode: 'background', sample, attempt: 1 });
    assert.equal(decision.outcome, 'dispatch');
    assert.equal(decision.recovered, false);
  }
});

test('R9-A: a partially focused state is never treated as satisfied', () => {
  assert.equal(focusSampleSatisfied('foreground', FOCUSED), true);
  assert.equal(focusSampleSatisfied('foreground', TAB_ONLY), false);
  assert.equal(focusSampleSatisfied('foreground', WINDOW_ONLY), false);
  assert.equal(focusSampleSatisfied('foreground', LOST), false);
  assert.equal(focusSampleSatisfied('foreground', null), false);
  assert.equal(decideFocusGate({ mode: 'foreground', sample: null, attempt: 1 }).outcome, 'retry');
});

test('R9-B: every previously allowlisted unmodified key resolves to the historical CDP payload', () => {
  const historical = {
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
    Space: { key: ' ', code: 'Space', vk: 32 }
  };
  for (const [name, expected] of Object.entries(historical)) {
    const chord = resolveChord(name);
    assert.equal(chord.key, expected.key, `${name} key`);
    assert.equal(chord.code, expected.code, `${name} code`);
    assert.equal(chord.windowsVirtualKeyCode, expected.vk, `${name} vk`);
    assert.equal(chord.modifiers, 0, `${name} must stay unmodified`);
  }
});

test('R9-B: modifiers OR into the CDP bitmask and accept their common aliases', () => {
  assert.equal(resolveChord('a', ['control']).modifiers, MODIFIER_BITS.control);
  assert.equal(resolveChord('a', ['ctrl']).modifiers, MODIFIER_BITS.control);
  assert.equal(resolveChord('v', ['control', 'shift']).modifiers, MODIFIER_BITS.control | MODIFIER_BITS.shift);
  assert.equal(resolveChord('Enter', ['control', 'shift', 'alt', 'meta']).modifiers, 15);
  assert.deepEqual(resolveChord('a', ['control']).modifierNames, ['control']);
  // Alias spellings collapse to one canonical name rather than double-counting.
  assert.deepEqual(resolveModifiers(['ctrl', 'control']).names, ['control']);
  assert.equal(resolveModifiers(['ctrl', 'control']).mask, MODIFIER_BITS.control);
  assert.equal(resolveModifiers([]).mask, 0);
  assert.equal(resolveModifiers(undefined).mask, 0);
});

test('R9-B: the chords an editor requires now resolve', () => {
  for (const [key, modifiers, expected] of [
    ['a', ['control'], 2],
    ['v', ['control'], 2],
    ['a', ['meta'], 4],
    ['z', ['control', 'shift'], 10],
    ['Enter', ['shift'], 8],
    ['ArrowDown', ['control'], 2]
  ]) {
    const chord = resolveChord(key, modifiers);
    assert.equal(chord.modifiers, expected, `${key} + ${modifiers.join('+')}`);
    assert.ok(chord.windowsVirtualKeyCode > 0);
    assert.ok(chord.code.length > 0);
  }
});

test('R9-B: an uppercase letter carries an implicit Shift so the platform does not drop it', () => {
  const chord = resolveChord('A');
  assert.equal(chord.code, 'KeyA');
  assert.equal(chord.modifiers, MODIFIER_BITS.shift);
  assert.deepEqual(chord.modifierNames, ['shift']);
  // An explicit shift is not doubled.
  assert.equal(resolveChord('A', ['shift']).modifiers, MODIFIER_BITS.shift);
});

test('R9-B: unknown keys and unknown modifiers are rejected, never passed through', () => {
  for (const bad of ['', 'F13', 'Meta+KeyDown', 'kill', '../../etc/passwd', 'a b']) {
    assert.throws(() => resolveChord(bad), /not allowlisted/i, `must reject ${JSON.stringify(bad)}`);
  }
  assert.throws(() => resolveChord('a', ['hyper']), /not allowlisted/i);
  assert.throws(() => resolveChord('a', ['control', 'control', 'control', 'control', 'control']), /at most 4/i);
});

test('R9-B: text is a bounded, chunked, separate path from a key', () => {
  const resolved = resolveKeyInput({ text: 'hello world' });
  assert.equal(resolved.kind, 'text');
  assert.equal(resolved.text, 'hello world');
  assert.equal(resolved.chars, 11);
  assert.deepEqual(resolved.chunks, ['hello world']);

  const long = resolveKeyInput({ text: 'x'.repeat(9000) });
  assert.deepEqual(long.chunks, ['x'.repeat(4000), 'x'.repeat(4000), 'x'.repeat(1000)]);
  assert.equal(long.chunks.join('').length, 9000);
  assert.equal(long.chunks.length, 3);

  // Exactly at the bound is accepted; one character over is rejected.
  assert.equal(resolveKeyInput({ text: 'y'.repeat(MAX_TEXT_CHARS) }).chars, MAX_TEXT_CHARS);
  assert.throws(() => resolveKeyInput({ text: 'y'.repeat(MAX_TEXT_CHARS + 1) }), /at most 20000 characters/);
});

test('R9-B: chunking never loses or reorders characters', () => {
  const value = Array.from({ length: 977 }, (_, index) => String.fromCharCode(33 + (index % 94))).join('');
  assert.equal(chunkText(value, 128).join(''), value);
  assert.deepEqual(chunkText('', 128), []);
});

test('R9-B: exactly one of key or text may be requested, and modifiers cannot ride along with text', () => {
  assert.throws(() => resolveKeyInput({ key: 'a', text: 'b' }), /not both/i);
  assert.throws(() => resolveKeyInput({}), /requires a key or text/i);
  // An empty text string means "no text requested", not a conflict.
  assert.equal(resolveKeyInput({ key: 'a', text: '' }).kind, 'chord');
  assert.throws(() => resolveKeyInput({ text: 'abc', modifiers: ['control'] }), /does not accept modifiers/i);
  assert.equal(resolveKeyInput({ key: 'Enter' }).kind, 'chord');
  // Empty text is treated as absent rather than a silent no-op, so a caller
  // that meant to type something cannot believe it did.
  assert.throws(() => resolveKeyInput({ text: '' }), /requires a key or text/i);
});

test('R9: the shared key allowlist is the single source of truth for bursts and the content path', () => {
  assert.ok(KEY_ALLOWLIST.includes('Enter'));
  assert.ok(KEY_ALLOWLIST.includes('a'));
  assert.ok(KEY_ALLOWLIST.includes('A'));
  assert.ok(KEY_ALLOWLIST.includes('7'));
  for (const name of KEY_ALLOWLIST) {
    assert.doesNotThrow(() => resolveChord(name), `allowlisted key must resolve: ${name}`);
  }
  // The frozen public key surface stays reachable, and no site-specific or
  // free-form escape hatch is admitted.
  for (const bad of ['F13', 'javascript:alert(1)', 'AnyKey']) {
    assert.ok(!KEY_ALLOWLIST.includes(bad));
  }
});

test('R9-B: the synthetic path explains its narrower surface instead of a bare rejection', async () => {
  // The synthetic key path accepts only 12 unmodified navigation keys while the
  // runtime allowlist has 79. A bare "Key is not allowlisted" reads as a bug for
  // a key the product accepts everywhere else, so the message must name the
  // reason and the alternative.
  const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /throw new Error\('Key is not allowlisted\.'\)/);
  assert.match(source, /Key is not allowlisted for the synthetic path/);
  assert.match(source, /require the trusted path/);
  // The guard itself must stay: the synthetic path may not accept chords.
  assert.match(source, /Chords, text, and /);
  assert.match(source, /non-navigation keys require the trusted path/);
  // And it must still refuse chords and text outright.
  assert.match(source, /Key chords and text entry require the trusted path\./);
});

test('R9: trusted input executors never activate a tab or focus a window', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function trustedClick');
  const end = source.indexOf('// Burst ref passthrough');
  assert.ok(start > 0 && end > start, 'trusted executor block must be locatable');
  const block = source.slice(start, end);
  // The gate re-samples; it must never take the foreground itself.
  assert.doesNotMatch(block, /chrome\.tabs\.update\([^)]*active:\s*true/);
  assert.doesNotMatch(block, /chrome\.windows\.update\([^)]*focused:\s*true/);
  // Every trusted executor routes through the shared at-dispatch gate.
  assert.match(block, /withForegroundFocusGate/);
  // No executor raises the foreground requirement itself. Both raise points
  // (unverifiable state, and refusal) live in the gate, so no executor can
  // re-introduce a racing pre-flight check of its own.
  const gateStart = source.indexOf('async function sampleTabFocus');
  const gateEnd = source.indexOf('// U-V Action Pipeline');
  assert.ok(gateStart > 0 && gateEnd > gateStart, 'the shared gate must be locatable');
  const gate = source.slice(gateStart, gateEnd);
  assert.equal((gate.match(/foregroundRequired\(/g) || []).length, 2);
  assert.equal((block.match(/foregroundRequired\(/g) || []).length, 0);
  // The historical racing pre-flight sample is gone: the tab/window read now
  // lives only inside the gate.
  assert.equal((block.match(/chrome\.windows\.get\(/g) || []).length, 0);
  assert.match(gate, /chrome\.windows\.get\(/);
});

test('R9: keyboard text entry is routed through the existing sensitive-field guard', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function trustedKey');
  assert.ok(start > 0, 'trustedKey must exist');
  const block = source.slice(start, source.indexOf('\n}', start) + 2);
  assert.match(block, /page\.active_state/);
  assert.match(block, /active\.sensitive/);
  assert.match(block, /Input\.insertText/);
  assert.match(block, /withForegroundFocusGate/);
});
