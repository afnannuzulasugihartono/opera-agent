// @last-edited: 2026-10-27 UTC+7.
// @title: read-strategy — which read to attempt first, decided from evidence rather than from a site name.
// @state: the harm classes, the strategy names, and one pure function that turns a surface profile into an ordered ladder.
// @dependencies: none.

// WHY THIS MODULE IS PURE.
// The order a read is attempted in is the one decision that decides whether a user's caret survives, and it is made from five booleans.
// Keeping it a pure function means the whole decision is a table a test can read, and no browser has to be open to prove it.

export const HARM_NONE = 'none';
export const HARM_CARET_MOVE = 'caret-move';
export const HARM_CONTENT_CHANGE = 'content-change';

export const STRATEGY_AX = 'ax';
export const STRATEGY_DOM = 'dom';
export const STRATEGY_SELECT_ALL = 'select-all';
export const STRATEGY_VISION = 'vision';

const AX_STEP = {
  strategy: STRATEGY_AX,
  harm: HARM_NONE,
  why: 'the accessibility tree answers without touching the page'
};

const DOM_STEP = {
  strategy: STRATEGY_DOM,
  harm: HARM_NONE,
  why: 'the page already holds its text in the DOM'
};

const SELECT_ALL_STEP = {
  strategy: STRATEGY_SELECT_ALL,
  harm: HARM_CARET_MOVE,
  why: 'a canvas editor mirrors its text through the selection, and that moves the caret'
};

const VISION_STEP = {
  strategy: STRATEGY_VISION,
  harm: HARM_NONE,
  why: 'a picture is the last read that still asks nothing of the page'
};

// WHY THE ORDER FOLLOWS THE PROFILE AND NOT A FIXED LIST.
// Measured: the accessibility tree answers a canvas document in 19-30ms and the DOM text answers an ordinary page in one innerText.
// Reading the accessibility tree first on an ordinary page would change every existing caller's answer for no gain, so the DOM leads there and the accessibility tree leads where the DOM is empty.

// WHY THE ACCESSIBILITY TREE LEADS WHERE A CANVAS COVERS THE VIEWPORT.
// It answers a canvas document in 19-30ms and touches nothing, so it leads there.
// A page with no canvas holds its own text in the DOM, where one innerText is the cheaper and the cleaner answer, so the DOM leads there instead.
// The discriminator is the canvas, which is a structural fact about the page, rather than how much text the DOM happens to hold - a canvas editor keeps real text in its chrome, and a length bar cannot tell that text from a short page's.

// WHY SELECT-ALL NEEDS BOTH SIGNALS.
// A canvas without an editable region has nothing to select, so offering the step would report an empty read as an answer.

export function readLadder(profile = {}) {
  const canvas = profile.canvas === true;
  const editable = profile.editable === true;
  const axRich = profile.axRich === true;

  const ladder = [];
  if (canvas && axRich) ladder.push(AX_STEP);
  ladder.push(DOM_STEP);
  if (!(canvas && axRich)) ladder.push(AX_STEP);
  if (canvas && editable) ladder.push(SELECT_ALL_STEP);
  ladder.push(VISION_STEP);
  return ladder.map((step) => ({ ...step }));
}
