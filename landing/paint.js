/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: paint - the page background: the Belisarius mosaic, drawn raster cell by cell, behind everything.
 * @state: one fixed canvas painted once, stretched past the fold and ridden upward on scroll; the pointer lifts the cells beneath it; a stillness-seeking reader gets the still scene.
 * @dependencies: beranda.css (.bgCanvas, .bgScrim, .hero).
 */

// WHY THE MOSAIC IS INLINED: the machine painted it, and the page must carry the same artefact the agent produced - a fetch that can fail turns the ad into a rectangle.
// WHY COLOUR: the mosaic is a portrait, and a portrait in grey is a smudge; the gold tiles are gold, the skin is ivory, the cloak is shadow.
// WHY RASTER THEN GLYPH: the source is thousand-year-old tesserae; drawing each cell as its tile and then its letter keeps the picture honest at any size - raster first, then the machine's hand on top.
// WHY ONE STATIC PASS AND A HAND: the artefact is finished; it never fidgets.
// The reader's pointer turns the light on it, the same way the general's face caught the lamp.

(function () {
  'use strict';

  var canvas = document.getElementById('mosaicBg');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COLS = 52;
  var ROWS = 64;
  var BLOB = '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';

  var bytes = Uint8Array.from(atob(BLOB), function (c) { return c.charCodeAt(0); });
  var cellW = 1;
  var cellH = 1;
  var dpr = 1;

  function cellAt(index) {
    var o = index * 4;
    return { ch: String.fromCharCode(bytes[o]), r: bytes[o + 1], g: bytes[o + 2], b: bytes[o + 3] };
  }

  function layout() {
    var vw = canvas.clientWidth;
    var vh = canvas.clientHeight;
    if (!vw || !vh) { window.setTimeout(layout, 100); return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellW = vw / COLS;
    cellH = vh / ROWS;
  }

  function drawCell(col, row, boost) {
    var i = row * COLS + col;
    var c = cellAt(i);
    var x = col * cellW;
    var y = row * cellH;
    ctx.fillStyle = '#08081a';
    ctx.fillRect(x, y, cellW + 1, cellH + 1);
    var lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    var lift = boost || 0;
    if (lum > 0.92 && !lift) return;
    var ramp = ' .:-=+*#%@';
    var idx = Math.round((1 - lum) * (ramp.length - 1));
    var ch = ramp.charAt(idx);
    var alpha = Math.min(0.98, (0.32 + Math.pow(1 - lum, 1.1) * 0.6) + lift * 0.5);
    var t = Math.round(235 + 20 * (1 - lum));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgb(' + Math.round(c.r * 0.35 + t * 0.65) + ',' + Math.round(c.g * 0.35 + t * 0.65) + ',' + Math.round(c.b * 0.35 + t * 0.65) + ')';
    ctx.font = (cellH * 0.94).toFixed(1) + 'px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, (row + 0.5) * cellH);
  }

  function paintAll() {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, window.innerWidth, canvas.height);
    var vw = canvas.width;
    var vh = canvas.height;
    var scale = Math.min(vw / COLS, vh / ROWS);
    var tw = COLS * scale;
    var th = ROWS * scale;
    var ox = (vw - tw) / 2;
    var oy = (vh - th) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    var ramp = ' .:-=+*#%@';
    for (var y = 0; y < ROWS; y += 1) {
      for (var x = 0; x < COLS; x += 1) {
        var i = y * COLS + x;
        var c = cellAt(i);
        if (c.ch === '.') continue;
        var lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        var idx = Math.round((1 - lum) * (ramp.length - 1));
        var alpha = Math.min(0.98, 0.32 + Math.pow(1 - lum, 1.1) * 0.6);
        var t = Math.round(235 + 20 * (1 - lum));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgb(' + Math.round(c.r * 0.35 + t * 0.65) + ',' + Math.round(c.g * 0.35 + t * 0.65) + ',' + Math.round(c.b * 0.35 + t * 0.65) + ')';
        ctx.font = '1.05px monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(ramp.charAt(idx), x + 0.5, y + 0.55);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  layout();
  paintAll();

  window.addEventListener('resize', function () {
    layout();
    paintAll();
  }, { passive: true });

  if (reduced) return;

  var lifted = new Map();
  var pending = null;

  function liftDisc(cx, cy) {
    var radius = 4;
    var next = new Map();
    var y0 = Math.max(0, Math.floor(cy - radius));
    var y1 = Math.min(ROWS - 1, Math.ceil(cy + radius));
    var x0 = Math.max(0, Math.floor(cx - radius));
    var x1 = Math.min(COLS - 1, Math.ceil(cx + radius));
    for (var row = y0; row <= y1; row += 1) {
      for (var col = x0; col <= x1; col += 1) {
        var dx = col + 0.5 - cx;
        var dy = row + 0.5 - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        var lift = 0.5 * (1 - Math.sqrt(d2) / radius);
        drawCell(col, row, lift);
        next.set(row * COLS + col, lift);
      }
    }
    for (var pair of lifted) {
      if (!next.has(pair[0])) drawCell(pair[0] % COLS, Math.floor(pair[0] / COLS), 0);
    }
    lifted = next;
  }

  function onPointerMove(event) {
    pending = {
      x: event.clientX / cellW,
      y: (event.clientY - canvas.getBoundingClientRect().top) / cellH,
    };
    if (!canvas._liftQueued) {
      canvas._liftQueued = true;
      requestAnimationFrame(function () {
        canvas._liftQueued = false;
        if (pending) liftDisc(pending.x, pending.y);
        pending = null;
      });
    }
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', function () {
    for (var pair of lifted) drawCell(pair[0] % COLS, Math.floor(pair[0] / COLS), 0);
    lifted = new Map();
  }, { passive: true });
})();
