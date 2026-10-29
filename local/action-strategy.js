// @last-edited: 2026-10-27 UTC+7.
// @title: action-strategy — whether an action is grounded on an element or on a coordinate, decided from evidence.
// @state: the two grounding strategies and one pure function that orders them for a surface.
// @dependencies: none.

// WHY A CANVAS SURFACE LEADS WITH COORDINATES.
// A canvas page exposes no DOM worth querying, but Blink computes an accessibility tree for every rendered page and every node in it resolves to a box.
// So a coordinate on a canvas page is grounded on a measured box rather than guessed, which is the opposite of a coordinate on a page that does have elements.

export const ACTION_DOM = 'dom';
export const ACTION_COORDINATE = 'coordinate';

export function actionLadder(profile = {}) {
  const canvas = profile.canvas === true;
  const dom = {
    strategy: ACTION_DOM,
    why: 'the page holds the element, so it can be found and clicked by name'
  };
  const coordinate = {
    strategy: ACTION_COORDINATE,
    why: 'the page draws the control, so it is grounded on the box the accessibility tree reports'
  };
  return canvas === true ? [
    coordinate,
    dom
  ] : [
    dom,
    coordinate
  ];
}
