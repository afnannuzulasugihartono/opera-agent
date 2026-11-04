// @last-edited: 2026-11-04 UTC+7.
// @title: docs — the guide answers a search without scrolling, and the slash key opens the box.
// @state: one listener on the search box; it hides the sections that do not match and keeps the section list in step.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: the guide is the page that gets searched, and a script inline in the page would need a hash on two hosts for one behaviour.
// It hides blocks and writes no markup, so a search cannot break the page it filters.
// WHY THE SLASH KEY OPENS THE BOX: a reader who wants one section should not hunt for the field, and the box already shows the key that opens it.
// The key stays out of the way while the reader types, so the field can hold a slash without the page stealing it.

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

  const openFromKey = (event) => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      event.preventDefault();
      input.focus();
    }
  };

  input.addEventListener('input', apply);
  input.addEventListener('search', apply);
  document.addEventListener('keydown', openFromKey);
}
