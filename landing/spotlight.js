// @last-edited: 2026-11-04 UTC+7.
// @title: spotlight — the bento grid answers the pointer, and nothing else.
// @state: one listener per card; it writes two numbers and touches no markup.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: two pages carry the same grid, and a card that paints a light under the cursor is one behaviour, not two copies of it.
// It writes two custom properties and moves no node, so the browser never lays the page out again.
// It runs once, after the document is parsed, so a card that arrives later is still found.

for (const card of document.querySelectorAll('.bentoArticle')) {
  card.addEventListener('pointermove', (event) => {
    const box = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
    card.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
  });
}
