// @last-edited: 2026-11-04 UTC+7.
// @title: docs — the guide answers a search without scrolling.
// @state: one listener on the search box; it hides the sections that do not match and keeps the section list in step.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: the guide is the page that gets searched, and a script inline in the page would need a hash on two hosts for one behaviour.
// It hides blocks and writes no markup, so a search cannot break the page it filters.

const input = document.querySelector('#docSearch');

if (input) {
  const blocks = [...document.querySelectorAll('.docBody section')];
  const doors = [...document.querySelectorAll('.docNav .toc a')];

  const apply = () => {
    const query = input.value.trim().toLowerCase();
    for (const block of blocks) {
      const match = query === '' || block.textContent.toLowerCase().includes(query);
      block.hidden = !match;
    }
    for (const door of doors) {
      const block = blocks.find((item) => item.querySelector('h2')?.id === door.getAttribute('href').slice(1));
      door.parentElement.hidden = block?.hidden ?? false;
    }
  };

  input.addEventListener('input', apply);
  input.addEventListener('search', apply);
}
