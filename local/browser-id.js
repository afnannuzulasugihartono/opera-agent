// @last-edited: 2026-11-01 UTC+7.
// @title: browser-id — which browser this page is running in, asked of the page itself.
// @state: the user agent expression, and the name and version that user agent carries.
// @dependencies: none.

// WHY THE PAGE IS ASKED.
// The extension may be talking to any browser on any machine, and every window the operating system holds belongs to one of them.
// The page knows which browser it runs in, so the driver asks the page rather than guessing from the machine or from the tab list.

// WHY THE ORDER MATTERS.
// A Brave user agent carries Chrome as well, and an Edge one carries Chrome too, so the browser that names itself is looked for before the engine it rides on.

// WHY THE NAME IS THE ONE THE MACHINE USES.
// The window answer names the browser in front as the machine knows it - "Google Chrome", "Microsoft Edge" - so the browser driving the tab is named the same way, or the two answers cannot be compared.

export const BROWSER_EXPRESSION = 'navigator.userAgent';

const KNOWN = [
  {
    name: 'Brave',
    tag: 'Brave/'
  },
  {
    name: 'Microsoft Edge',
    tag: 'Edg/'
  },
  {
    name: 'Opera',
    tag: 'OPR/'
  },
  {
    name: 'Vivaldi',
    tag: 'Vivaldi/'
  },
  {
    name: 'Google Chrome',
    tag: 'Chrome/'
  },
  {
    name: 'Chromium',
    tag: 'Chromium/'
  }
];

/**
 * Name the browser a user agent belongs to.
 * @param {string} userAgent - the user agent the page reported about itself.
 * @returns {object} the browser name and version, or unknown when it names none.
 */

export const browserId = (userAgent) => {
  const agent = String(userAgent ?? '');
  for (const known of KNOWN) {
    const at = agent.indexOf(known.tag);
    if (at < 0) continue;
    return {
      name: known.name,
      version: agent.slice(at + known.tag.length).split(' ')[0]
    };
  }
  return {
    name: 'unknown',
    version: ''
  };
};
