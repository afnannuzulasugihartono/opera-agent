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

// WHY THE EXPRESSION IS EVALUATED AGAINST A STUB PAGE.
// A page expression is a string, so a name the module exports and the page has never heard of is a ReferenceError that reads exactly like a page with no canvas, no text and no editor.
// Measured on a real Google Doc: the first version of this probe referenced the module's own constant inside the string, and the whole profile came back false.
// Running the string against a stub is the only cheap way to catch that before a browser does.

const runProbe = (page) => {
  const factory = new Function('document', 'window', `return ${SURFACE_PROBE_EXPRESSION}`);
  return factory(page.document, page.window);
};

const stubPage = ({ text = '', canvases = [], editable = null, focused = false, innerWidth = 1200, innerHeight = 800 }) => {
  const box = (w, h) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0 });
  return {
    document: {
      body: { innerText: text },
      querySelectorAll: (selector) => (selector === 'canvas' ? canvases.map(([w, h]) => ({ getBoundingClientRect: () => box(w, h) })) : []),
      querySelector: () => editable,
      hasFocus: () => focused
    },
    window: { innerWidth, innerHeight }
  };
};

test('the probe runs against a stub page and answers what it measured', () => {
  const out = runProbe(stubPage({ text: 'x'.repeat(400), canvases: [[816, 1056]], editable: { getAttribute: () => 'true' }, focused: true }));
  assert.equal(out.textInDom.value, true);
  assert.equal(out.textInDom.evidence, 400);
  assert.equal(out.canvas.value, true, 'a canvas over a fifth of the viewport is a canvas surface');
  assert.equal(out.editable.value, true);
  assert.equal(out.focused.value, true);
});

test('the probe answers an ordinary page with no canvas', () => {
  const out = runProbe(stubPage({ text: 'x'.repeat(400), canvases: [] }));
  assert.equal(out.canvas.value, false);
  assert.equal(out.canvas.evidence, 0);
  assert.equal(out.textInDom.value, true);
});

test('the probe reports the canvas coverage it measured, not a guess', () => {
  const out = runProbe(stubPage({ text: '', canvases: [[1200, 800]], innerWidth: 1200, innerHeight: 800 }));
  assert.equal(out.canvas.value, true);
  assert.equal(out.canvas.evidence, 1, 'a canvas the size of the viewport covers all of it');
});

test('the probe survives a page with no body', () => {
  const out = runProbe({ document: { body: null, querySelectorAll: () => [], querySelector: () => null, hasFocus: () => false }, window: { innerWidth: 1, innerHeight: 1 } });
  assert.equal(out.textInDom.value, false);
  assert.equal(out.canvas.value, false);
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

// A tree shaped the way Chrome answers: parentId and childIds on every node, chrome in one subtree and the document in another.

const axTree = ({ chrome, document: doc }) => {
  const nodes = [];
  nodes.push({ nodeId: 'root', parentId: undefined, childIds: ['chromeRoot', 'docRoot'], role: { value: 'RootWebArea' }, name: { value: '' } });
  nodes.push({ nodeId: 'chromeRoot', parentId: 'root', childIds: chrome.map((_, i) => `chrome${i}`), role: { value: 'toolbar' }, name: { value: '' } });
  chrome.forEach((text, i) => nodes.push({
    nodeId: `chrome${i}`, parentId: 'chromeRoot', childIds: [], role: { value: 'InlineTextBox' }, name: { value: text }
  }));
  nodes.push({ nodeId: 'docRoot', parentId: 'root', childIds: doc.map((_, i) => `doc${i}`), role: { value: 'generic' }, name: { value: '' } });
  doc.forEach((text, i) => nodes.push({
    nodeId: `doc${i}`, parentId: 'docRoot', childIds: [], role: { value: 'InlineTextBox' }, name: { value: text }
  }));
  return { nodes };
};

test('the accessibility measurement keeps the subtree that carries the document', async () => {
  const document = ['PROPOSAL PENAWARAN LOKASI', 'Kepada Yth.', 'Tim Pengembangan Lokasi', 'PT Indomarco Prismatama', 'Perihal penawaran lokasi', '1. Identitas Pengusul', '2. Latar Belakang', '3. Rincian Penawaran', '4. Nilai Investasi', '5. Jadwal'];
  const ask = async (method, params = {}) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return axTree({
      chrome: ['Insert', 'Mode tampilan', 'Screen reader support enabled'],
      document
    });
  };
  const ax = await measureAx({ ask });

  assert.equal(ax.textBoxes, document.length);
  assert.equal(ax.axRich, true);
  assert.ok(ax.documentText.includes('PROPOSAL PENAWARAN LOKASI'));
  assert.ok(!ax.documentText.includes('Mode tampilan'), 'chrome text stays in its own subtree');
  assert.ok(!ax.documentText.includes('Screen reader'), 'and so do the notices');
});

test('a tree of pure chrome is not rich enough to lead', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return axTree({ chrome: ['Mode tampilan', 'Share', 'Video', 'Banner hidden', 'Caption', 'Screen'], document: [] });
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false, 'a toolbar alone is not a document');
  assert.ok(ax.documentText.length > 0, 'and it is still reported as what the tree holds, not as no text at all');
});

