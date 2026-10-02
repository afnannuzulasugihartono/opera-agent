import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';

// Extension UI surface, consolidated 2026-10-03.
//
// Three files locked the extension's own UI, all by reading the same popup and
// options sources as text, because popup.js and content.js need chrome.* and
// cannot be imported in node. They are one file here, in surface order.
//
//   tests/ui-accessibility.test.mjs        8 tests x 2 surfaces = 16
//   tests/popup-ui.test.mjs                1 test
//   tests/ui-identity-hardening.test.mjs   6 tests
//   -> tests/ui-surface.test.mjs          23 tests
//
//   A  accessible names and document structure, popup + options
//   B  popup control, layout and status contract
//   C  identity hardening: ref rebind, ranked find, visible-text fallback
//
// Test count and assertion count are the invariants: 23 tests and 45 assertions
// before, 23 and 45 after, none dropped, weakened or added. No identifier had
// to be renamed for the merge; the three files shared no top-level names.
//
// The scope limits are preserved verbatim in the section that owns them. They
// are not boilerplate: each one says what these checks deliberately do NOT
// establish, so a future reader cannot cite this file as evidence it does not
// provide.

// --- A. accessible names and document structure -----------------------------
//
// Structural accessibility contract for the extension's own UI surfaces.
//
// SCOPE, stated plainly so nobody over-reads this file: these are automated
// STRUCTURE checks, not a WCAG conformance audit and not assistive-technology
// testing. They catch the regressions that are cheap to introduce and expensive
// to notice -- a control that loses its label, a heading level skipped, a
// duplicate id, a click handler bolted onto a non-focusable element. They do NOT
// establish contrast ratios, focus order across the whole document, screen
// reader announcements, or conformance at any WCAG level. Nothing here may be
// cited as evidence of accessibility conformance.
//
// WHY REGEX INSTEAD OF A PARSER: this repository has zero runtime and dev
// dependencies (node 22 native only), so no HTML parser is available and adding
// one for a test would be a worse trade than a careful extractor. The tag
// matcher below understands quoted attribute values, so it does not break on a
// `>` inside an attribute.

const surfaces = [
  { name: 'popup.html', url: new URL('../extension/popup.html', import.meta.url) },
  { name: 'options.html', url: new URL('../extension/options.html', import.meta.url) }
];

// Matches `<name ...>` allowing quoted attribute values, so a `>` inside an
// attribute cannot truncate the match.
const tagPattern = (name) => new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'gi');

function tags(src, name) {
  return [...src.matchAll(tagPattern(name))].map((m) => m[0]);
}

// Every opening tag, quote-aware, so an attribute value containing `>` cannot
// truncate the match.
function anyTags(src) {
  return [...src.matchAll(/<[a-z][a-z0-9-]*\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)].map((m) => m[0]);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (m) return m[1];
  const single = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  if (single) return single[1];
  // HTML also permits an unquoted attribute value.
  const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, 'i'));
  return bare ? bare[1] : null;
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}\\s*=`, 'i').test(tag);
}

function idOf(tag) {
  return attr(tag, 'id');
}

// An element has an accessible name if any of these resolve. `label[for]`
// resolution is handled by the caller because it needs the whole document.
function hasIntrinsicName(tag) {
  const labelled = attr(tag, 'aria-label');
  if (labelled !== null && labelled.trim() !== '') return true;
  const labelledBy = attr(tag, 'aria-labelledby');
  if (labelledBy !== null && labelledBy.trim() !== '') return true;
  const title = attr(tag, 'title');
  if (title !== null && title.trim() !== '') return true;
  return false;
}

// Text content of the element STARTING AT `from`, up to its matching close tag.
// `from` must be the match index of this exact occurrence: resolving by tag text
// alone would let a nameless element inherit a sibling's identical open tag.
// Close tags are matched case-insensitively and tolerate whitespace before `>`,
// because both are legal HTML and neither should read as a missing name.
function textOf(src, tag, from) {
  const name = tagNameOf(tag);
  const close = new RegExp(`</${name}\\s*>`, 'i');
  const rest = src.slice(from + tag.length);
  const m = close.exec(rest);
  const inner = m ? rest.slice(0, m.index) : '';
  // A name inside aria-hidden is not exposed to assistive technology, so it does
  // not name the control.
  const exposed = inner.replace(
    /<([a-z][a-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*aria-hidden\s*=\s*(?:"true"|'true'|true)[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  );
  // A control named only by an image uses the image's alt text.
  const alt = exposed.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i);
  return `${exposed.replace(/<[^>]*>/g, ' ')} ${alt ? alt[1] : ''}`.replace(/\s+/g, ' ').trim();
}

function tagNameOf(tag) {
  return tag.match(/^<([a-z0-9]+)/i)[1];
}

// Character ranges covered by an `aria-hidden="true"` element, so a graphic
// nested inside a hidden wrapper counts as hidden. Without this the check would
// force redundant aria-hidden on every nested svg, and would still pass a
// decorative graphic inside a container that was never hidden.
function hiddenRanges(src) {
  const ranges = [];
  for (const m of src.matchAll(/<([a-z][a-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    if (attr(m[0], 'aria-hidden') !== 'true') continue;
    const name = m[1];
    const walker = new RegExp(`<(/)?${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'gi');
    walker.lastIndex = m.index;
    let depth = 0;
    let token = walker.exec(src);
    while (token) {
      if (token[1]) {
        depth -= 1;
        if (depth === 0) {
          ranges.push([m.index, token.index + token[0].length]);
          break;
        }
      } else {
        depth += 1;
      }
      token = walker.exec(src);
    }
  }
  return ranges;
}

