/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: record-session - arm a recording on the tab, let any commands run against it, stop it into one webm in Downloads.
 * @state: page.record_start arms (sensitive-surface refusal first, screencast starts, the page encoder initializes); page.record_stop finalizes; the armed session lives in this module, not in any single command.
 * @dependencies: tab-content, private-tabs, capture.js helpers, utils.
 */

// WHY AN ARM/STOP PAIR INSTEAD OF ONE FIXED SCROLL: a recording that only walks top to bottom cannot show what a form accepts, what a menu opens or what a job finishes - the agent must be able to drive anything between arm and stop and still get one continuous artefact.
// WHY THE DEBUGGER STAYS ATTACHED BETWEEN COMMANDS: the screencast frame events stop the moment the debugger detaches, so arming hands the session its own attachment and stopping reclaims it; between the two, the reader sees the bar Chrome pins on the tab, which is the honest sign the page is being watched.
// WHY THE ENCODER LIVES IN THE PAGE: only the page's realm can paint a canvas and encode it to a webm; the worker owns the CDP screencast and stays out of the encode.

import { nowIso, sleep } from './utils.js';
import { HTTP_URL_RE, contentCall, recordScanCall, resolveTabId } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import { codedError, assertCaptureFramesSafe } from './capture.js';
import { waitForDownloadByFilename } from './download-wait.js';
import { isRecord } from '../lib/guards.js';

// WHY THE ENCODER IS DRIVEN BY executeScript, NOT BY MESSAGE PASSING: measured, the isolated world's canvas captureStream delivers nothing to MediaRecorder in this browser; the page's own realm does, so the encoder lives there and the worker calls it the only way a worker can reach it.

async function ensureRecordMain(tabId: number) {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.OperaAgentRecord),
      world: 'MAIN'
    });

    if (probe?.result) return;
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/record-main.js'],
      world: 'MAIN'
    });
  } catch (error) {
    throw codedError('RECORD_MAIN_INJECT_FAILED', String(error instanceof Error ? error.message : String(error)).slice(0, 200), { tabId });
  }

  try {
    const [probe2] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.OperaAgentRecord),
      world: 'MAIN'
    });

    if (!probe2?.result) {
      throw codedError('RECORD_MAIN_INJECT_SILENT', 'The script ran but did not build OperaAgentRecord.', { tabId, world: 'MAIN' });
    }
  } catch (error) {
    if (isRecord(error) && error.code) throw error;

    throw codedError('RECORD_MAIN_VERIFY_FAILED', String(error instanceof Error ? error.message : String(error)).slice(0, 200), { tabId });
  }
}

async function mainCall(tabId: number, method: string, args?: unknown): Promise<Record<string, unknown>> {
  await ensureRecordMain(tabId);

  const [frame] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name: string, payload: unknown) => {
      const api = globalThis.OperaAgentRecord;
      const fn = api ? api[name] : undefined;

      if (typeof fn !== 'function') {
        return { ok: false, error: 'RECORD_MAIN_MISSING' };
      }

      return fn(payload);
    },
    args: [method, args || null],
    world: 'MAIN'
  });

  const result: unknown = frame?.result;

  return isRecord(result) ? result : { ok: false, error: 'NO_RESULT' };
}

const DEFAULT_FPS = 15;
const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_QUALITY = 60;
const MIN_FPS = 5;
const MAX_FPS = 30;
const SAMPLE_EVERY_MS = 750;
const MAX_SAMPLES = 12;
const FILMSTRIP_SAMPLES = 4;
const MAX_FILENAME_LENGTH = 120;

const sleepMs = sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

interface RecordingSample {
  t: number;
  mimeType: string;
  data: unknown;
}

type ScreencastListener = (source: chrome.debugger.DebuggerSession, method: string, payload?: { [key: string]: unknown }) => void;

interface RecordingSession {
  tabId: number;
  filename: string;
  fps: number;
  maxWidth: number;
  quality: number;
  startedAt: number;
  screencastFrames: number;
  samples: RecordingSample[];
  lastSampleAt: number;
  url: string;
  title: string;
  listener: ScreencastListener | null;
  scrollDone?: Promise<Record<string, unknown> | null> | undefined;
}

