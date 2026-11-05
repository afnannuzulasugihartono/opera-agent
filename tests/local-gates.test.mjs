// @last-edited: 2026-11-05 UTC+7.
// @title: local-gates - a page that asks for a sign-in or a captcha is named, waited for, and never answered with a secret the agent read.
// @state: the gate classifier, the wait, the sign-in from a credential file, and the opt-in captcha solver.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../local/gates.js, ../local/captcha-solver.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GATE_PROBE_EXPRESSION,
  classifyGate,
  detectGate,
  waitForGateClear,
  loginWithCredentials
} from '../local/gates.js';
import { solverSettings, solveImageCaptcha, captchaAllowed } from '../local/captcha-solver.js';

// WHY THE FAKE PAGE IS A LIST OF FACTS AND NOT A PAGE.
// The gate probe reads the page once and hands back facts; a test that answered with a fake DOM would only prove the fake DOM answers.
// So the fake is the list of facts a page can hold, and every test says which page it is.

function facts(overrides = {}) {
  return {
    url: 'https://contoh.co.id/masuk',
    title: 'Masuk',
    password: [],
    otp: [],
    text: [],
    captchaInput: [],
    captchaImage: [],
    provider: null,
    submit: [],
    ...overrides
  };
}

function fakeDriver(sequence) {
  const calls = [];
  let ask = 0;
  return {
    calls,
    evaluate: async (expression) => {
      calls.push(['evaluate', expression === GATE_PROBE_EXPRESSION]);
      const page = sequence[Math.min(ask, sequence.length - 1)];
      ask += 1;
      return page;
    },
    click: async (x, y) => { calls.push(['click', x, y]); return { x, y }; },
    type: async (text) => { calls.push(['type', text]); return { chars: text.length }; },
    ask_: async () => ({}),
    snapshot: async () => []
  };
}

const sleep = async () => {};

test('a password field is a login gate and the gate says what it saw', () => {
  const gate = classifyGate(facts({ password: [{ x: 10, y: 20 }], text: [{ x: 5, y: 5 }] }));

  assert.equal(gate.gate, 'login');
  assert.deepEqual(gate.gates, ['login']);
  assert.match(gate.why, /password/i);
  assert.equal(gate.evidence.passwordFields, 1);
});

test('a one-time code is its own gate, and it is never answered', () => {
  const gate = classifyGate(facts({ otp: [{ x: 1, y: 2 }] }));

  assert.equal(gate.gate, 'otp');
  assert.ok(gate.gates.includes('otp'));
  assert.match(gate.why, /one-time|verification code|otp/i);
});

test('a captcha image beside a field is a captcha gate, and a token widget is named as one', () => {
  const image = classifyGate(facts({
    captchaImage: [{ x: 3, y: 4, left: 1, top: 2, width: 100, height: 40 }],
    captchaInput: [{ x: 6, y: 7 }]
  }));
  const token = classifyGate(facts({ provider: 'turnstile' }));

  assert.equal(image.gate, 'captcha');
  assert.equal(image.evidence.captchaImages, 1);
  assert.equal(image.evidence.captchaKind, 'image');
  assert.equal(token.gate, 'captcha');
  assert.equal(token.evidence.captchaKind, 'token');
  assert.equal(token.evidence.provider, 'turnstile');
});

test('a page with nothing to sign in or to prove is no gate at all', () => {
  const gate = classifyGate(facts({ url: 'https://contoh.co.id/artikel' }));

  assert.equal(gate.gate, 'none');
  assert.deepEqual(gate.gates, []);
  assert.equal(gate.why, '');
});

test('the detect reads the page once and answers with the gate and the page it came from', async () => {
  const driver = fakeDriver([facts({ password: [{ x: 1, y: 2 }] })]);
  const gate = await detectGate(driver);

  assert.equal(gate.gate, 'login');
  assert.equal(gate.url, 'https://contoh.co.id/masuk');
  assert.equal(gate.title, 'Masuk');
  assert.equal(driver.calls.length, 1);
});

test('the wait ends when the gate clears and says what it saw while it waited', async () => {
  const driver = fakeDriver([
    facts({ password: [{ x: 1, y: 2 }] }),
    facts({ password: [{ x: 1, y: 2 }] }),
    facts({ url: 'https://contoh.co.id/beranda', title: 'Beranda' })
  ]);

  const out = await waitForGateClear(driver, { timeoutMs: 5000, intervalMs: 10, sleep });

  assert.equal(out.cleared, true);
  assert.equal(out.checks, 3);
  assert.equal(out.before.url, 'https://contoh.co.id/masuk');
  assert.equal(out.after.url, 'https://contoh.co.id/beranda');
});

test('the wait gives up with the page as it stands, and says it did not clear', async () => {
  const driver = fakeDriver([facts({ password: [{ x: 1, y: 2 }] })]);

  const out = await waitForGateClear(driver, { timeoutMs: 20, intervalMs: 10, sleep });

  assert.equal(out.cleared, false);
  assert.match(out.why, /still/i);
  assert.ok(out.after);
});

