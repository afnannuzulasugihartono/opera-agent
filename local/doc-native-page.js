// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-page — the live document a paper is carried into: it has to be in sight, and a marker in it has to be found.
// @state: the visibility probe, the find-bar probe, and the marker finder both the charts and the structure use.
// @dependencies: ./window-focus.js.

// WHY THE PAGE HAS TO BE IN SIGHT BEFORE IT GETS THE CLIPBOARD.
// Measured live on this machine: a page whose window sits behind another one reports itself hidden, and a paste into it arrives with nothing on it.
// The same paste into the same page landed as soon as its window was brought forward, so the page is asked whether it is visible and its window is brought forward when it is not.

// WHY THE FIND BAR IS READ BY ITS COUNTER.
// Measured live on a real Google Doc: the find bar counts its matches in one place, and it reads "1 of 1" when the marker is there and "0 of 0" when it is not.
// So the marker is known to be missing by the counter, and nothing is pasted into a document that does not hold its place.

import { focusWindow } from './window-focus.js';

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VISIBILITY_PROBE = `(() => ({
  visibility: String(document.visibilityState || ''),
  title: String(document.title || '')
}))()`;

const FIND_PROBE = `(() => {
  const counter = document.querySelector('.appsDocsUiWizFindbarFindInputCounter');
  const text = String(counter?.textContent || '').trim();
  const counts = /(\\d+)\\s*of\\s*(\\d+)/i.exec(text);
  return {
    counter: text,
    count: counts ? Number(counts[1]) : null,
    missing: counts ? Number(counts[1]) === 0 : false,
    noBar: !counter
  };
})()`;

/**
 * Asks the page whether it is in sight, and brings its window forward when it is not.
 * @param {object} page - the page session to ask and to bring forward.
 * @param {Function} [sleep] - the wait between bringing the window forward and asking again, replaced in tests.
 * @returns {Promise<{visible: boolean, focused: boolean, why: string}>} whether the page is visible, and why it is not when it is not.
 */

export async function ensureVisible(
  page,
  sleep = sleepDefault
) {
  const state = await page.evaluate(VISIBILITY_PROBE).catch(() => null);
  if (state?.visibility === 'visible') {
    return {
      visible: true,
      focused: false,
      why: ''
    };
  }
  const title = String(state?.title ?? '').trim();
  if (title === '') {
    return {
      visible: false,
      focused: false,
      why: 'the page has no title to bring its window forward with'
    };
  }
  const focus = await focusWindow(title);
  await sleep(700);
  const after = await page.evaluate(VISIBILITY_PROBE).catch(() => null);
  return {
    visible: after?.visibility === 'visible',
    focused: focus?.focused === true,
    why: focus?.why ?? ''
  };
}

/**
 * Finds a marker in the document and leaves it selected, so a command the page runs takes the marker's place.
 * @param {object} args - the find inputs.
 * @param {object} args.doc - the document session to search.
 * @param {string} args.marker - the text that stands where the command belongs.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @returns {Promise<object>} what the find bar counted, and whether the page was in sight.
 */

export async function selectMarker({
  doc,
  marker,
  sleep = sleepDefault
}) {
  await doc.front();
  const shown = await ensureVisible(
    doc,
    sleep
  );
  await doc.key('f', [
    'Control'
  ]);
  await sleep(500);
  await doc.cdp.send('Input.insertText', {
    text: marker
  });
  await sleep(800);
  await doc.key('Enter');
  await sleep(900);
  const found = await doc.evaluate(FIND_PROBE).catch(() => ({
    missing: false,
    noBar: true,
    counter: ''
  }));
  await doc.key('Escape');
  await sleep(400);
  return {
    ...found,
    visible: shown.visible,
    focusWhy: shown.why
  };
}