let active: RecordingSession | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Number.parseInt(String(value), 10);

  if (!Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

function cleanFilename(value: unknown) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  const safe = raw.replace(/[\\/:*?<>|\x00-\x1f]/g, '-').replace(/\s+/g, '-');

  if (!safe || safe === '.' || safe === '..') return null;

  return safe.slice(0, MAX_FILENAME_LENGTH);
}

function attachmentName(tabUrl: string) {
  try {
    const host = new URL(tabUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');

    if (host) return `opera-agent-record-${host}-${Date.now()}.webm`;
  } catch {

  }

  return `opera-agent-record-${Date.now()}.webm`;
}

function spreadSamples(samples: RecordingSample[], count: number): RecordingSample[] {
  if (samples.length <= count) return samples;

  const step = (samples.length - 1) / (count - 1);
  const picked: RecordingSample[] = [];

  for (let i = 0; i < count; i += 1) {
    const sample = samples[Math.round(i * step)];

    if (sample) picked.push(sample);
  }

  return picked;
}

async function guardTab(id: number) {
  const tab = await chrome.tabs.get(id);

  if (!HTTP_URL_RE.test(tab.url || '')) throw codedError('CAPTURE_BLOCKED', 'Recordings only support HTTP/HTTPS tabs.', { tabId: id });

  if (tab.incognito) throw codedError('CAPTURE_BLOCKED', 'Recordings are blocked in incognito tabs.', { tabId: id, reason: 'INCOGNITO' });

  if (await isPrivateTab(id)) throw codedError('CAPTURE_BLOCKED', 'This tab was marked private in the Opera Agent popup.', { tabId: id, reason: 'USER_PRIVATE' });

  const policy = await contentCall(id, 'page.capture_policy', {});

  if (!policy?.allowed) {
    throw codedError('CAPTURE_BLOCKED', 'Recording blocked because a visible password, OTP, payment, or other sensitive field is present.', {
      tabId: id,
      reason: policy?.reason || 'SENSITIVE_SURFACE'
    });
  }

  await assertCaptureFramesSafe(id);

  return tab;
}

export async function recordStart(tabId: number, params: Record<string, unknown> | undefined, _context: unknown) {
  if (active) {
    throw codedError('RECORD_ALREADY_ARMED', 'A recording is already armed; stop it before arming another.', {
      armedOn: active.tabId,
      startedAt: active.startedAt,
      filename: active.filename
    });
  }

  const id = await resolveTabId({ ...params, tabId });
  const tab = await guardTab(id);
  const fps = clampInt(params?.fps, DEFAULT_FPS, MIN_FPS, MAX_FPS);
  const maxWidth = clampInt(params?.maxWidth, DEFAULT_MAX_WIDTH, 320, 1600);
  const quality = clampInt(params?.quality, DEFAULT_QUALITY, 40, 80);

  const encoder = await mainCall(id, 'init', { fps, maxWidth });

  if (!encoder?.ok) {
    throw codedError(encoder?.error ? String(encoder?.error) : 'RECORD_MODULE_MISSING', encoder?.message ? String(encoder?.message) : 'The page could not start the recording encoder.', { tabId: id });
  }

  const filename = cleanFilename(params?.filename) || attachmentName(tab.url || '');

  const session: RecordingSession = {
    tabId: id,
    filename,
    fps,
    maxWidth,
    quality,
    startedAt: Date.now(),
    screencastFrames: 0,
    samples: [],
    lastSampleAt: 0,
    url: tab.url || '',
    title: tab.title || '',
    listener: null
  };

  const target = { tabId: id };
  let attached = false;

  try {
    await chrome.debugger.attach(target, '1.3');

    attached = true;

    await chrome.debugger.sendCommand(target, 'Page.enable', {});

    session.listener = (source: chrome.debugger.DebuggerSession, method: string, payload?: { [key: string]: unknown }) => {
      if (source.tabId !== id || method !== 'Page.screencastFrame') return;

      session.screencastFrames += 1;

      mainCall(id, 'frame', { data: payload?.data }).catch(() => {});

      const now = Date.now();

      if (session.samples.length < MAX_SAMPLES && now - session.lastSampleAt >= SAMPLE_EVERY_MS) {
        session.samples.push({ t: now, mimeType: 'image/jpeg', data: payload?.data });
        session.lastSampleAt = now;
      }

      chrome.debugger.sendCommand(target, 'Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
    };

    chrome.debugger.onEvent.addListener(session.listener);

    await chrome.debugger.sendCommand(target, 'Page.startScreencast', {
      format: 'jpeg',
      quality,
      maxWidth,
      everyNthFrame: 1
    });

    if (params?.scroll === true) {
      session.scrollDone = recordScanCall(id, 'record_scroll.scroll', { durationMs: 3000 });
    }

    active = session;

    return {
      kind: 'recording-armed',
      armed: {
        filename,
        fps,
        maxWidth,
        quality,
        scrolled: params?.scroll === true,
        startedAt: session.startedAt
      },
      tabId: id,
      page: {
        url: tab.url || '',
        title: tab.title || ''
      }
    };
  } catch (error) {
    if (session.listener) {
      try {
        chrome.debugger.onEvent.removeListener(session.listener);
      } catch {
      }
    }

    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
      }
    }

    await mainCall(id, 'cancel', {}).catch(() => {});

    throw error;
  }
}