test('a small document is not rich enough to lead, and its text is not thrown away', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return axTree({ chrome: ['Insert'], document: ['Hello', 'World'] });
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false, 'two text boxes is not enough to lead with');
  assert.equal(ax.documentText, 'HelloWorld', 'but the text is there for the read that has nowhere else to look');
});

test('a failed accessibility call answers empty rather than throwing', async () => {
  const ask = async () => { throw new Error('the domain is not enabled'); };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false);
  assert.equal(ax.textBoxes, 0);
});

test('a tree whose nodes carry no ids answers empty rather than looping', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return { nodes: [{ role: { value: 'InlineTextBox' }, name: { value: 'orphan' } }] };
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false);
  assert.equal(ax.documentText, '');
});

// WHY A CYCLE IS THE ONE TEST WHOSE FAILURE IS A HANG AND NOT AN ASSERTION.
// A tree whose nodes name each other as parents puts a cycle in the child map, and the descent has no visited set, so it oscillates between two nodes forever.
// That hang is synchronous, so no timer inside this process can interrupt it - the only evidence of the defect is that the run never returns, which is what a caller would get: read, surface_profile and wait_for_text all stop.
// The cycle has to hang off a real root to be reached at all: two nodes that name each other as parents are both non-roots, so the descent never enters them and a fixture built that way passes whether or not the defect is there.
// Measured before the fix: this fixture never returned and the run had to be killed at the command timeout.

test('a tree with a cycle answers instead of hanging', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return { nodes: [
      { nodeId: 'root', parentId: null, childIds: ['a'], role: { value: 'RootWebArea' }, name: { value: '' } },
      { nodeId: 'a', parentId: 'b', childIds: ['b'], role: { value: 'InlineTextBox' }, name: { value: 'one' } },
      { nodeId: 'b', parentId: 'a', childIds: ['a'], role: { value: 'InlineTextBox' }, name: { value: 'two' } }
    ] };
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false, 'two text boxes is not a document');
  assert.equal(typeof ax.textLength, 'number', 'and the walk ended instead of chasing the cycle');
});

test('a tree that points a node at itself answers instead of hanging', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return { nodes: [
      { nodeId: 'root', parentId: null, childIds: ['self'], role: { value: 'RootWebArea' }, name: { value: '' } },
      { nodeId: 'self', parentId: 'self', childIds: ['self'], role: { value: 'InlineTextBox' }, name: { value: 'loop' } }
    ] };
  };
  const ax = await measureAx({ ask });
  assert.equal(typeof ax.textLength, 'number');
});

test('the profile the ladder reads carries the evidence under every claim', () => {
  const probe = {
    textInDom: { value: false, evidence: 0 },
    canvas: { value: true, evidence: 0.61 },
    editable: { value: true, evidence: 'true' },
    focused: { value: true, evidence: 'document.hasFocus() is true' }
  };
  const ax = { axRich: true, textBoxes: 215, textLength: 3063, documentText: 'x', truncated: false };
  const profile = buildProfile({ probe, ax });
  assert.deepEqual(profile, {
    textInDom: false,
    canvas: true,
    editable: true,
    axRich: true,
    truncated: false,
    focused: true,
    evidence: {
      textInDom: 0,
      canvas: 0.61,
      editable: 'true',
      focused: 'document.hasFocus() is true',
      ax: { textBoxes: 215, textLength: 3063, truncated: false }
    }
  });
});

test('a tree cut at the depth cap says so, so short text is not read as a whole document', async () => {
  // One node per level down to the cap, with the text on the last one: a document this deep has almost certainly been cut by the request.
  const nodes = [{ nodeId: 'root', parentId: undefined, childIds: ['n1'], role: { value: 'RootWebArea' }, name: { value: '' } }];
  let parent = 'root';
  for (let depth = 1; depth <= 60; depth += 1) {
    const leaf = depth === 60;
    nodes.push({
      nodeId: `n${depth}`,
      parentId: parent,
      childIds: leaf ? [] : [`n${depth + 1}`],
      role: { value: leaf ? 'InlineTextBox' : 'generic' },
      name: { value: leaf ? 'last' : '' }
    });
    parent = `n${depth}`;
  }
  const ax = await measureAx({ ask: async () => ({ nodes }) });
  assert.equal(ax.truncated, true, 'a tree exactly as deep as the request may have been cut');
  assert.ok(describeProfile(buildProfile({ ax })).includes('depth cap'));
});

test('the description names what was measured, not where it was measured', () => {
  const line = describeProfile({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
  assert.ok(line.includes('canvas'));
  assert.ok(line.includes('editable'));
  for (const forbidden of ['docs.google', 'kix']) assert.ok(!line.includes(forbidden));
});
