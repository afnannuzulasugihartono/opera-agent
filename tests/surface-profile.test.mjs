// @last-edited: 2026-10-27 UTC+7.
// @title: surface-profile — what a surface is, measured, with the evidence that says so.
// @state: the probe against a fake page, the accessibility measurement against a fake tree, and the profile they build together.
// @dependencies: node:test, node:assert/strict, ../local/surface-profile.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SURFACE_PROBE_EXPRESSION,
  buildProfile,
  describeProfile,
  measureAx,
  probeSurface
} from '../local/surface-profile.js';

test('the probe expression is one expression that names no site', () => {
  assert.equal(typeof SURFACE_PROBE_EXPRESSION, 'string');
  for (const forbidden of ['docs.google', 'kix', 'sheets', 'slides']) {
    assert.ok(!SURFACE_PROBE_EXPRESSION.includes(forbidden), `the probe must not name ${forbidden}`);
  }
});

test('an ordinary page profiles as text in the DOM and no canvas', async () => {
  const evaluate = async () => ({
    textInDom: { value: true, evidence: 4200 },
    canvas: { value: false, evidence: 0 },
    editable: { value: false, evidence: 'no editable host' },
    focused: { value: false, evidence: 'document.hasFocus() is false' }
  });
  const probe = await probeSurface({ evaluate });
  assert.equal(probe.textInDom.value, true);
  assert.equal(probe.canvas.value, false);
});

test('a canvas editor profiles as canvas and editable', async () => {
  const evaluate = async () => ({
    textInDom: { value: false, evidence: 0 },
    canvas: { value: true, evidence: 0.61 },
    editable: { value: true, evidence: 'true' },
    focused: { value: true, evidence: 'document.hasFocus() is true' }
  });
  const probe = await probeSurface({ evaluate });
  assert.equal(probe.canvas.value, true);
  assert.equal(probe.editable.value, true);
});

test('the accessibility measurement picks the frame that carries the document', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return { nodes: [
      { frameId: 'chrome', role: { value: 'button' }, name: { value: 'Insert' } },
      { frameId: 'chrome', role: { value: 'InlineTextBox' }, name: { value: 'Mode tampilan' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'PROPOSAL PENAWARAN LOKASI' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'Kepada Yth.' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'Tim Pengembangan Lokasi' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'PT Indomarco Prismatama' } },
      { frameId: 'editor', role: { value: 'Canvas' }, name: { value: '' } }
    ] };
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.documentFrameId, 'editor');
  assert.equal(ax.textBoxes, 4);
  assert.equal(ax.axRich, true);
  assert.ok(ax.documentText.includes('PROPOSAL PENAWARAN LOKASI'));
  assert.ok(!ax.documentText.includes('Mode tampilan'), 'chrome text is left in its own frame');
});

test('a tree of pure chrome carries no document frame', async () => {
  const ask = async () => ({ nodes: [
    { frameId: 'chrome', role: { value: 'InlineTextBox' }, name: { value: 'Mode tampilan' } },
    { frameId: 'chrome', role: { value: 'button' }, name: { value: 'Share' } }
  ] });
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false);
  assert.equal(ax.documentFrameId, null);
  assert.equal(ax.documentText, '');
});

test('a failed accessibility call answers empty rather than throwing', async () => {
  const ask = async () => { throw new Error('the domain is not enabled'); };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false);
  assert.equal(ax.textBoxes, 0);
});

test('the profile the ladder reads is built from both halves', () => {
  const probe = {
    textInDom: { value: false, evidence: 0 },
    canvas: { value: true, evidence: 0.61 },
    editable: { value: true, evidence: 'true' },
    focused: { value: true, evidence: 'focused' }
  };
  const ax = { axRich: true, documentFrameId: 'editor', textBoxes: 215, textLength: 3063, documentText: 'x' };
  const profile = buildProfile({ probe, ax });
  assert.deepEqual(profile, { textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
});

test('the description names what was measured, not where it was measured', () => {
  const line = describeProfile({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
  assert.ok(line.includes('canvas'));
  assert.ok(line.includes('editable'));
  for (const forbidden of ['docs.google', 'kix']) assert.ok(!line.includes(forbidden));
});
