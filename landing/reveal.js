// @last-edited: 2026-11-04 UTC+7.
// @title: reveal — the blocks of a page arrive as the reader reaches them.
// @state: one observer per page; it adds one attribute value and hides nothing when the reader refuses motion.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: every public page has blocks that arrive, and ten copies of one observer drift apart within a week.
// WHY THE js CLASS GOES FIRST: only a page that announced itself may hide a block, so a reader without JavaScript sees the whole page.
// WHY THE FENCE: motion must never gate content, so a failure here leaves the page exactly as it was found.
// WHY REDUCED MOTION GETS EVERY BLOCK: the observer is skipped, so the blocks are marked as arrived before anything paints.
// WHY THE PAGE IS READ WHOLE: a script that runs while the parser is still below the content would watch an empty page and leave the rest of it hidden forever.

try {
  document.documentElement.classList.add('js');

  const start = () => {
    const blocks = document.querySelectorAll('[data-reveal]');
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce || !('IntersectionObserver' in globalThis)) {
      for (const block of blocks) block.classList.add('in');
      return;
    }

    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    }, { threshold: 0.12 });

    for (const block of blocks) seen.observe(block);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
} catch (error) {
}