function credentialFile(accounts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-gates-'));
  const file = path.join(dir, 'credentials.json');
  fs.writeFileSync(file, JSON.stringify({ accounts }, null, 1));
  return file;
}

test('a sign-in fills the fields from the credential file and never says the secret back', async () => {
  const file = credentialFile([{ domain: 'contoh.co.id', username: 'budi@example.com', password: 'rahasia123' }]);
  const driver = fakeDriver([
    facts({ password: [{ x: 10, y: 20 }], text: [{ x: 5, y: 5 }], submit: [{ x: 30, y: 40, name: 'Masuk' }] }),
    facts({ url: 'https://contoh.co.id/beranda', title: 'Beranda' })
  ]);

  const out = await loginWithCredentials(driver, { credentialsPath: file, timeoutMs: 5000, intervalMs: 10, sleep });

  assert.equal(out.signedIn, true);
  assert.equal(out.account, 'contoh.co.id');
  assert.equal(out.user, 'b***@example.com');
  assert.equal(out.before.url, 'https://contoh.co.id/masuk');
  assert.equal(out.after.url, 'https://contoh.co.id/beranda');
  const typed = driver.calls.filter((call) => call[0] === 'type').map((call) => call[1]);
  assert.ok(typed.includes('budi@example.com'), 'the username is typed');
  assert.ok(typed.includes('rahasia123'), 'the password reaches the page');
  assert.ok(!JSON.stringify(out).includes('rahasia123'), 'the answer never carries the secret back');
});

test('a sign-in without an account for this domain is refused and names what was missing', async () => {
  const file = credentialFile([{ domain: 'lain.example', username: 'a@b.c', password: 'x' }]);
  const driver = fakeDriver([facts({ password: [{ x: 1, y: 2 }] })]);

  await assert.rejects(
    () => loginWithCredentials(driver, { credentialsPath: file, timeoutMs: 100, intervalMs: 10, sleep }),
    /no account/i
  );
  assert.equal(driver.calls.filter((call) => call[0] === 'type').length, 0, 'nothing was typed');
});

test('a one-time code is refused before anything is typed', async () => {
  const file = credentialFile([{ domain: 'contoh.co.id', username: 'budi@example.com', password: 'rahasia123' }]);
  const driver = fakeDriver([facts({ otp: [{ x: 1, y: 2 }], password: [{ x: 2, y: 3 }] })]);

  await assert.rejects(
    () => loginWithCredentials(driver, { credentialsPath: file, timeoutMs: 100, intervalMs: 10, sleep }),
    /one-time|otp|verification code/i
  );
  assert.equal(driver.calls.filter((call) => call[0] === 'type').length, 0, 'nothing was typed');
});

test('the captcha solver refuses a page outside the allowed domains', () => {
  const settings = solverSettings({ OPERA_CAPTCHA_API_URL: 'https://solver.example', OPERA_CAPTCHA_API_KEY: 'k', OPERA_CAPTCHA_DOMAINS: 'contoh.co.id' });

  assert.equal(captchaAllowed(settings, 'https://contoh.co.id/masuk'), true);
  assert.equal(captchaAllowed(settings, 'https://lain.example/masuk'), false);
  assert.equal(captchaAllowed(solverSettings({}), 'https://contoh.co.id/masuk'), false);
});

test('the solver asks for a task, waits for the answer, and says what it paid', async () => {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/createTask')) {
      return { ok: true, json: async () => ({ errorId: 0, taskId: 42 }) };
    }
    return { ok: true, json: async () => ({ errorId: 0, status: 'ready', solution: { text: 'A7B2' } }) };
  };

  const out = await solveImageCaptcha({
    baseUrl: 'https://solver.example',
    apiKey: 'key-1',
    image: 'BASE64PNG',
    fetchImpl,
    sleep
  });

  assert.equal(out.text, 'A7B2');
  assert.equal(out.taskId, 42);
  assert.equal(asked.length, 2);
  assert.equal(asked[0].body.task.type, 'ImageToText');
  assert.equal(asked[0].body.task.body, 'BASE64PNG');
  assert.equal(asked[1].body.taskId, 42);
});

test('the solver reports a refusal from the service instead of pretending it solved', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ errorId: 1, errorCode: 'ERROR_KEY_DOES_NOT_EXIST', errorDescription: 'no key' }) });

  await assert.rejects(
    () => solveImageCaptcha({ baseUrl: 'https://solver.example', apiKey: 'bad', image: 'X', fetchImpl, sleep }),
    /ERROR_KEY_DOES_NOT_EXIST|no key/
  );
});

test('the solver gives up when the service never finishes the task', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/createTask')) return { ok: true, json: async () => ({ errorId: 0, taskId: 7 }) };
    return { ok: true, json: async () => ({ errorId: 0, status: 'processing' }) };
  };

  await assert.rejects(
    () => solveImageCaptcha({ baseUrl: 'https://solver.example', apiKey: 'k', image: 'X', fetchImpl, sleep, timeoutMs: 20, pollMs: 10 }),
    /not finished|came back without/i
  );
});
