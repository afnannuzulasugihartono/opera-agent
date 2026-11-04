// @last-edited: 2026-11-05 UTC+7.
// @title: wayfind — the reader always knows where they are.
// @state: one scroll listener; it grows a line under the header and marks the section in view.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: every public page carries the same header and the same maps, and fourteen copies of one scroll listener drift apart within a week.
// WHY THE LINE IS DRAWN IN SCRIPT: the bar is a reading aid, not content, so a reader without scripts loses a line and nothing else.
// WHY requestAnimationFrame: a scroll event fires faster than the screen can paint, and a listener that writes on every event makes scrolling feel heavy.
// WHY THE MARK FOLLOWS THE LAST SECTION ABOVE THE READER: a reader who scrolls knows the section they are in, and the map must agree with the page.

const header = document.querySelector('header');
const bar = document.createElement('div');
bar.className = 'readProgress';
bar.setAttribute('aria-hidden', 'true');
header?.append(bar);

const doors = [...document.querySelectorAll('.toc a[href^="#"]')];
const sections = doors
  .map((door) => document.getElementById(door.getAttribute('href').slice(1)))
  .filter(Boolean);

let queued = false;

const paint = () => {
  queued = false;
  const height = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;
  bar.style.transform = `scaleX(${ratio})`;

  if (!sections.length) return;
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= 140) active = section;
    else break;
  }
  for (const door of doors) {
    if (door.getAttribute('href') === `#${active.id}`) door.setAttribute('aria-current', 'true');
    else door.removeAttribute('aria-current');
  }
};

const schedule = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(paint);
};

window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule, { passive: true });
paint();
