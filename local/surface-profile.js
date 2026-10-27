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

// WHY THE BAR IS WRITTEN INTO THE EXPRESSION AND NOT IMPORTED INTO IT.
// A page expression is a string evaluated in a page that knows nothing about this module, so a constant named here is a name the page has never heard of.
// Measured on a real Google Doc: the first version of this probe referenced the module's own constant inside the string, the page threw a ReferenceError, and the whole profile came back false - which reads exactly like a page with no canvas, no text and no editor.

export const SURFACE_PROBE_EXPRESSION = `(() => {
  const MIN_DOM_TEXT = ${MIN_DOM_TEXT};
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

// WHY THE DOCUMENT REGION IS FOUND BY ITS SUBTREE AND NOT BY A FRAME.
// Measured on a real Google Doc, three ways that do not work: Accessibility.getFullAXTree returns one flat tree of 866 nodes in which a single node carries a frameId, so reading frameId off every node separates nothing; Page.getFrameTree names eight frames, and Accessibility.getPartialAXTree refuses a frame id on its own, asking for a node id, a backend node id or an object id instead.
// What the tree does carry on every node is parentId and childIds, so the tree can be rebuilt and the region that dominates its own siblings is the document - the toolbar, the menus and the notices are separate subtrees, and they lose.
// Naming a frame, or filtering chrome by the strings it happens to print, would be per-site code wearing a structural disguise.

// WHY THE REGION IS FOUND BY DESCENDING AND NOT BY TAKING THE BIGGEST SUBTREE.
// The biggest subtree in any tree is its root, which holds the chrome as well as the document, so taking it returns the toolbar and the notices along with the prose.
// Descending into whichever child holds the most text stops at the region that dominates its own siblings, which is the document and not the page around it.

// WHY THE TEST IS AGAINST THE SIBLINGS AND NOT AGAINST THE PARENT.
// The parent's total is the sum of every child, so no child ever outgrows it and a descent that compares against the parent stops at the root and takes the chrome with the document.
// A region is the document when it holds more than the rest of the page put together, so that is the comparison.

const TEXT_ROLES = new Set(['InlineTextBox', 'StaticText']);

// WHY THE CHILDREN ARE BUILT FROM parentId AND NOT READ FROM childIds.
// A tree can answer with one and not the other, and a walk that trusts only childIds finds nothing in a tree that carries only parentId - which answers exactly like a page with no text.
// Measured while writing this: the first fixture listed children on the parent and left childIds empty, and the walk came back with zero text nodes on a tree that plainly held four.

const documentRegion = (nodes) => {
  const byId = new Map();
  for (const node of nodes) {
    if (node?.nodeId === undefined || node.nodeId === null) continue;
    byId.set(String(node.nodeId), node);
  }
  // Two passes, because a tree does not promise its parents before its children.
  const children = new Map();
  for (const [id, node] of byId) {
    const parent = node.parentId === undefined || node.parentId === null ? null : String(node.parentId);
    if (parent && byId.has(parent)) {
      const list = children.get(parent) ?? [];
      if (!list.includes(id)) list.push(id);
      children.set(parent, list);
    }
    for (const child of node.childIds || []) {
      const childId = String(child);
      if (!byId.has(childId)) continue;
      const list = children.get(id) ?? [];
      if (!list.includes(childId)) list.push(childId);
      children.set(id, list);
    }
  }
  const measured = new Map();
  const textOf = (id) => {
    const node = byId.get(id);
    if (!node || !TEXT_ROLES.has(node.role?.value ?? '')) return { count: 0, length: 0, parts: [] };
    const name = String(node.name?.value ?? '');
    return { count: 1, length: name.length, parts: [name] };
  };
  const total = (id, seen) => {
    if (measured.has(id)) return measured.get(id);
    if (seen.has(id)) return { count: 0, length: 0, parts: [] };
    seen.add(id);
    let sum = textOf(id);
    for (const childId of children.get(id) || []) {
      if (!byId.has(childId)) continue;
      const inner = total(childId, seen);
      sum = { count: sum.count + inner.count, length: sum.length + inner.length, parts: [...sum.parts, ...inner.parts] };
    }
    measured.set(id, sum);
    return sum;
  };
  const roots = [];
  for (const [id, node] of byId) {
    const parent = node?.parentId === undefined || node.parentId === null ? null : String(node.parentId);
    if (!parent || !byId.has(parent)) roots.push(id);
  }
  let here = null;
  for (const id of roots) {
    const sum = total(id, new Set());
    if (!here || sum.count > here.sum.count) here = { id, sum };
  }
  if (!here) return { count: 0, length: 0, parts: [], deepest: 0 };
  // WHY THE DESCENT CARRIES A VISITED SET AND NOT A COUNTER.
  // A tree that names a node's ancestor as its child makes a cycle, and the descent follows it: a node in the cycle holds as much text as everything beside it, so it keeps winning the comparison against its own siblings.
  // Measured with a three-node tree hanging off a real root: measureAx never returned, and the hang is synchronous, so read, surface_profile and wait_for_text all stopped with no error and no timeout.
  // A visited set ends the walk at the first node it has already stood on, which is the answer a depth cap would reach only after walking the same loop.
  const visited = new Set([here.id]);
  for (;;) {
    const kids = [];
    for (const childId of children.get(here.id) || []) {
      if (!byId.has(childId) || visited.has(childId)) continue;
      kids.push({ id: childId, sum: total(childId, new Set()) });
    }
    if (!kids.length) break;
    kids.sort((a, b) => b.sum.count - a.sum.count);
    const siblings = kids.reduce((sum, kid) => sum + kid.sum.count, 0);
    if (kids[0].sum.count * 2 <= siblings) break;
    here = kids[0];
    visited.add(here.id);
  }
  // WHY THE DEPTH OF THE WHOLE TREE IS MEASURED AS WELL.
  // The tree is requested with a depth cap, and a document deeper than the cap comes back cut: its text ends early and nothing in the answer says so.
  // Reaching the cap is the only evidence available that the text may be incomplete, so it is reported rather than guessed at.
  let deepest = 0;
  const walked = new Set(roots);
  let frontier = roots;
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const childId of children.get(id) || []) {
        if (!byId.has(childId) || walked.has(childId)) continue;
        walked.add(childId);
        next.push(childId);
      }
    }
    if (next.length) deepest += 1;
    frontier = next;
  }
  return { count: here.sum.count, length: here.sum.length, parts: here.sum.parts, deepest };
};

// WHY THE TREE IS ASKED FOR AT A STATED DEPTH.
// Chrome truncates an accessibility tree at the depth it was asked for, so the request and the report of it have to agree: a document cut at the cap answers with text that looks complete.

const MAX_AX_DEPTH = 60;

export async function measureAx({ ask, method = 'Accessibility.getFullAXTree' }) {
  const empty = { axRich: false, textBoxes: 0, textLength: 0, documentText: '', truncated: false };
  let tree;
  try {
    tree = await ask(method, { maxDepth: MAX_AX_DEPTH });
  } catch {
    return empty;
  }
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  if (!nodes.length) return empty;

  const region = documentRegion(nodes);
  // WHY THE BAR IS TEN TEXT BOXES.
  // Measured on a real Google Doc: the document region carries 155 of them and the chrome around it carries 60, so a document clears this by an order of magnitude.
  // A toolbar alone carries a handful, and reading that first would answer with menu labels - so below this the DOM is the cheaper and the cleaner answer.
  // The bar decides which read leads.
  // It does not decide whether the text exists: that is what the region itself says.
  const rich = region.count >= 10;
  return {
    axRich: rich,
    textBoxes: region.count,
    textLength: region.length,
    documentText: region.parts.join(''),
    truncated: region.deepest >= MAX_AX_DEPTH
  };
}

export function buildProfile({ probe = {}, ax = {} }) {
  return {
    textInDom: probe.textInDom?.value === true,
    canvas: probe.canvas?.value === true,
    editable: probe.editable?.value === true,
    axRich: ax.axRich === true,
    truncated: ax.truncated === true,
    focused: probe.focused?.value === true,
    // WHY THE NUMBERS RIDE ALONG WITH THE BOOLEANS.
    // A boolean is the decision; the number is why the decision was made, and the number is what a reader needs when the decision turns out wrong.
    // Without it a misclassification is silent again, which is the exact thing this profile exists to end.
    evidence: {
      textInDom: probe.textInDom?.evidence ?? null,
      canvas: probe.canvas?.evidence ?? null,
      editable: probe.editable?.evidence ?? null,
      focused: probe.focused?.evidence ?? null,
      ax: {
        textBoxes: ax.textBoxes ?? 0,
        textLength: ax.textLength ?? 0,
        truncated: ax.truncated === true
      }
    }
  };
}

// WHY THE DESCRIPTION NAMES WHAT WAS MEASURED.
// It is the one line a caller reads to know what it is dealing with, so it names the surface's shape and nothing about where that shape was found.

export function describeProfile(profile = {}) {
  const parts = [];
  parts.push(profile.canvas === true ? 'canvas-rendered' : 'text in the DOM');
  if (profile.editable === true) parts.push('editable');
  if (profile.axRich === true) parts.push('accessibility-rich');
  if (profile.truncated === true) parts.push('accessibility tree cut at the depth cap');
  parts.push(profile.focused === true ? 'focused' : 'unfocused');
  return parts.join(', ');
}
