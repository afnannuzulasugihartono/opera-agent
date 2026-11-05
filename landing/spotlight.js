// @last-edited: 2026-11-04 UTC+7.
// @title: spotlight — the bento grid and the price cards answer the pointer, and nothing else.
// @state: one listener per card; it writes two numbers and touches no markup.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: three pages carry the same light, and a card that paints a light under the cursor is one behaviour, not three copies of it.
// It writes two custom properties and moves no node, so the browser never lays the page out again.
// It runs once, after the document is parsed, so a card that arrives later is still found.

for (const card of document.querySelectorAll('.bentoArticle, .priceCard')) {
  card.addEventListener('pointermove', (event) => {
    const box = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
    card.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
  });
}
