import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (m) return m[1];
  const single = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return single ? single[1] : null;
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

// Text content of an element up to its matching close tag, whitespace collapsed.
// Good enough for the button-label check on these small, well-formed documents.
function textOf(src, tag) {
  const open = tagPattern(tag.source ? tag.source.slice(1, -1).split('\\b')[0] : 'button');
  const name = tagNameOf(tag);
  const start = src.indexOf(tag);
  const close = `</${name}>`;
  const end = src.indexOf(close, start);
  if (start === -1 || end === -1) return '';
  return src.slice(start + tag.length, end).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    for (const control of [...tags(src, 'input'), ...tags(src, 'select'), ...tags(src, 'textarea')]) {
      // A hidden control is not exposed to the user, so it needs no name.
      if (attr(control, 'type') === 'hidden') continue;
      const name = hasIntrinsicName(control) || (idOf(control) !== null && labelFor.has(idOf(control)));
      assert.ok(name, `control has an accessible name: ${control}`);
    }
  });

  test(`${surface.name} gives every button an accessible name`, async () => {
    const src = await readFile(surface.url, 'utf8');
    for (const button of tags(src, 'button')) {
      const named = hasIntrinsicName(button) || textOf(src, button) !== '';
      assert.ok(named, `button has an accessible name: ${button}`);
    }
  });

  test(`${surface.name} hides decorative graphics and labels meaningful ones`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const hidden = hiddenRanges(src);
    for (const img of tags(src, 'img')) {
      assert.ok(hasAttr(img, 'alt'), `img carries an alt attribute (may be empty): ${img}`);
    }
    for (const svg of tags(src, 'svg')) {
      const at = src.indexOf(svg);
      const insideHiddenWrapper = hidden.some(([start, end]) => at >= start && at < end);
      assert.ok(
        hasAttr(svg, 'aria-hidden') || insideHiddenWrapper || hasIntrinsicName(svg),
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
    const ids = [...src.matchAll(/\bid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
    const seen = new Set();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(', ')}`);
  });

  test(`${surface.name} resolves every aria reference to a real element`, async () => {
    const src = await readFile(surface.url, 'utf8');
    const ids = new Set([...src.matchAll(/\bid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]));
    for (const tag of src.match(/<[a-z][^>]*>/gi) || []) {
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
    assert.doesNotMatch(src, /\btabindex\s*=\s*"?[1-9]/i, 'no positive tabindex reorders focus');
    for (const tag of src.match(/<(?:div|span|p|li|section)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi) || []) {
      assert.doesNotMatch(tag, /\bon(?:click|dblclick|mousedown|mouseup)\s*=/i,
        `click handler on a non-focusable element: ${tag}`);
    }
  });
}