for (const surface of surfaces) {
  test(`${surface.name} declares a document language`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const html = src.match(/<html\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i);
    assert.ok(html, '<html> element present');
    const lang = attr(html[0], 'lang');
    assert.ok(lang && lang.trim() !== '', 'html element declares a non-empty lang');
  });

  test(`${surface.name} gives every form control an accessible name`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const labelFor = new Set(
      [...src.matchAll(/<label\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)]
        .map((m) => attr(m[0], 'for'))
        .filter(Boolean)
    );
    // The implicit association -- <label>Name <input></label> -- is legal and common,
    // so it counts, including when the label wraps markup such as <br> or a <span>.
    // It does NOT count when the label contains no text, because an empty label
    // names nothing.
    const wrappingLabel = (at) => {
      const before = src.slice(0, at);
      // Consider only <label> tags, not the last tag of any kind: a label may
      // legitimately contain <br> or a <span>, and those must not hide the
      // enclosing label.
      const labels = [...before.matchAll(/<(\/?)label\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)];
      const last = labels.pop();
      // Group 1 is the leading slash: '' for an opening tag, '/' for a closing one.
      // An opening tag is the one still unclosed at this point.
      if (!last || last[1] === '/') return false;
      const labelBody = src.slice(last.index + last[0].length, at);
      return labelBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() !== '';
    };
    for (const name of ['input', 'select', 'textarea']) {
      for (const m of src.matchAll(tagPattern(name))) {
        const control = m[0];
        // A hidden control is not exposed to the user, so it needs no name.
        if (attr(control, 'type') === 'hidden') continue;
        const id = idOf(control);
        const named = hasIntrinsicName(control)
          || (id !== null && labelFor.has(id))
          || wrappingLabel(m.index);
        assert.ok(named, `control has an accessible name: ${control}`);
      }
    }
  });

  test(`${surface.name} gives every button an accessible name`, async () => {
    const src = await readFile(surface.url, 'utf8');
    for (const m of src.matchAll(tagPattern('button'))) {
      const named = hasIntrinsicName(m[0]) || textOf(src, m[0], m.index) !== '';
      assert.ok(named, `button has an accessible name: ${m[0]}`);
    }
  });

  test(`${surface.name} hides decorative graphics and labels meaningful ones`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const hidden = hiddenRanges(src);
    for (const img of tags(src, 'img')) {
      assert.ok(hasAttr(img, 'alt'), `img carries an alt attribute (may be empty): ${img}`);
    }
    for (const m of src.matchAll(tagPattern('svg'))) {
      const svg = m[0];
      const insideHiddenWrapper = hidden.some(([start, end]) => m.index >= start && m.index < end);
      // aria-hidden only hides when its value is true; aria-hidden="false" is an
      // explicit request to expose the element.
      const hiddenSelf = (attr(svg, 'aria-hidden') ?? '').toLowerCase() === 'true';
      assert.ok(
        hiddenSelf || insideHiddenWrapper || hasIntrinsicName(svg),
        `svg is hidden or labelled: ${svg}`
      );
    }
  });

  test(`${surface.name} never skips a heading level`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const levels = [...src.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
    assert.ok(levels.length > 0, 'the document has headings');
    assert.equal(levels[0], 1, 'the first heading is h1');
    for (let i = 1; i < levels.length; i += 1) {
      assert.ok(
        levels[i] - levels[i - 1] <= 1,
        `heading level jumped from h${levels[i - 1]} to h${levels[i]}`
      );
    }
  });

  test(`${surface.name} uses unique ids`, async () => {
    const src = await readFile(surface.url, 'utf8');
    // Quote-aware and hyphen-aware: `id='a'` counts, `data-id="a"` does not.
    const ids = [...src.matchAll(/(?<![\w-])id\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const seen = new Set();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(', ')}`);
  });

  test(`${surface.name} resolves every aria reference to a real element`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const ids = new Set([...src.matchAll(/(?<![\w-])id\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    for (const tag of anyTags(src)) {
      for (const name of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const value = attr(tag, name);
        if (value === null) continue;
        for (const ref of value.trim().split(/\s+/)) {
          assert.ok(ids.has(ref), `${name}="${ref}" resolves to an existing id`);
        }
      }
    }
  });

  test(`${surface.name} keeps interaction on natively focusable elements`, async () => {
    const src = await readFile(surface.url, 'utf8');
    assert.doesNotMatch(
      src,
      /(?<![\w-])tabindex\s*=\s*["']?\s*\+?[1-9]/i,
      'no positive tabindex reorders focus'
    );
    // Any element that is not natively interactive. Anchors are handled
    // separately because they are focusable only when they carry href.
    const nonInteractive = 'div|span|p|li|section|header|footer|main|nav|article|aside|figure'
      + '|h1|h2|h3|h4|h5|h6|td|th|tr|thead|tbody|tfoot|table|dt|dd|label|ul|ol|img|form'
      + '|fieldset|legend|option|optgroup|col|colgroup|caption|summary';
    for (const tag of src.match(new RegExp(`<(?:${nonInteractive})\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'gi')) || []) {
      assert.doesNotMatch(tag, /\bon(?:click|dblclick|mousedown|mouseup)\s*=/i,
        `click handler on a non-focusable element: ${tag}`);
    }
    // An anchor is focusable only with href, so only an href-less anchor is a
    // violation here. A handler on a real link is a different smell and out of
    // scope for this file.
    for (const tag of src.match(/<a\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi) || []) {
      if (hasAttr(tag, 'href')) continue;
      assert.doesNotMatch(tag, /\bon(?:click|dblclick|mousedown|mouseup)\s*=/i,
        `click handler on an href-less anchor: ${tag}`);
    }
  });
}

