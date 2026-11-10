// @last-edited: 2026-11-10 UTC+7.
// @title: demo-kit - one engine behind every harness's install demo on the MCP install page.
// @state: one runtime per .mcpDemo, started when it scrolls into view and restarted on resize; it owns the cursor, the taskbar dock and each step's timing, nothing else.
// @dependencies: none.

// WHY ONE ENGINE FOR NINE DEMOS: every harness follows the same rhythm - the taskbar icon is pressed, the window opens, the server is added, the harness says "connected".
// Only the window in between differs.
// WHY THE CURSOR IS COMPUTED, NOT TYPED: the stage is 1024 wide at any viewport and the window scales inside it, so every click point is measured fresh, the same way the download demo measures its buttons.

(() => {
  'use strict';

  const TYPE_PACE = 26;
  const HOT = { x: 4.6, y: 2.8 };
  const TOAST = 'opera-agent · 35 tools';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  class Restart extends Error {}

  const trim = (text) => String(text).replace(/\s+/g, ' ').trim();

  const wire = (demo) => {
    const agent = demo.getAttribute('data-agent');
    const canvas = demo.querySelector('.ddCanvas');
    const cursor = demo.querySelector('.demoCursor');
    const ripple = demo.querySelector('.ddRipple');
    const lines = [...demo.querySelectorAll('.ddLine')];
    let generation = 0;
    let visible = false;
    let scale = 1;
    let pos = { x: 820, y: 470 };

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
      const rect = canvas.getBoundingClientRect();
      scale = rect.width / 1024;
      canvas.style.setProperty('--dd-k', String(scale));
    };

    const measure = (el) => {
      const box = canvas.getBoundingClientRect();
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

    const glide = async (el, token) => {
      guard(token);
      const to = measure(el);
      const distance = Math.hypot(to.x - pos.x, to.y - pos.y);
      if (distance < 1) return;
      const duration = Math.min(640, Math.max(230, distance * 0.6));
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
      ], { duration: 470, easing: 'cubic-bezier(.2,.7,.3,1)' });
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

    const typeLine = async (el, token, pace) => {
      el.classList.add('is-on');
      const text = el.dataset.raw || trim(el.textContent);
      const target = el.querySelector('.ddLineText') ?? el;
      if (target !== el) target.textContent = '';
      else el.textContent = '';
      for (const char of text) {
        target.textContent += char;
        await wait(pace, token);
      }
    };

    const reveal = (el, token) => {
      if (!el) return;
      el.classList.add('is-on');
    };

    const replaceStatus = (text) => {
      const el = demo.querySelector('.ddStatusRight');
      if (el) el.textContent = text;
    };

    const reset = (token) => {
      demo.classList.remove('is-open', 'is-modal', 'is-row', 'is-done');
      for (const line of lines) {
        line.classList.remove('is-on');
        if (line.dataset.raw) {
          const target = line.querySelector('.ddLineText');
          if (target) target.textContent = '';
        }
      }
      const toggle = demo.querySelector('.ddRowToggle');
      if (toggle) toggle.classList.remove('on');
      replaceStatus('');
      pos = { x: 820, y: 470 };
      paint();
    };

    const play = async (token) => {
      guard(token);
      reset(token);

      await press(demo.querySelector('.ddTbAgent'), token);
      demo.classList.add('is-open');
      await wait(620, token);

      const url = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';

      switch (agent) {
        case 'chatgpt':
        case 'claude': {
          await press(demo.querySelector('.ddBtnCreate'), token);
          demo.classList.add('is-modal');
          await wait(430, token);
          const field = demo.querySelector('.ddModalFieldText');
          field.textContent = '';
          field.classList.add('is-on');
          for (const char of url) {
            field.textContent += char;
            await wait(TYPE_PACE, token);
          }
          await wait(240, token);
          await press(demo.querySelector('.ddModalConfirm'), token);
          demo.classList.remove('is-modal');
          await wait(430, token);
          demo.classList.add('is-row');
          await wait(380, token);
          const rowToggle = demo.querySelector('.ddRowToggle');
          await press(rowToggle, token);
          rowToggle.classList.add('on');
          break;
        }
        case 'codex': {
          const cat = lines[0];
          const block = lines[1];
          const codex = lines[2];
          const slash = lines[3];
          const done = lines[4];
          await typeLine(cat, token, TYPE_PACE);
          await wait(320, token);
          reveal(block, token);
          await wait(340, token);
          await typeLine(codex, token, TYPE_PACE + 4);
          await wait(260, token);
          await typeLine(slash, token, TYPE_PACE + 20);
          await wait(300, token);
          reveal(done, token);
          break;
        }
        case 'claude-code': {
          const command = lines[0];
          const added = lines[1];
          const claude = lines[2];
          const ready = lines[3];
          await typeLine(command, token, TYPE_PACE);
          await wait(340, token);
          reveal(added, token);
          await wait(260, token);
          await typeLine(claude, token, TYPE_PACE + 4);
          reveal(ready, token);
          break;
        }
        case 'terminal': {
          const npm = lines[0];
          const added = lines[1];
          const doctor = lines[2];
          const verdict = lines[3];
          await typeLine(npm, token, TYPE_PACE);
          await wait(360, token);
          reveal(added, token);
          await wait(300, token);
          await typeLine(doctor, token, TYPE_PACE);
          await wait(340, token);
          reveal(verdict, token);
          break;
        }
        case 'opencode':
        case 'vscode':
        case 'kilo':
        case 'cursor': {
          await press(demo.querySelector('.ddFileTab'), token);
          await wait(420, token);
          replaceStatus(TOAST);
          break;
        }
      }

      await wait(420, token);
      demo.classList.add('is-done');
      await wait(1800, token);
    };

    const loop = async () => {
      const token = ++generation;
      try {
        for (;;) {
          await play(token);
          if (token !== generation) return;
          await wait(1500, token);
        }
      } catch (error) {
        if (!(error instanceof Restart)) throw error;
      }
    };

    const restart = () => {
      generation++;
      cursor.getAnimations().forEach((animation) => animation.cancel());
      window.setTimeout(() => {
        void loop();
      }, 200);
    };

    const observer = new IntersectionObserver(([entry]) => {
      const next = entry.isIntersecting;
      if (next === visible) return;
      visible = next;
      if (visible) {
        fit();
        void loop();
      } else {
        generation++;
        cursor.getAnimations().forEach((animation) => animation.cancel());
      }
    }, { threshold: 0.2 });
    observer.observe(demo);

    let resize;
    window.addEventListener('resize', () => {
      window.clearTimeout(resize);
      resize = window.setTimeout(restart, 240);
    });

    fit();
  };

  const wireAll = () => {
    for (const demo of document.querySelectorAll('.mcpDemo[data-agent]')) wire(demo);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireAll);
  else wireAll();
})();
