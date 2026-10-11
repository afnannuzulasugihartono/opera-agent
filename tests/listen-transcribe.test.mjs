// @last-edited: 2026-10-07 UTC+7.
// @title: listen-transcribe.test — Test..
// @state: Test..
// @dependencies: node:test, strict, node:fs, node:module, node:vm.

// The listen function turns tab audio into timestamped segments: device-token
// auth per action, one live session per device, 10-second windows to Gemini,
// segments stored, audio deleted (retention 0 for voice). The vm harness below
// drives start, two appends and stop against an in-memory store with a canned
// transcriber, proving offsets, deletion and session end without network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/opera-agent-listen/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, ''));

const TOKEN = 'a'.repeat(64);
const TOKEN_HASH_PLACEHOLDER = 'hash';

function store() {
  return {
    opera_devices: [{ id: 'dev-1', device_name: 'opera', token_hash: 'x', user_id: 'user-1', status: 'online' }],
    opera_listen_sessions: [],
    opera_listen_chunks: [],
    opera_listen_segments: [],
    opera_audit: []
  };
}

function harness(db, fetchImpl) {
  let handler;
  const fetchCalls = [];
  const table = (name) => db[name];
  const match = (rows, filters) => rows.filter((r) => filters.every(([op, col, val]) => {
    if (op === 'eq') return r[col] === val;
    if (op === 'neq') return r[col] !== val;
    if (op === 'in') return val.includes(r[col]);
    return true;
  }));
  const builder = (name) => {
    const filters = [];
    let orderCol = null;
    let limitN = null;
    let pendingUpdate = null;
    let pendingDelete = false;
    let pendingError = null;
    const liveHidden = () => name === 'opera_listen_sessions' && db.__hideLiveOnce
      && filters.some(([op, col, val]) => op === 'eq' && col === 'status' && val === 'live');
    const self = {
      select() { return self; },
      eq(col, val) { filters.push(['eq', col, val]); return self; },
      neq(col, val) { filters.push(['neq', col, val]); return self; },
      order(col) { orderCol = col; return self; },
      limit(n) { limitN = n; return self; },
      in(col, val) { filters.push(['in', col, val]); return self; },
      async single() {

        if (liveHidden()) { db.__hideLiveOnce = false; return { data: null, error: null }; }
        let rows = match(table(name), filters);
        if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1));
        if (limitN !== null) rows = rows.slice(0, limitN);
        return { data: rows[0] || null, error: pendingError };
      },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach((r, i) => {
          if (name === 'opera_listen_sessions' && r.status === 'live'
            && table(name).some((x) => x.device_id === r.device_id && x.status === 'live')) {
            pendingError = { code: '23505', message: 'duplicate key value violates unique constraint "opera_listen_sessions_device_live_uniq"' };
            return;
          }
          db[name].push({ id: '00000000-0000-4000-8000-' + String(db[name].length + i).padStart(12, '0'), ...r });
        });
        return self;
      },
      update(patch) { pendingUpdate = patch; return self; },
      delete() { pendingDelete = true; return self; },
      upsert(row) {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          if (!db[name].some((x) => x.session_id === r.session_id && x.seq === r.seq)) db[name].push({ id: `c-${db[name].length}`, ...r });
        }
        return self;
      }
    };

    self.then = (resolve) => {
      if (pendingUpdate) for (const r of match(table(name), filters)) Object.assign(r, pendingUpdate);
      if (pendingDelete) db[name] = db[name].filter((r) => !match([r], filters).length);
      if (liveHidden()) { db.__hideLiveOnce = false; resolve({ data: [], error: pendingError }); return; }
      let rows = match(table(name), filters);
      if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1));
      if (limitN !== null) rows = rows.slice(0, limitN);
      resolve({ data: rows, error: pendingError });
    };
    return self;
  };
  const client = {
    from: (name) => builder(name),
    auth: { async getUser() { return { data: { user: null }, error: { message: 'no' } }; } }
  };
  const fakeFetch = fetchImpl || (async (url, opts) => {
    fetchCalls.push({ url });
    assert.match(url, /api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
    return { ok: true, status: 200, json: async () => ({ text: 'halo dunia test', segments: [
      { start: 1, end: 3, text: 'halo dunia', no_speech_prob: 0.1 },
      { start: 3, end: 4, text: 'you', no_speech_prob: 0.9 }
    ] }) };
  });
  const errors = [];
  const edgeLog = { error: (svc, msg) => { errors.push(`${svc}: ${msg}`); } };
  vm.runInNewContext(source, {
    createClient: () => client, createEdgeLog: () => edgeLog,

    CORS_DEFAULT_ORIGINS, resolveAllowedOrigin,
    Deno: { env: { get: (key) => (key === 'SUPABASE_URL' || key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test' : (key === 'GROQ_API_KEY' ? 'test-key' : '')) }, serve: (fn) => { handler = fn; } },
    Request, Response, Headers, URL, TextEncoder, FormData, Blob, atob, fetch: fakeFetch, crypto
  });
  const call = (body) => handler(new Request('https://example.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
  return { call, fetchCalls, errors };
}

test('start refuses unknown devices and second live sessions', async () => {
  const db = store();
  db.opera_devices[0].token_hash = createHash('sha256').update(TOKEN.toLowerCase()).digest('hex');
  const h = harness(db);
  const bad = await h.call({ action: 'start', token: 'b'.repeat(64), deviceName: 'opera', tabId: 1 });
  assert.equal(bad.status, 401, h.errors.join('; '));
  const ok = await (await h.call({ action: 'start', token: TOKEN, deviceName: 'opera', tabId: 7 })).json();
  assert.equal(ok.ok, true);
  const again = await (await h.call({ action: 'start', token: TOKEN, deviceName: 'opera', tabId: 7 })).json();
  assert.equal(again.error, 'A listening session is already live on this device. Stop it first.');
});

test('one complete window transcribes on arrival, then stop ends and deletes', async () => {
  const db = store();
  const h = harness(db);

  db.opera_devices[0].token_hash = createHash('sha256').update(TOKEN.toLowerCase()).digest('hex');
  const started = await (await h.call({ action: 'start', token: TOKEN, deviceName: 'opera', tabId: 7 })).json();
  assert.equal(started.ok, true);
  const sid = started.sessionId;

  const chunk = Buffer.from('fake-opus-byte').toString('base64');
  assert.match(chunk, /=+$/, 'the fixture audio carries padding like real windows');
  const first = await (await h.call({ action: 'append', token: TOKEN, sessionId: sid, seq: 0, audio: chunk })).json();
  assert.equal(first.ok, true);
  assert.equal(first.transcribed, 1);
  assert.equal(db.opera_listen_segments.length, 1);
  assert.equal(db.opera_listen_segments[0].start_s, 1);
  assert.equal(db.opera_listen_segments[0].text, 'halo dunia');
  assert.equal(db.opera_listen_chunks.length, 0, 'consumed audio is deleted');
  const stopped = await (await h.call({ action: 'stop', token: TOKEN, sessionId: sid })).json();
  assert.equal(stopped.ok, true);
  assert.equal(db.opera_listen_sessions[0].status, 'ended');
  assert.equal(h.fetchCalls.length, 1, 'one transcription call for one full window');
});

test('a concurrent second start takes the live session, never a duplicate', async () => {
  const db = store();
  db.opera_devices[0].token_hash = createHash('sha256').update(TOKEN.toLowerCase()).digest('hex');
  const h = harness(db);
  const first = await (await h.call({ action: 'start', token: TOKEN, deviceName: 'opera', tabId: 7 })).json();
  assert.equal(first.ok, true);

  db.__hideLiveOnce = true;
  const raced = await h.call({ action: 'start', token: TOKEN, deviceName: 'opera', tabId: 8 });
  assert.equal(raced.status, 409);
  const body = await raced.json();
  assert.equal(body.error, 'A listening session is already live on this device. Stop it first.');
  assert.equal(body.sessionId, first.sessionId);
  assert.equal(db.opera_listen_sessions.filter((s) => s.status === 'live').length, 1, 'no duplicate live row');
});

test('the transcriber uses Groq Whisper verbose_json, not Gemini', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../supabase/functions/opera-agent-listen/index.ts', import.meta.url), 'utf8');

  assert.match(source, /api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
  assert.match(source, /whisper-large-v3/);
  assert.match(source, /response_format", "verbose_json/);
  assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(source, /GEMINI_API_KEY/);
});

test('the live-session uniqueness is a partial unique index, not application logic', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/migrations/20261009000003_opera_agent_listen_live_uniq.sql', import.meta.url), 'utf8');

  assert.match(sql, /create unique index if not exists opera_listen_sessions_device_live_uniq/);
  assert.match(sql, /on public\.opera_listen_sessions\(device_id\) where status = 'live'/);
  assert.doesNotMatch(sql, /^\s*(grant|revoke)\s/im, 'index-only change carries no grant statement');
  const fn = await readFile(new URL('../supabase/functions/opera-agent-listen/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /"23505"/, 'the start path maps the unique violation');
  assert.match(fn, /Stop it first\.", sessionId:/, 'the loser carries the live session id');
});

test('the migration stores transcripts owner-scoped with no grants', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/migrations/20261007100000_opera_listen_sessions.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.opera_listen_sessions/);
  assert.match(sql, /unique \(session_id, seq\)/);
  assert.doesNotMatch(sql, /grant (select|all)/i);
});