// --- B. popup control, layout and status contract ---------------------------

const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../extension/styles.css', import.meta.url), 'utf8');

test('popup keeps its controls accessible and responsive in narrow Opera panels', () => {
  for (const id of [
    'statusBadge', 'deviceName', 'connection', 'lastCommand', 'visionPrivacy',
    'pairSection', 'pairCode', 'pairButton', 'pairedSection', 'privateTabButton',
    'selfTestButton', 'selfTestResult', 'unpairButton'
  ]) {
    assert.match(popup, new RegExp(`id="${id}"`));
  }

  assert.match(popup, /<dl class="details">/);
  assert.match(popup, /role="alert"/);
  assert.match(styles, /width:\s*352px/);
  assert.match(styles, /min-width:\s*148px/);
  assert.match(styles, /max-width:\s*100vw/);
  assert.doesNotMatch(styles, /width:\s*min\(/);
  assert.match(styles, /@media \(max-width: 239px\)/);
  assert.doesNotMatch(styles, /min-width:\s*340px/);
  assert.match(script, /ready:\s*'Connected'/);
  assert.match(script, /currentTabPrivate \? 'blocked' : 'allowed'/);
});

// --- C. identity hardening --------------------------------------------------
//
// U-I identity hardening (2026-09-21): geometry-aware action-ref rebind
// rejection, ambiguity-ranked find with disambiguation hints, and a
// visible-text actionable fallback. Source-contract style: the runtime
// behavior is exercised by the controlled browser regression; these
// assertions lock the contract in source.

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const content = read('../extension/content.js');

test('I1: action-ref descriptors carry mint-time geometry and mutation version', () => {
  assert.match(content, /function actionRefDescriptor\(el, options = \{\}\)/);
  assert.match(content, /rectAtMint:/);
  assert.match(content, /mutationVersionAtMint:/);
  assert.match(content, /actionRefDescriptor\(el, \{ rectAtMint: documentRectOf\(el\), mutationVersionAtMint: mutationVersion \}\)/);
});

test('I1: rebind requires geometry continuity and rejects drift with current candidates', () => {
  assert.match(content, /function geometryMatchesMint/);
  assert.match(content, /GEOMETRY_DRIFT_TOLERANCE_PX = 24/);
  assert.match(content, /moved beyond the geometry tolerance/);
  assert.match(content, /currentCandidates/);
});

test('I2: ranked find results expose candidateRank plus a disambiguation hint', () => {
  assert.match(content, /function findDisambiguationHint/);
  assert.match(content, /candidateRank: position \+ 1/);
  assert.match(content, /chose:\$\{position \+ 1\}/);
});

test('I2: a zero exact match projects one bounded fuzzy candidate with an explicit hint', () => {
  assert.match(content, /fuzzy: true/);
  assert.match(content, /exact-match fallback from fuzzy text match/);
});

test('I3: visible text without an interactive element surfaces a nearby actionable candidate', () => {
  assert.match(content, /function findVisibleTextCandidate/);
  assert.match(content, /closest actionable element near the visible text/);
});

test('I4: rebind falls back to a unique intrinsic-signature successor when the keyed node loses its id', () => {
  // Live T041 (2026-09-21 07:47:45Z): YouTube recreated the Skip control
  // without its id between find and click; the keyed pool was empty and the
  // ref died as "Element not found or reference is stale." The fallback must
  // scan the interactive pool by intrinsic signature, keep uniqueness, and
  // leave the mint-time geometry guard as the last line of defense.
  assert.match(content, /function signatureRebindCandidates/);
  assert.match(content, /signatureRebindCandidates\(descriptor\)/);
  assert.match(content, /Keyed successor recreated without its id/);
  assert.match(content, /INTERACTIVE_SELECTOR\)\]\.slice\(0, 500\)/);
  assert.match(content, /visibleKey !== expectedKey/);
});