export async function recordStop(tabId: number, params: Record<string, unknown> | undefined, _context: unknown) {
  if (!active) {
    throw codedError('SESSION_NOT_ARMED', 'No recording is armed; arm one with record_start first.', {});
  }

  const id = await resolveTabId({ ...params, tabId });

  if (active.tabId !== id) {
    throw codedError('SESSION_ON_OTHER_TAB', 'The armed recording belongs to a different tab; stop it there.', {
      armedOn: active.tabId,
      tabId: id,
      filename: active.filename
    });
  }

  const held = active;
  active = null;
  const target = { tabId: id };

  let scrolledTo: unknown = null;

  try {
    if (held.scrollDone !== undefined) {
      const scrolled = await Promise.race([held.scrollDone, sleepMs(5000).then(() => null)]);

      scrolledTo = scrolled?.scrolled ?? null;
    }
  } catch {
    scrolledTo = null;
  }

  try {
    if (held.listener) {
      chrome.debugger.onEvent.removeListener(held.listener);
    }
  } catch {

  }

  try {
    await chrome.debugger.sendCommand(target, 'Page.stopScreencast', {});
  } catch {

  }

  try {
    await chrome.debugger.detach(target);
  } catch {

  }

  const stop = await mainCall(id, 'stop', { filename: held.filename });

  if (!stop?.ok) {
    await mainCall(id, 'cancel', {}).catch(() => {});

    throw codedError(stop?.error ? String(stop?.error) : 'RECORD_STOP_FAILED', stop?.message ? String(stop?.message) : 'The page could not finish the recording.', {
      tabId: id,
      screencastFrames: held.screencastFrames,
      samples: held.samples.length
    });
  }

  const durationMs = Date.now() - held.startedAt;
  const picks = spreadSamples(held.samples, FILMSTRIP_SAMPLES);

  const item = await waitForDownloadByFilename(held.filename, 30000);

  return {
    kind: 'recording',
    recording: {
      filename: held.filename,
      path: item.filename || held.filename,
      bytes: stop.bytes,
      mime: stop.mime,
      durationMs,
      capturedAt: nowIso(),
      fps: held.fps,
      maxWidth: held.maxWidth,
      quality: held.quality,
      screencastFrames: held.screencastFrames,
      encoderFrames: stop.frames,
      pumped: stop.pumped || 0,
      chunks: stop.chunks || 0,
      canvasW: stop.canvasW || 0,
      canvasH: stop.canvasH || 0,
      hasLastBmp: !!stop.hasLastBmp,
      scrolledTo
    },
    samples: picks,
    tabId: id,
    page: {
      url: held.url,
      title: held.title
    }
  };
}
