// @last-edited: 2026-11-08 UTC+7.
// @title: page-map.test — the map's rules: seventeen classes, one class per element, a projection that says once, and a pull that pages.
// @state: the classification table, the class fields, the projection, the pagination, and the class summary.
// @dependencies: node:test, strict, ../extension/lib/page-map.js.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/lib/page-map.js');
const {
  PAGE_MAP_CLASSES, CLASS_FIELDS, PAGE_MAP_MAX_ELEMENTS,
  classify, isMapClass, isActionableClass, projectElement, paginate, summarizeClass
} = globalThis.OperaAgentPageMap;

test('the map knows exactly seventeen classes, in the order the rules run', () => {
  assert.deepEqual(PAGE_MAP_CLASSES, [
    'button', 'choice', 'input', 'select', 'heading', 'link', 'media', 'iframe',
    'picture', 'icon', 'table', 'list', 'form', 'region', 'separator', 'status', 'text'
  ]);
  assert.equal(new Set(PAGE_MAP_CLASSES).size, 17);
  assert.deepEqual(Object.keys(CLASS_FIELDS).sort(), [...PAGE_MAP_CLASSES].sort());
  assert.deepEqual(CLASS_FIELDS.link, ['href']);
  assert.deepEqual(CLASS_FIELDS.picture, ['src', 'alt']);
  assert.equal(PAGE_MAP_MAX_ELEMENTS, 20000);
});

test('one element gets one class, and the first matching rule wins', () => {
  assert.equal(classify({ tag: 'a', role: 'button', href: 'https://x.test/' }), 'button');
  assert.equal(classify({ tag: 'input', type: 'submit' }), 'button');
  assert.equal(classify({ tag: 'input', type: 'checkbox' }), 'choice');
  assert.equal(classify({ tag: 'input', type: 'text' }), 'input');
  assert.equal(classify({ tag: 'textarea' }), 'input');
  assert.equal(classify({ tag: 'select' }), 'select');
  assert.equal(classify({ tag: 'a', href: 'https://x.test/' }), 'link');
  assert.equal(classify({ tag: 'a' }), '');
  assert.equal(classify({ tag: 'h3' }), 'heading');
  assert.equal(classify({ tag: 'ul' }), 'list');
  assert.equal(classify({ tag: 'table' }), 'table');
  assert.equal(classify({ tag: 'form' }), 'form');
  assert.equal(classify({ tag: 'header' }), 'region');
  assert.equal(classify({ tag: 'hr' }), 'separator');
  assert.equal(classify({ tag: 'output' }), 'status');
  assert.equal(classify({ tag: 'p' }), 'text');
  assert.equal(classify({ tag: 'iframe' }), 'iframe');
  assert.equal(classify({ tag: 'video' }), 'media');
  assert.equal(classify({ tag: 'div' }), '');
  assert.equal(classify({ tag: 'span' }), '');
  assert.equal(isMapClass('link'), true);
  assert.equal(isMapClass('nope'), false);
});

test('a rendered image is a picture, and a small one is an icon', () => {
  assert.equal(classify({ tag: 'img', width: 40, height: 40 }), 'picture');
  assert.equal(classify({ tag: 'img', width: 10, height: 10 }), 'icon');
  assert.equal(classify({ tag: 'svg', width: 40, height: 40 }), 'picture');
  assert.equal(classify({ tag: 'canvas', width: 100, height: 50 }), 'picture');
  assert.equal(classify({ tag: 'img', role: 'img', width: 8, height: 8 }), 'icon');
});

test('the projection carries the class fields once and drops what is empty', () => {
  const link = projectElement({
    class: 'link', ref: 'oa_1', tag: 'a', role: 'link', text: 'Docs', href: '/docs',
    x: 10, y: 20, width: 100, height: 14, order: 3, depth: 0, regionId: 'rg_document',
    visible: true, actionable: true, disabled: false, logicalId: 'se_1', stableKey: 'oa_2'
  });
  assert.deepEqual(link, {
    class: 'link', ref: 'oa_1', tag: 'a', role: 'link', text: 'Docs', href: '/docs',
    rect: { x: 10, y: 20, width: 100, height: 14, centerX: 60, centerY: 27 },
    order: 3, depth: 0, regionId: 'rg_document',
    visible: true, actionable: true, disabled: false, logicalId: 'se_1', stableKey: 'oa_2'
  });
  assert.equal('label' in link, false, 'a label that repeats the text is not carried');

  const choice = projectElement({ class: 'choice', ref: 'oa_3', tag: 'input', checked: false, name: 'pick', type: 'checkbox', x: 0, y: 0, width: 16, height: 16, order: 4, visible: true, actionable: true, disabled: false });
  assert.equal(choice.checked, false);
  assert.equal(choice.name, 'pick');
  assert.equal(choice.type, 'checkbox');

  const cell = projectElement({ class: 'text', ref: 'oa_4', tag: 'td', text: '42', row: 3, col: 1, x: 0, y: 0, width: 8, height: 8, order: 5, visible: true, actionable: false, disabled: false });
  assert.equal(cell.row, 3);
  assert.equal(cell.col, 1);
});

test('a pull pages without gaps or duplicates', () => {
  const elements = [0, 1, 2, 3, 4].map((index) => ({ ref: 'oa_' + index }));
  assert.deepEqual(paginate(elements, 0, 2), {
    elements: [{ ref: 'oa_0' }, { ref: 'oa_1' }], offset: 0, limit: 2, total: 5, hasMore: true, nextOffset: 2
  });
  assert.deepEqual(paginate(elements, 4, 2), {
    elements: [{ ref: 'oa_4' }], offset: 4, limit: 2, total: 5, hasMore: false, nextOffset: null
  });
  assert.deepEqual(paginate(elements, 9, 2).elements, []);
  assert.equal(paginate(elements, -5, 2).offset, 0);
  assert.equal(paginate(elements, 0, 5000).limit, 1000);
  assert.equal(paginate(elements, 0).limit, 200);
});

test('a class summary counts its elements and boxes them', () => {
  const summary = summarizeClass('link', [
    { rect: { x: 10, y: 20, width: 100, height: 14 } },
    { rect: { x: 30, y: 60, width: 50, height: 10 } }
  ]);
  assert.deepEqual(summary, { class: 'link', count: 2, bbox: { x: 10, y: 20, width: 100, height: 50 } });
  assert.equal(summarizeClass('media', []).bbox, null);
});

test('a hidden field is not a field the map carries a value for', () => {
  assert.equal(classify({ tag: 'input', type: 'hidden' }), '');
});

test('a summary is text, though the browser gives it a button role', () => {
  assert.equal(classify({ tag: 'summary', role: 'button' }), 'text');
  assert.equal(classify({ tag: 'button' }), 'button');
  assert.equal(classify({ tag: 'div', role: 'button' }), 'button');
});

test('actionability belongs to the classes a person can act on', () => {
  assert.equal(isActionableClass('button'), true);
  assert.equal(isActionableClass('link'), true);
  assert.equal(isActionableClass('input'), true);
  assert.equal(isActionableClass('choice'), true);
  assert.equal(isActionableClass('select'), true);
  assert.equal(isActionableClass('media'), true);
  assert.equal(isActionableClass('iframe'), true);
  assert.equal(isActionableClass('text'), false);
  assert.equal(isActionableClass('heading'), false);
  assert.equal(isActionableClass('region'), false);
  assert.equal(isActionableClass('picture'), false);
});
