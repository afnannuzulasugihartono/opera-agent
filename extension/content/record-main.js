/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: record-main - the recording pipeline as a MAIN-world program: canvas, captureStream, MediaRecorder webm, in the page's own realm.
 * @state: builds globalThis.OperaAgentRecord on injection; invoked by the worker via chrome.scripting.executeScript({world: 'MAIN'}) for init/frame/stop/cancel; never mutates the page.
 * @dependencies: none.
 */

// WHY THE ENCODER IS MAIN-WORLD AND NOT AN ISOLATED WORLD: measured, the same captureStream bytes come out empty in an isolated realm on this browser - the page's own realm paints, the isolated world is visible but the stream renders nothing.
// WHY THE LIVE DOM IS UNTOUCHED: everything happens on a detached canvas; nothing the page owns is read, written or restyled.

(function () {
  'use strict';

  if (globalThis.OperaAgentRecord) return;

  var state = null;

  function init(args) {
    state = null;

    var fps = Math.min(30, Math.max(5, Number(args?.fps) || 15));
    var maxWidth = Math.min(1600, Math.max(320, Number(args?.maxWidth) || 1280));

    if (typeof MediaRecorder !== 'function') {
      return { ok: false, error: 'MEDIA_RECORDER_UNAVAILABLE' };
    }

    var canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = 720;

    var ctx = canvas.getContext('2d');

    if (!ctx) {
      return { ok: false, error: 'CANVAS_2D_UNAVAILABLE' };
    }

    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = '16px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('Opera Agent recording starting - 0 ms', 24, canvas.height / 2);

    var stream;

    try {
      stream = canvas.captureStream(fps);
    } catch (error) {
      return { ok: false, error: 'CANVAS_CAPTURE_UNAVAILABLE', message: String(error?.message || error).slice(0, 200) };
    }

    var mime = '';

    if (typeof MediaRecorder.isTypeSupported === 'function') {
      mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
    }

    var recorder;

    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
    } catch (error) {
      return { ok: false, error: 'MEDIA_RECORDER_UNAVAILABLE', message: String(error?.message || error).slice(0, 200) };
    }

    var chunks = [];

    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };

    recorder.start();

    var track;

    try {
      track = stream.getVideoTracks()[0];
    } catch (error) {
      track = null;
    }

    state = { canvas: canvas, ctx: ctx, recorder: recorder, chunks: chunks, fps: fps, frames: 0, startedAt: Date.now(), lastBmp: null, timer: requestAnimationFrame(pump), pumped: 0, track: track };

    return { ok: true, fps: fps, maxWidth: maxWidth };
  }

  function pump() {
    if (!state) return;

    state && tick(state);

    if (state.track && typeof state.track.requestFrame === 'function') {
      try {
        state.track.requestFrame();
      } catch (error) {

      }
    }

    state.timer = requestAnimationFrame(pump);
  }

  function tick(target) {
    var elapsed = Date.now() - target.startedAt;

    if (target.lastBmp) {
      target.ctx.drawImage(target.lastBmp, 0, 0, Math.min(target.lastBmp.width, target.canvas.width), Math.min(target.lastBmp.height, target.canvas.height));
    } else {
      target.ctx.fillStyle = '#08081a';
      target.ctx.fillRect(0, 0, target.canvas.width, target.canvas.height);
      target.ctx.fillStyle = '#f2f2f2';
      target.ctx.font = '18px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
      target.ctx.textBaseline = 'middle';
      target.ctx.fillText('Recording Opera Agent - ' + elapsed + ' ms', 24, target.canvas.height / 2);
    }

    target.pumped += 1;

    target.ctx.fillStyle = 'rgba(6, 7, 20, 0.78)';
    target.ctx.fillRect(target.canvas.width - 152, target.canvas.height - 40, 148, 32);
    if (target.pumped % 8 < 4) {
      target.ctx.fillStyle = '#0000f2';
      target.ctx.fillRect(target.canvas.width - 152, target.canvas.height - 40, 74, 32);
    } else {
      target.ctx.fillStyle = '#ffffff';
      target.ctx.fillRect(target.canvas.width - 78, target.canvas.height - 40, 74, 32);
    }
    target.ctx.fillStyle = '#f2f2f2';
    target.ctx.font = '15px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    target.ctx.textBaseline = 'middle';
    target.ctx.fillText('+' + elapsed + '  f' + target.frames, target.canvas.width - 144, target.canvas.height - 23);
  }

  async function frame(args) {
    if (!state) return { ok: false, error: 'RECORD_NOT_INIT' };

    var data = args?.data;

    if (typeof data !== 'string' || !data) return { ok: false, error: 'FRAME_DATA_MISSING' };

    var bytes = Uint8Array.from(atob(data), function (c) { return c.charCodeAt(0); });
    var blob = new Blob([bytes], { type: 'image/jpeg' });

    var bmp;

    try {
      bmp = await createImageBitmap(blob);
    } catch (error) {
      return { ok: false, error: 'FRAME_DECODE_FAILED' };
    }

    if (bmp.width <= state.canvas.width && bmp.height <= state.canvas.height) {
      state.ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height);
    } else {
      var scaleDown = Math.min(state.canvas.width / bmp.width, state.canvas.height / bmp.height, 1);

      state.ctx.drawImage(bmp, 0, 0, Math.round(bmp.width * scaleDown), Math.round(bmp.height * scaleDown));
    }

    if (state.lastBmp) {
      try {
        state.lastBmp.close();
      } catch (error) {

      }
    }

    state.lastBmp = bmp;
    state.frames += 1;

    return { ok: true, frames: state.frames };
  }

  async function stop(args) {
    if (!state) return { ok: false, error: 'RECORD_NOT_INIT' };

    var held = state;
    state = null;

    if (held.timer) cancelAnimationFrame(held.timer);

    var stopped = new Promise(function (resolve) {
      held.recorder.onstop = function () { resolve(null); };
    });

    try {
      held.recorder.stop();
    } catch (error) {

    }

    await Promise.race([stopped, new Promise(function (resolve) { setTimeout(resolve, 3000); })]);

    var blob = new Blob(held.chunks, { type: 'video/webm' });

    if (args && typeof args.filename === 'string') {
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = args.filename;
      anchor.style.display = 'none';
      document.documentElement.appendChild(anchor);
      anchor.click();
      anchor.remove();
      await new Promise(function (resolve) { setTimeout(resolve, 900); });
      URL.revokeObjectURL(url);
    }

    return {
      ok: true,
      bytes: blob.size,
      durationMs: Date.now() - held.startedAt,
      frames: held.frames,
      mime: blob.type || 'video/webm',
      pumped: held.pumped,
      chunks: held.chunks.length,
      canvasW: held.canvas.width,
      canvasH: held.canvas.height,
      hasLastBmp: !!held.lastBmp
    };
  }

  function recordCancel() {
    if (state && state.timer) {
      cancelAnimationFrame(state.timer);
    }

    state = null;

    return { ok: true };
  }

  function debugCanvas() {
    if (!state) return { ok: false, error: 'RECORD_NOT_INIT' };

    var ctx = state.ctx;
    var width = state.canvas.width;
    var height = state.canvas.height;
    var topLeft = ctx.getImageData(0, 0, 1, 1).data;
    var middle = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
    var lowerRight = ctx.getImageData(width - 1, height - 1, 1, 1).data;

    return {
      ok: true,
      canvasWidth: width,
      canvasHeight: height,
      frames: state.frames,
      lastBmp: !!state.lastBmp,
      chunks: state.chunks.length,
      topLeft: Array.from(topLeft),
      middle: Array.from(middle),
      lowerRight: Array.from(lowerRight)
    };
  }

  globalThis.OperaAgentRecord = {
    init: init,
    frame: frame,
    stop: stop,
    cancel: recordCancel,
    debugCanvas: debugCanvas
  };
})();
