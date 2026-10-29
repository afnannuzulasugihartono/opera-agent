// @last-edited: 2026-10-21 UTC+7.
// @title: ui-surface.test — the popup and the find results, as the person sees them.
// @state: the controls that stay usable in a narrow panel, and the descriptors a candidate carries back.
// @dependencies: node:test, strict, node:fs, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { contentSource } from './helpers/content-source.mjs';

const surfaces = [
  {
    name: 'popup.html',
    url: new URL('../extension/popup.html', import.meta.url)
  },
  {
    name: 'options.html',
    url: new URL('../extension/options.html', import.meta.url)
  }
];

const tagPattern = (name) => new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'gi');

function tags(
  src,
  name
) {
  return [...src.matchAll(tagPattern(name))].map((m) => m[0]);
}

function anyTags(src) {
  return [...src.matchAll(/<[a-z][a-z0-9-]*\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)].map((m) => m[0]);
}

function attr(
  tag,
  name
) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (m) return m[1];
  const single = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  if (single) return single[1];

  const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, 'i'));
  return bare ? bare[1] : null;
}

function hasAttr(
  tag,
  name
) {
  return new RegExp(`\\b${name}\\s*=`, 'i').test(tag);
}

function idOf(tag) {
  return attr(tag, 'id');
}

function hasIntrinsicName(tag) {
  const labelled = attr(tag, 'aria-label');
  if (labelled !== null && labelled.trim() !== '') return true;
  const labelledBy = attr(tag, 'aria-labelledby');
  if (labelledBy !== null && labelledBy.trim() !== '') return true;
  const title = attr(tag, 'title');
  if (title !== null && title.trim() !== '') return true;
  return false;
}

function textOf(
  src,
  tag,
  from
) {
  const name = tagNameOf(tag);
  const close = new RegExp(`</${name}\\s*>`, 'i');
  const rest = src.slice(from + tag.length);
  const m = close.exec(rest);
  const inner = m ? rest.slice(0, m.index) : '';

  const exposed = inner.replace(
    /<([a-z][a-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*aria-hidden\s*=\s*(?:"true"|'true'|true)[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  );

  const alt = exposed.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i);
  return `${exposed.replace(/<[^>]*>/g, ' ')} ${alt ? alt[1] : ''}`.replace(/\s+/g, ' ').trim();
}

function tagNameOf(tag) {
  return tag.match(/^<([a-z0-9]+)/i)[1];
}

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
          ranges.push([
            m.index,
            token.index + token[0].length
          ]);
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

    const wrappingLabel = (at) => {
      const before = src.slice(0, at);

      const labels = [...before.matchAll(/<(\/?)label\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)];
      const last = labels.pop();

      if (!last || last[1] === '/') return false;
      const labelBody = src.slice(last.index + last[0].length, at);
      return labelBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() !== '';
    };
    for (const name of ['input', 'select', 'textarea']) {
      for (const m of src.matchAll(tagPattern(name))) {
        const control = m[0];

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
      const insideHiddenWrapper = hidden.some(([
        start,
        end
      ]) => m.index >= start && m.index < end);

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

    const nonInteractive = 'div|span|p|li|section|header|footer|main|nav|article|aside|figure'
      + '|h1|h2|h3|h4|h5|h6|td|th|tr|thead|tbody|tfoot|table|dt|dd|label|ul|ol|img|form'
      + '|fieldset|legend|option|optgroup|col|colgroup|caption|summary';
    for (const tag of src.match(new RegExp(`<(?:${nonInteractive})\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'gi')) || []) {
      assert.doesNotMatch(tag, /\bon(?:click|dblclick|mousedown|mouseup)\s*=/i,
        `click handler on a non-focusable element: ${tag}`);
    }

    for (const tag of src.match(/<a\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi) || []) {
      if (hasAttr(tag, 'href')) continue;
      assert.doesNotMatch(tag, /\bon(?:click|dblclick|mousedown|mouseup)\s*=/i,
        `click handler on an href-less anchor: ${tag}`);
    }
  });
}

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
  assert.match(script, /ready:\s*'Terhubung'/);
  assert.match(script, /currentTabPrivate \? 'blocked' : 'allowed'/);
});

const content = contentSource();

test('I1: action-ref descriptors carry mint-time geometry and mutation version', () => {
  assert.match(content, /function actionRefDescriptor\(\s*el,\s*options = \{\}\s*\)/);
  assert.match(content, /rectAtMint:/);
  assert.match(content, /mutationVersionAtMint:/);
  assert.match(content, /actionRefDescriptor\(\s*el,\s*\{\s*rectAtMint: documentRectOf\(el\),\s*mutationVersionAtMint: mutationVersion\s*\}\s*\)/);
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
  assert.match(content, /function findVisibleTextCandidate/);
  assert.match(content, /findVisibleTextCandidate\(text\)/);
  assert.match(content, /collectInteractiveNodes\(\)/);
});

test('I4: rebind falls back to a unique intrinsic-signature successor when the keyed node loses its id', () => {
  assert.match(content, /function signatureRebindCandidates/);
  assert.match(content, /signatureRebindCandidates\(descriptor\)/);
  assert.match(content, /return keyed\.concat\(signatureRebindCandidates\(descriptor\)\)/);
  assert.match(content, /INTERACTIVE_SELECTOR\)\]\.slice\(0, 500\)/);
  assert.match(content, /visibleKey !== expectedKey/);
});
