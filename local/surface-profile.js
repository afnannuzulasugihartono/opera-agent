// @last-edited: 2026-10-27 UTC+7.
// @title: surface-profile — what a surface is, measured in the page and in its accessibility tree, with the evidence for every claim.
// @state: the in-page probe expression, the accessibility measurement, and the profile both halves build.
// @dependencies: none.

// WHY EVERY CLAIM CARRIES ITS EVIDENCE.
// The read this replaces guessed a surface from its URL, so a wrong guess was invisible.
// A profile that reports the number it measured makes a wrong classification something a reader can see and a test can pin.

// WHY THE PROBE NAMES NO SITE.
// A selector or a domain in this file would be the per-site code this change exists to remove.
// Everything here is a property any page has: how much text it holds in the DOM, how much of the viewport a canvas covers, whether an editable host exists, and whether the page has focus.

// WHY THIS IS A CHEAP PRE-FILTER AND NOT THE DECISION.
// The wait uses it to avoid paying a full read on every poll of a page that plainly holds its own text.
// It is deliberately small, because a length bar cannot tell a short page's text from a canvas editor's chrome - the canvas signal in the profile is what makes that call, and this only skips the obvious case.

export const MIN_DOM_TEXT = 40;

export const SURFACE_PROBE_EXPRESSION = `(() => {
  const body = document.body;
  const text = body ? String(body.innerText || '') : '';
  const canvases = [...document.querySelectorAll('canvas')];
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  const covered = canvases.reduce((sum, el) => {
    const box = el.getBoundingClientRect();
    return sum + Math.max(0, box.width) * Math.max(0, box.height);
  }, 0);
  const editableHost = document.querySelector('[contenteditable=""], [contenteditable="true"], [role="textbox"]');
  return {
    textInDom: { value: text.trim().length >= MIN_DOM_TEXT, evidence: text.trim().length },
    canvas: { value: canvases.length > 0 && covered / viewport >= 0.2, evidence: Math.round((covered / viewport) * 100) / 100 },
    editable: { value: Boolean(editableHost), evidence: editableHost ? (editableHost.getAttribute('contenteditable') || editableHost.getAttribute('role')) : 'no editable host' },
    focused: { value: document.hasFocus() === true, evidence: 'document.hasFocus() is ' + String(document.hasFocus()) }
  };
})()`;

export async function probeSurface({ evaluate }) {
  const probe = await evaluate(SURFACE_PROBE_EXPRESSION);
  return {
    textInDom: probe?.textInDom ?? { value: false, evidence: 0 },
    canvas: probe?.canvas ?? { value: false, evidence: 0 },
    editable: probe?.editable ?? { value: false, evidence: 'the probe did not answer' },
    focused: probe?.focused ?? { value: false, evidence: 'the probe did not answer' }
  };
}

// WHY THE DOCUMENT FRAME IS CHOSEN BY COUNT AND NOT BY NAME.
// A canvas application keeps its chrome and its document in different frames, and the frame that carries the most text boxes is the document.
// Naming the frame, or filtering chrome by the strings it happens to print, would be per-site code wearing a structural disguise.

export async function measureAx({ ask, method = 'Accessibility.getFullAXTree' }) {
  let tree;
  try {
    tree = await ask(method, { maxDepth: 60 });
  } catch {
    return { axRich: false, documentFrameId: null, textBoxes: 0, textLength: 0, documentText: '' };
  }
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const perFrame = new Map();
  for (const node of nodes) {
    const role = node?.role?.value ?? '';
    if (role !== 'InlineTextBox' && role !== 'StaticText') continue;
    const frame = String(node?.frameId ?? '');
    const entry = perFrame.get(frame) ?? { count: 0, length: 0, parts: [] };
    entry.count += 1;
    entry.length += String(node?.name?.value ?? '').length;
    entry.parts.push(String(node?.name?.value ?? ''));
    perFrame.set(frame, entry);
  }
  let best = null;
  for (const [frame, entry] of perFrame) {
    if (!best || entry.count > best.entry.count) best = { frame, entry };
  }
  const rich = Boolean(best) && best.entry.count >= 3;
  return {
    axRich: rich,
    documentFrameId: rich ? best.frame : null,
    textBoxes: best ? best.entry.count : 0,
    textLength: best ? best.entry.length : 0,
    documentText: rich ? best.entry.parts.join('') : ''
  };
}

export function buildProfile({ probe = {}, ax = {} }) {
  return {
    textInDom: probe.textInDom?.value === true,
    canvas: probe.canvas?.value === true,
    editable: probe.editable?.value === true,
    axRich: ax.axRich === true,
    focused: probe.focused?.value === true
  };
}

export function describeProfile(profile = {}) {
  const parts = [];
  parts.push(profile.canvas === true ? 'canvas-rendered' : 'text in the DOM');
  if (profile.editable === true) parts.push('editable');
  if (profile.axRich === true) parts.push('accessibility-rich');
  parts.push(profile.focused === true ? 'focused' : 'unfocused');
  return parts.join(', ');
}
