// @last-edited: 2026-11-10 UTC+7.
// @title: harness-tabs - 3 category tabs (Web / Desktop / CLI) driving horizontally swipeable cards.
// @state: per-panel track position remembered in memory only; active dot mirrors the centered card; nothing persists.
// @dependencies: none.

// WHY ONE PANEL PER TAB SHOWN AT A TIME: a single track keeps one source of truth for “which card is centered” per category, so the dots and the live demo never disagree.
// WHY scroll-snap + scroll events instead of a JS drag engine: native momentum, keyboard focus, reduced-motion compliance and RTL layout all come for free; the JS only mirrors what the browser already knows.

(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('.harnessTab')];
  if (!tabs.length) return;

  const panels = new Map();
  for (const tab of tabs) {
    const id = tab.getAttribute('aria-controls');
    const panel = document.getElementById(id);
    if (!panel) continue;
    const track = panel.querySelector('.harnessTrack');
    const cards = [...track.querySelectorAll('.harnessCard')];
    const dots = [...panel.querySelectorAll('.harnessDot')];
    panels.set(tab, { tab, panel, track, cards, dots });
  }
  if (!panels.size) return;

  const setActive = (entry, cardIdx, scroll = true) => {
    const { track, cards, dots, panel } = entry;
    const idx = ((cardIdx % cards.length) + cards.length) % cards.length;
    cards.forEach((card, i) => card.setAttribute('aria-hidden', i === idx ? 'false' : 'true'));
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === idx);
      dot.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (scroll) {
      const card = cards[idx];
      track.scrollLeft = card.offsetLeft - (track.clientWidth - card.clientWidth) / 2;
    }
    return idx;
  };

  const measureCentredCard = (track) => {
    const trackCenter = track.scrollLeft + track.clientWidth / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    const cards = [...track.querySelectorAll('.harnessCard')];
    cards.forEach((card, i) => {
      const center = card.offsetLeft + card.clientWidth / 2;
      const dist = Math.abs(center - trackCenter);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    return bestIdx;
  };

  const rafScroll = (track) => {
    let ticking = false;
    return () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const idx = measureCentredCard(track);
        const activeEntry = [...panels.values()].find((entry) => entry.track === track);
        if (activeEntry) setActive(activeEntry, idx, false);
      });
    };
  };

  for (const entry of panels.values()) {
    const { track, panel } = entry;
    track.addEventListener('scroll', rafScroll(track), { passive: true });

    panel.querySelectorAll('.harnessDot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const idx = Number(dot.getAttribute('data-dot'));
        setActive(entry, idx, true);
      });
    });

    entry.tab.addEventListener('click', () => {
      for (const other of panels.values()) {
        const isThis = other === entry;
        other.panel.hidden = !isThis;
        other.tab.classList.toggle('is-active', isThis);
        other.tab.setAttribute('aria-selected', isThis ? 'true' : 'false');
      }
      // keep the centred card in place when switching tabs
      const idx = measureCentredCard(track);
      setActive(entry, idx, true);
    });

    // Arrow keys on focused track move between cards
    track.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const idx = measureCentredCard(track);
      const next = idx + (event.key === 'ArrowRight' ? 1 : -1);
      event.preventDefault();
      setActive(entry, next, true);
    });
  }

  // Hash navigation: #chatgpt etc → activate correct tab + centred card
  const decode = (h) => decodeURIComponent((h || '').replace(/^#/, ''));
  const activateFromHash = (hash) => {
    const id = decode(hash);
    if (!id) return;
    for (const entry of panels.values()) {
      const idx = entry.cards.findIndex((card) => card.id === id);
      if (idx < 0) continue;
      // activate tab
      for (const other of panels.values()) {
        const isThis = other === entry;
        other.panel.hidden = !isThis;
        other.tab.classList.toggle('is-active', isThis);
        other.tab.setAttribute('aria-selected', isThis ? 'true' : 'false');
      }
      setActive(entry, idx, false);
      entry.track.scrollLeft = entry.cards[idx].offsetLeft - (entry.track.clientWidth - entry.cards[idx].clientWidth) / 2;
      return;
    }
  };
  activateFromHash(window.location.hash);
  window.addEventListener('hashchange', () => activateFromHash(window.location.hash));
})();
