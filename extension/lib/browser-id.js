// @last-edited: 2026-11-11 UTC+7.
// @title: browser-id - which browser this really is, and the name a new device should carry.
// @state: the browser family from the strongest signal the browser publishes, and the device name that family implies.
// @dependencies: none.

// WHY THE USER AGENT STRING ALONE IS NOT ENOUGH.
// Brave, Edge, Opera and Vivaldi all send a Chrome user agent, so a browser that reads only the string calls every one of them Chrome, and the dashboard then shows five devices under the same name for browsers that are not the same.
// The signals that do not lie are the ones the browser publishes itself: navigator.brave, the brand list in userAgentData, and the vendor.
// The string is the last resort, not the first.

// WHY THE NAME FOLLOWS THE BROWSER.
// A device name is how a person tells two browsers apart in a list, and "opera-4" says nothing about which browser it is.
// So a new device takes the family name in lower case, and the server adds the number when a second device of the same family appears.

const readBrands = () => {
  try {
    return (globalThis.navigator?.userAgentData?.brands ?? []).map((brand) => String(brand?.brand ?? ''));
  } catch {
    return [];
  }
};

const readBrave = () => {
  try {
    return globalThis.navigator?.brave?.isBrave?.() === true;
  } catch {
    return false;
  }
};

const byBrand = (brands) => {
  const named = brands.find((brand) => /brave|edge|opera|vivaldi|chromium|chrome/i.test(brand));
  if (!named) return null;
  if (/brave/i.test(named)) return 'Brave';
  if (/edge/i.test(named)) return 'Edge';
  if (/opera/i.test(named)) return 'Opera';
  if (/vivaldi/i.test(named)) return 'Vivaldi';
  if (/chromium/i.test(named)) return 'Chromium';
  return 'Chrome';
};

export const browserFamily = (signals = {}) => {
  const ua = String(signals.ua ?? globalThis.navigator?.userAgent ?? '');
  const brands = (signals.brands ?? readBrands()).map((brand) => String(brand?.brand ?? brand ?? ''));
  const brave = signals.brave ?? readBrave();
  if (brave) return 'Brave';
  const branded = byBrand(brands);
  if (branded) return branded;
  if (/Brave/i.test(ua)) return 'Brave';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Chrome/i.test(ua)) return 'Chrome';
  return 'Unknown';
};

export const deviceNameFor = (family) => {
  const name = String(family ?? '').trim().toLowerCase();
  if (name === 'unknown') return 'browser';
  return /^[a-z][a-z0-9]{0,15}$/.test(name) ? name : 'browser';
};
