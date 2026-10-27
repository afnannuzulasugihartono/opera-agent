// @last-edited: 2026-10-27 UTC+7.
// @title: surface-drive — the assembled driver, proved against a fake CDP client.
// @state: the profile tool, the gated read, and the answer that names what it skipped and why.
// @dependencies: node:test, node:assert/strict, ../local/primitives.js, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitives } from '../local/primitives.js';
import { HARM_CARET_MOVE, STRATEGY_AX } from '../local/read-strategy.js';

const richAx = ['PROPOSAL PENAWARAN', 'Kepada Yth.', 'Tim Pengembangan Lokasi', 'PT Indomarco Prismatama', 'Perihal penawaran lokasi', '1. Identitas Pengusul', '2. Latar Belakang', '3. Rincian Penawaran', '4. Nilai Investasi', '5. Jadwal'];
const poorAx = ['Share'];

const axTree = (texts) => {
  const nodes = [
    { nodeId: 'root', parentId: undefined, childIds: ['chromeRoot', 'docRoot'], role: { value: 'RootWebArea' }, name: { value: '' } },
    { nodeId: 'chromeRoot', parentId: 'root', childIds: [], role: { value: 'toolbar' }, name: { value: '' } },
    { nodeId: 'docRoot', parentId: 'root', childIds: [], role: { value: 'generic' }, name: { value: '' } }
  ];
  texts.forEach((text, i) => nodes.push({ nodeId: `doc${i}`, parentId: 'docRoot', childIds: [], role: { value: 'InlineTextBox' }, name: { value: text } }));
  return { nodes };
};

const fakeCdp = ({ probe, ax = richAx, copy, domText = '', caret = null }) => {
  const sent = [];
  return {
    sent,
    async send(method, params = {}) {
      sent.push({ method, expression: params.expression });
      const expression = String(params.expression ?? '');
      // The probe is keyed on the canvas-coverage arithmetic, which no other expression in the driver contains, so readState is not mistaken for it.
      if (method === 'Runtime.evaluate' && expression.includes('window.innerHeight')) {
        return { result: { value: probe } };
      }
      if (method === 'Accessibility.getFullAXTree') return axTree(ax);
      if (method === 'Runtime.evaluate' && expression.includes('document.execCommand')) {
        return { result: { value: copy } };
      }
      if (method === 'Runtime.evaluate' && expression.includes('innerText')) {
        return { result: { value: { title: 'Fake', url: 'https://example.invalid/', text: domText, ready: 'complete' } } };
      }
      // The caret guard's own expression, which walks every frame for a selection.
      if (method === 'Runtime.evaluate' && expression.includes('hostTextLength')) {
        return { result: { value: caret } };
      }
      // The gated copy, which reads the borrowed selection back from every frame.
      if (method === 'Runtime.evaluate' && expression.includes('best.length')) {
        return { result: { value: copy } };
      }
      return { result: { value: null } };
    },
    close() {}
  };
};

const canvasProbe = {
  textInDom: { value: false, evidence: 0 },
  canvas: { value: true, evidence: 0.61 },
  editable: { value: true, evidence: 'true' },
  focused: { value: true, evidence: 'document.hasFocus() is true' }
};

test('surface_profile answers without reading the document', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: richAx, copy: '' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.surfaceProfile();
  assert.equal(out.surface.canvas, true);
  assert.equal(out.surface.editable, true);
  assert.ok(out.description.includes('canvas'));
  assert.equal(out.strategy[0].strategy, STRATEGY_AX);
});

test('a read with no consent skips the caret-moving step and says why', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: poorAx, copy: '' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: false });
  const skipped = out.skipped.find((entry) => entry.harm === HARM_CARET_MOVE);
  assert.ok(skipped, 'the caret-moving step is reported as skipped');
  assert.match(skipped.why, /consent/i);
  assert.equal(out.text, '', 'nothing was read from a step that was refused');
});

test('a read with consent runs the caret-moving step', async () => {
  // A canvas caret: offset 0 on a node with no text, which is what the real measurement found, so the verdict must report it could not be restored.
  const canvasCaret = { rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 };
  const cdp = fakeCdp({
    probe: canvasProbe,
    ax: poorAx,
    copy: 'PROPOSAL PENAWARAN',
    caret: canvasCaret
  });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: true });
  assert.equal(out.text, 'PROPOSAL PENAWARAN');
  assert.equal(out.harm, HARM_CARET_MOVE);
  assert.equal(out.skipped.length, 0);
  assert.equal(out.caretRestored, false, 'the verdict never claims a restore it did not measure');
  assert.equal(out.caret.restored, false);
});

test('a rich accessibility tree answers before the gated step is ever reached', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: richAx, copy: 'PROPOSAL PENAWARAN' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: false });
  assert.equal(out.strategy, 'ax');
  assert.equal(out.harm, 'none', 'the accessibility read touches nothing, so the gate is never consulted');
  assert.equal(out.skipped.length, 0);
  assert.ok((out.text || '').includes('PROPOSAL PENAWARAN'));
});

test('an ordinary DOM page is read through the DOM and nothing is skipped', async () => {
  const domProbe = {
    textInDom: { value: true, evidence: 4200 },
    canvas: { value: false, evidence: 0 },
    editable: { value: false, evidence: 'no editable host' },
    focused: { value: false, evidence: 'document.hasFocus() is false' }
  };
  const cdp = fakeCdp({ probe: domProbe, ax: [], copy: '', domText: 'A page that already holds its own words.' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read();
  assert.equal(out.strategy, 'dom');
  assert.equal(out.harm, 'none');
  assert.equal(out.skipped.length, 0);
  assert.equal(out.text, 'A page that already holds its own words.');
});

test('a surface no read can answer names the picture instead of returning nothing', async () => {
  const bareProbe = {
    textInDom: { value: false, evidence: 0 },
    canvas: { value: true, evidence: 0.4 },
    editable: { value: false, evidence: 'no editable host' },
    focused: { value: false, evidence: 'document.hasFocus() is false' }
  };
  const cdp = fakeCdp({ probe: bareProbe, ax: poorAx, copy: '', domText: '' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read();
  assert.equal(out.strategy, 'vision');
  assert.match(out.visionWhy, /capture_page/);
  assert.equal(out.text, '');
});
