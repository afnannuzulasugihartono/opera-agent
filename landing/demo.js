// @last-edited: 2026-11-10 UTC+7.
// @title: demo - one clock drives the Windows session, and every click lands on the control it names.
// @state: starts when the demo is a quarter in view, restarts on resize, stops off screen; it owns the window classes, the cursor and the typing, nothing else.
// @dependencies: none.

// WHY THE WINDOWS PERSIST: a scene swap makes Chrome vanish and reappear, which reads as a cut; one Chrome window whose pages change reads as a browser being used.
// WHY THE CURSOR IS MEASURED, NOT TYPED AS A PERCENTAGE: a percentage resolves against the element's offset parent, and the stage is centered inside a full-bleed desktop at some window widths but not others, so a baked percentage misses by the letterbox margin at every size but one.
// WHY ONE PROMISE CHAIN: a click, the window it opens and the typing that follows are awaited in order, so a later beat cannot paint before the beat before it is finished.
// WHY THE SESSION STARTS IN VIEW: a demo that has already finished by the time the reader scrolls to it teaches nothing.

(() => {
  'use strict';

  const demo = document.querySelector('.demo');
  if (!demo) return;

  const stage = demo.querySelector('.demoStage');
  const desktop = demo.querySelector('.desktop');
  const canvas = demo.querySelector('.demoCanvas');
  const cursor = demo.querySelector('.demoCursor');
  const ripple = demo.querySelector('.demoRipple');
  const picker = demo.querySelector('.folderPick');
  const popup = demo.querySelector('.oaPopup');
  const chrome = demo.querySelector('[data-app="chrome"]');
  const explorer = demo.querySelector('[data-app="explorer"]');
  const terminal = demo.querySelector('[data-app="terminal"]');
  const pages = [...demo.querySelectorAll('.chromePage')];
  const docks = {
    chrome: demo.querySelector('.tChrome'),
    explorer: demo.querySelector('.tFolder'),
    terminal: demo.querySelector('.tTerm')
  };
  const apps = { chrome, explorer, terminal };

  const HOT = { x: 4.6, y: 2.8 };
  const DELAY = [58, 74, 49, 66, 53, 81, 61, 47];

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!stage || !cursor || !ripple || !chrome || !explorer || !terminal || !picker || !popup) return;

  const query = (selector) => demo.querySelector(selector);
  let generation = 0;
  let visible = false;
  let scale = 1;
  let pos = { x: 0, y: 0 };

  class Restart extends Error {}

  const guard = (token) => {
    if (token !== generation) throw new Restart();
  };

  const wait = (ms, token) => new Promise((resolve, reject) => {
    setTimeout(() => {
      if (token !== generation) reject(new Restart());
      else resolve();
    }, ms);
  });

  const fit = () => {
    scale = Math.max(0.2, desktop.getBoundingClientRect().width / 1024);
    canvas.style.setProperty('--demo-k', String(scale));
  };

  const measure = (el) => {
    const box = stage.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2 - box.left) / scale,
      y: (rect.top + rect.height / 2 - box.top) / scale
    };
  };

  const paint = () => {
    cursor.style.transform = `translate3d(${pos.x - HOT.x}px, ${pos.y - HOT.y}px, 0)`;
  };

  const tween = (el, frames, options) => new Promise((resolve, reject) => {
    const animation = el.animate(frames, options);
    animation.finished.then(() => resolve(animation)).catch(() => reject(new Restart()));
  });

  const glide = async (el, token, pace = 1) => {
    guard(token);
    const to = measure(el);
    const distance = Math.hypot(to.x - pos.x, to.y - pos.y);
    if (distance < 1) return;
    const duration = Math.min(720, Math.max(230, distance * 0.62)) * pace;
    const animation = await tween(cursor, [
      { transform: `translate3d(${pos.x - HOT.x}px, ${pos.y - HOT.y}px, 0)` },
      { transform: `translate3d(${to.x - HOT.x}px, ${to.y - HOT.y}px, 0)` }
    ], { duration, easing: 'cubic-bezier(.28,.72,.24,1)' });
    guard(token);
    pos = to;
    paint();
    animation.cancel();
  };

  const burst = (point) => {
    ripple.style.left = point.x + 'px';
    ripple.style.top = point.y + 'px';
    ripple.animate([
      { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) scale(1.55)', opacity: 0 }
    ], { duration: 480, easing: 'cubic-bezier(.2,.7,.3,1)' });
  };

  const press = async (el, token) => {
    await glide(el, token);
    await wait(90, token);
    burst(measure(el));
    el.classList.add('is-pressed');
    cursor.classList.add('is-pressed');
    await wait(115, token);
    el.classList.remove('is-pressed');
    cursor.classList.remove('is-pressed');
    await wait(190, token);
  };

  const type = async (el, text, token, pace) => {
    el.textContent = '';
    let index = 0;
    for (const char of text) {
      el.textContent += char;
      await wait(pace * DELAY[index++ % DELAY.length] / 60, token);
    }
  };

  const focusApp = (name) => {
    for (const [key, app] of Object.entries(apps)) app.classList.toggle('is-front', key === name);
    for (const [key, dock] of Object.entries(docks)) dock.classList.toggle('is-active', key === name);
  };

  const closeOpen = async (keep, token) => {
    for (const [key, app] of Object.entries(apps)) {
      if (key === keep || !app.classList.contains('is-open')) continue;
      app.classList.remove('is-front');
      app.classList.add('is-closing');
      await wait(150, token);
      app.classList.remove('is-open', 'is-closing');
    }
  };

  const openApp = async (name, token) => {
    const app = apps[name];
    if (app.classList.contains('is-open')) {
      focusApp(name);
      await wait(220, token);
      return;
    }
    await closeOpen(name, token);
    if (name !== 'chrome') popup.classList.remove('is-open');
    const dock = docks[name].getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    app.style.transformOrigin = `${(dock.left + dock.width / 2 - box.left) / scale}px 100%`;
    app.classList.add('is-open');
    docks[name].classList.add('is-running');
    stage.classList.add('hasWindow');
    focusApp(name);
    await wait(520, token);
  };

  const goTo = async (selector, title, token) => {
    chrome.classList.add('is-loading');
    await wait(420, token);
    pages.forEach((page) => page.classList.toggle('is-shown', page.matches(selector)));
    query('.chromeTabTitle').textContent = title;
    chrome.classList.remove('is-loading');
    await wait(360, token);
  };

  const addressTo = async (url, token) => {
    const bar = query('.chromeOmnibox');
    const field = bar.querySelector('.typeUrl');
    await press(bar, token);
    field.classList.add('is-selected');
    await wait(190, token);
    field.textContent = '';
    field.classList.remove('is-selected');
    chrome.classList.add('is-focused');
    await type(field, url, token, 42);
    await wait(450, token);
    chrome.classList.remove('is-focused');
    chrome.classList.add('is-enter');
    await wait(130, token);
    chrome.classList.remove('is-enter');
  };

  const openPopup = async (token) => {
    const trigger = query('.extTrigger');
    const box = stage.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    popup.classList.add('is-open');
    const width = popup.offsetWidth;
    const center = (rect.left + rect.width / 2 - box.left) / scale;
    const bottom = (rect.bottom - box.top) / scale;
    const left = Math.min(1024 - width - 12, Math.max(12, center - width + 18));
    popup.style.left = `${left}px`;
    popup.style.top = `${bottom + 10}px`;
    await wait(540, token);
  };

  const reset = () => {
    fit();
    for (const app of Object.values(apps)) {
      app.classList.remove('is-open', 'is-front', 'is-closing', 'is-loading', 'is-focused', 'is-enter', 'is-extracting', 'is-extracted', 'is-out1', 'is-out2', 'is-verified');
    }
    for (const dock of Object.values(docks)) dock.classList.remove('is-active', 'is-running');
    pages.forEach((page) => {
      page.classList.remove('is-shown', 'is-downloading', 'is-done', 'is-dev', 'is-installed', 'is-created', 'is-copied');
    });
    query('.pageDl').classList.add('is-shown');
    query('.pageExt .extTopRight .chromeToggle').classList.remove('on');
    const bar = query('.chromeOmnibox');
    bar.querySelector('.typeUrl').textContent = 'opera-agent.pages.dev/unduh-berkas';
    bar.classList.remove('is-focused', 'is-enter');
    query('.chromeTabTitle').textContent = 'unduh-berkas - Opera Agent';
    picker.classList.remove('is-open');
    popup.classList.remove('is-open', 'is-pasted', 'is-connected');
    popup.querySelector('.oaFieldEmpty').classList.remove('is-focused');
    stage.classList.remove('is-modal', 'hasWindow');
    demo.querySelectorAll('.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
    demo.querySelectorAll('.termLine').forEach((line) => line.classList.remove('is-typing', 'is-done'));
    demo.querySelectorAll('.termCmd').forEach((command) => { command.textContent = ''; });
    pos = { x: 940, y: 236 };
    paint();
  };

  const terminalCommand = async (selector, token) => {
    const line = query(selector);
    const command = line.querySelector('.termCmd');
    line.classList.add('is-typing');
    await glide(line.querySelector('.psPrompt'), token);
    await type(command, command.dataset.cmd, token, 20);
    await wait(280, token);
    line.classList.remove('is-typing');
    line.classList.add('is-done');
  };

  const play = async (token) => {
    reset();
    await wait(1400, token);

    await press(docks.chrome, token);
    await openApp('chrome', token);
    await wait(360, token);
    const pageDl = query('.pageDl');
    await press(pageDl.querySelector('.dlBigBtn'), token);
    pageDl.classList.add('is-downloading');
    await wait(1450, token);
    pageDl.classList.add('is-done');
    await wait(650, token);

    await press(docks.explorer, token);
    await openApp('explorer', token);
    await wait(320, token);
    await press(query('.extractAll'), token);
    explorer.classList.add('is-extracting');
    await wait(620, token);
    await press(query('.extractGo'), token);
    explorer.classList.remove('is-extracting');
    await wait(320, token);
    explorer.classList.add('is-extracted');
    await wait(700, token);

    await press(docks.chrome, token);
    await openApp('chrome', token);
    await wait(300, token);
    await addressTo(query('.chromeOmnibox').dataset.extUrl, token);
    await goTo('.pageExt', 'Extensions', token);
    await wait(480, token);
    const pageExt = query('.pageExt');
    await press(pageExt.querySelector('.chromeToggle'), token);
    pageExt.querySelector('.extTopRight .chromeToggle').classList.add('on');
    pageExt.classList.add('is-dev');
    await wait(500, token);
    await press(pageExt.querySelector('.chromePillBtn.blue'), token);
    stage.classList.add('is-modal');
    picker.classList.add('is-open');
    await wait(750, token);
    await press(picker.querySelector('.pickGo'), token);
    picker.classList.remove('is-open');
    stage.classList.remove('is-modal');
    await wait(360, token);
    pageExt.classList.add('is-installed');
    await wait(820, token);

    await addressTo(query('.chromeOmnibox').dataset.dashUrl, token);
    await goTo('.pageDash', 'Manual pairing - Opera Agent', token);
    await wait(480, token);
    const pageDash = query('.pageDash');
    await press(pageDash.querySelector('.pairCreateBtn'), token);
    pageDash.classList.add('is-created');
    await wait(620, token);
    await press(pageDash.querySelector('.pairCopyBtn'), token);
    pageDash.classList.add('is-copied');
    await wait(580, token);
    await press(query('.extTrigger'), token);
    await openPopup(token);
    await press(popup.querySelector('.oaFieldEmpty'), token);
    popup.querySelector('.oaFieldEmpty').classList.add('is-focused');
    popup.classList.add('is-pasted');
    await wait(320, token);
    popup.classList.add('is-connected');
    await wait(820, token);

    await press(docks.terminal, token);
    await openApp('terminal', token);
    await wait(480, token);
    await terminalCommand('.t1', token);
    terminal.classList.add('is-out1');
    await wait(760, token);
    await terminalCommand('.t3', token);
    terminal.classList.add('is-out2');
    await wait(760, token);
    terminal.classList.add('is-verified');
    await wait(1800, token);
  };

  const loop = async () => {
    const token = ++generation;
    try {
      await play(token);
      while (token === generation) {
        await wait(1500, token);
        await play(token);
      }
    } catch (error) {
      if (!(error instanceof Restart)) throw error;
    }
  };

  const restart = () => {
    fit();
    if (!visible) return;
    generation++;
    cursor.getAnimations().forEach((animation) => animation.cancel());
    window.setTimeout(() => {
      if (visible) loop();
    }, 220);
  };

  const observer = new IntersectionObserver(([entry]) => {
    const next = entry.isIntersecting;
    if (next === visible) return;
    visible = next;
    if (visible) loop();
    else {
      generation++;
      cursor.getAnimations().forEach((animation) => animation.cancel());
    }
  }, { threshold: 0.25 });
  observer.observe(demo);
  fit();

  let resize;
  window.addEventListener('resize', () => {
    window.clearTimeout(resize);
    resize = window.setTimeout(restart, 260);
  });
})();
