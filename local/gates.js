// @last-edited: 2026-11-05 UTC+7.
// @title: gates — a page that asks to sign in, to prove a code, or to solve a captcha, named before anything is typed.
// @state: one probe expression, one classifier, one wait, and a sign-in that reads its secret from a file the person owns.
// @dependencies: node:fs, node:path.

// WHY THIS FILE EXISTS.
// A portal that signs in is the first step of every real business job, and the old answer - stop, ask the person - left the drive with nothing to do on the page it was already on.
// So the gate is detected from the page itself, named honestly, and only ever answered the way the person allowed: a password from a file they wrote, a one-time code never answered by the agent.

// WHY THE DEFAULT IS STILL "NEVER TYPE A PASSWORD".
// Passwordless default is what keeps an agent from leaking a credential it read.
// So nothing here types a password unless the caller names a credentials file, the file holds an account for exactly this domain, and the caller asked for the sign-in by name.
// The probe reads boxes, never values: a value never enters the model's context.

// WHY THE ONE-TIME CODE IS NEVER ANSWERED.
// A code that arrives on the person's phone is proof that the person is present; an agent that could answer it would be pretending to be them.
// So an OTP field outranks every other gate: the sign-in refuses by name, types nothing, and the person finishes it in their own browser.

// WHY THE CAPTCHA IS NAMED AND LEFT ALONE HERE.
// The solver is opt-in and lives in its own module; this file's job is to say a captcha is there, which kind it is, and where the image and the field sit.
// A default that silently solved captchas would break the promise the blocking gate was built on, so the classifier never solves anything.

// WHY THE FIELDS ARE READ AS BOXES AND NOT AS SELECTORS.
// The drive clicks by coordinate and every click is measured against the live page, so a box read now and clicked a moment later still lands on the field.
// A selector would have to be re-run against a page that may have moved, and a stale selector is how a password ends up in a search box.

import fs from 'node:fs';
import path from 'node:path';

export const GATE_PROBE_EXPRESSION = `(() => {
  const attr = (el) => [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title')].filter(Boolean).join(' ').toLowerCase();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const formOf = (el) => {
    const form = el.form || el.closest('form');
    if (!form) return { method: '', action: '' };
    return { method: String(form.getAttribute('method') || 'get').toLowerCase(), action: form.getAttribute('action') ?? '' };
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const password = [];
  const otp = [];
  const text = [];
  const captchaInput = [];
  for (const el of document.querySelectorAll('input, textarea')) {
    if (!shown(el)) continue;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'hidden' || type === 'file' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio' || type === 'image') continue;
    const said = attr(el);
    if (type === 'password') { password.push({ ...box(el), ...formOf(el) }); continue; }
    if (/one-time-code|one time|\\botp\\b|kode verifikasi|verification code|kode otp/.test(said)) { otp.push(box(el)); continue; }
    if (/captcha|verifikasi|kode keamanan/.test(said)) { captchaInput.push(box(el)); continue; }
    text.push(box(el));
  }
  const captchaImage = [];
  for (const el of document.querySelectorAll('img, canvas, svg')) {
    if (!shown(el)) continue;
    const said = ((el.getAttribute('src') || '') + ' ' + (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('class') || '')).toLowerCase();
    if (/captcha|verifikasi/.test(said)) captchaImage.push(box(el));
  }
  const provider = document.querySelector('iframe[src*="challenges.cloudflare.com"], script[src*="turnstile"], [class*="turnstile"], [id*="turnstile"]') ? 'turnstile'
    : document.querySelector('iframe[src*="hcaptcha"], script[src*="hcaptcha"], [class*="hcaptcha"]') ? 'hcaptcha'
      : document.querySelector('iframe[src*="recaptcha"], script[src*="recaptcha"], .g-recaptcha, [class*="recaptcha"]') ? 'recaptcha'
        : null;
  const submit = [];
  for (const el of document.querySelectorAll('button, input[type=submit], [role=button]')) {
    if (!shown(el)) continue;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    if (!/masuk|sign in|log ?in|submit|kirim|lanjut|continue|next|verify|verifikasi/i.test(label)) continue;
    const spot = box(el);
    submit.push({ x: spot.x, y: spot.y, name: label.slice(0, 60) });
  }
  return { url: location.href, title: document.title, password: password, otp: otp, text: text, captchaInput: captchaInput, captchaImage: captchaImage, provider: provider, submit: submit };
})()`;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY A CREDENTIAL IN AN ADDRESS IS MASKED.
// Measured live on 2026-11-05: a sign-in form that submits by GET put the password in the address of the page, so every read of that page carried the secret back into the model's context, into the history, and into the server log.
// The mask sits where the address is read, so every answer that carries an address carries a safe one.

const CREDENTIAL_KEYS = /^(password|passwd|pwd|pass|secret|api_key|apikey)$/i;

export function maskCredentialUrl(url) {
  const raw = String(url ?? '');
  if (!raw) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  let touched = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (CREDENTIAL_KEYS.test(key)) {
      parsed.searchParams.set(key, '***');
      touched = true;
    }
  }
  if (parsed.username || parsed.password) {
    parsed.username = parsed.username ? '***' : '';
    parsed.password = '***';
    touched = true;
  }
  return touched ? parsed.toString() : raw;
}

// WHY THE CLASSIFIER ANSWERS ONE PRIMARY GATE AND THE WHOLE LIST.
// A page can hold a password box and a captcha at once, and the next move depends on which one is asked for by name.
// So gate is the one thing to handle now, in the order the person's presence is required: an OTP first, then a captcha, then a password.

export function classifyGate(facts = {}) {
  const password = Array.isArray(facts.password) ? facts.password : [];
  const otp = Array.isArray(facts.otp) ? facts.otp : [];
  const captchaImage = Array.isArray(facts.captchaImage) ? facts.captchaImage : [];
  const captchaInput = Array.isArray(facts.captchaInput) ? facts.captchaInput : [];
  const provider = facts.provider ?? null;

  const gates = [];
  if (password.length) gates.push('login');
  if (otp.length) gates.push('otp');
  if (captchaImage.length || captchaInput.length || provider) gates.push('captcha');

  const evidence = {
    passwordFields: password.length,
    otpFields: otp.length,
    captchaImages: captchaImage.length,
    captchaInputs: captchaInput.length,
    captchaKind: captchaImage.length || captchaInput.length ? 'image' : (provider ? 'token' : null),
    provider
  };

  const gate = otp.length ? 'otp'
    : (captchaImage.length || captchaInput.length || provider) ? 'captcha'
      : password.length ? 'login' : 'none';

  const why = gate === 'otp'
    ? 'the page asks for a one-time code, which only the person can answer'
    : gate === 'captcha'
      ? (evidence.captchaKind === 'token' ? 'the page asks for a token captcha, a widget rather than an image' : 'the page asks for a captcha image beside a field')
      : gate === 'login'
        ? 'the page asks for a password'
        : '';

  return { gate, gates, why, evidence };
}

// WHY THE DETECT CARRIES THE BOXES AND NOT ONLY THE VERDICT.
// The sign-in that follows needs the field it is about to click, and reading the page a second time would pay the same probe twice.
// The boxes never carry a value, so the extra data is geometry, not a secret.

export async function detectGate(driver) {
  const facts = await driver.evaluate(GATE_PROBE_EXPRESSION);
  const page = facts && typeof facts === 'object' ? facts : {};
  return {
    ...classifyGate(page),
    url: maskCredentialUrl(page.url),
    title: String(page.title ?? ''),
    fields: {
      text: Array.isArray(page.text) ? page.text : [],
      password: Array.isArray(page.password) ? page.password : [],
      otp: Array.isArray(page.otp) ? page.otp : [],
      captchaInput: Array.isArray(page.captchaInput) ? page.captchaInput : [],
      captchaImage: Array.isArray(page.captchaImage) ? page.captchaImage : [],
      submit: Array.isArray(page.submit) ? page.submit : [],
      provider: page.provider ?? null
    }
  };
}

// WHY THE WAIT ENDS ON THE PAGE AND NOT ON A CLOCK.
// The person signing in takes as long as they take, so the loop watches the gate and stops the moment it is gone; the budget is a ceiling, not a guess.
// Checks are also counted, so a sleep that returns at once cannot spin forever inside the budget.

export async function waitForGateClear(driver, { timeoutMs = 30000, intervalMs = 500, sleep = defaultSleep } = {}) {
  const startedAt = Date.now();
  const maxChecks = Math.max(2, Math.ceil(timeoutMs / Math.max(1, intervalMs)) + 1);
  const before = await detectGate(driver);
  let checks = 1;
  let after = before;
  if (before.gate === 'none') return { cleared: true, checks, before, after, why: '' };

  while (checks < maxChecks && Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    after = await detectGate(driver);
    checks += 1;
    if (after.gate === 'none') return { cleared: true, checks, before, after, why: '' };
  }

  return {
    cleared: false,
    checks,
    before,
    after,
    why: `the page still asks to sign in after ${Date.now() - startedAt} ms (gate: ${after.gate})`
  };
}

// WHY THE CREDENTIALS ARE READ FROM A FILE THE PERSON WROTE.
// The secret has to come from somewhere the model never sees, or the sign-in is the leak.
// So the account is matched by domain to the page it is on, the password is typed from disk and never returned, and a domain with no account refuses before a key is pressed.

function readAccounts(credentialsPath) {
  const wanted = String(credentialsPath ?? '').trim();
  if (!wanted) throw new Error('login needs credentialsPath: the JSON file that holds { accounts: [{ domain, username, password }] }.');
  const file = path.resolve(wanted);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`no credentials file at ${file} (${error.code ?? error.message}); write { accounts: [{ domain, username, password }] } and pass that path.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} is not JSON (${error.message}); it must hold { accounts: [{ domain, username, password }] }.`);
  }
  const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts.filter((account) => account && account.domain && account.username) : [];
  if (!accounts.length) throw new Error(`${file} holds no accounts; it must hold { accounts: [{ domain, username, password }] }.`);
  return accounts;
}

function domainOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function accountFor(accounts, host) {
  return accounts.find((account) => {
    const domain = String(account.domain ?? '').trim().toLowerCase();
    return domain && (host === domain || host.endsWith('.' + domain));
  }) ?? null;
}

// WHY THE USERNAME IS MASKED IN THE ANSWER.
// The answer travels back into the model's context, and the whole point is that the credential does not.
// So the account is named by its domain and the person by one letter and an ellipsis: enough to see that the right account was used, not enough to reuse.

function maskUser(username) {
  const value = String(username ?? '');
  const at = value.indexOf('@');
  if (at < 0) return value ? `${value.slice(0, 1)}***` : '';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export async function loginWithCredentials(driver, { credentialsPath, timeoutMs = 30000, intervalMs = 500, sleep = defaultSleep } = {}) {
  const accounts = readAccounts(credentialsPath);
  const before = await detectGate(driver);

  if (before.gate === 'otp') {
    throw new Error('the page asks for a one-time code, and the agent never answers one: ask the person for the code and let them sign in in this browser, then continue.');
  }
  if (!before.fields.password.length) {
    throw new Error(`no password field on ${before.url || 'this page'}; it is not asking to sign in, so there is nothing for credentialsPath to fill.`);
  }

  const host = domainOf(before.url);
  const account = accountFor(accounts, host);
  if (!account) {
    throw new Error(`no account for ${host || before.url} in the credentials file; add one before signing in, or sign in by hand.`);
  }

  const usernameField = before.fields.text[0] ?? null;
  const passwordField = before.fields.password[0];
  const submit = before.fields.submit[0] ?? null;

  // WHY A GET FORM IS REFUSED.
  // Measured live on 2026-11-05: the form submitted by GET, so the password came back in the address of the page - in the answer, in the history, in the server log, and in the referrer of every later request.
  // A secret that travels in a URL leaks, so the agent refuses to type into a form that puts it there and leaves the sign-in to the person.
  const method = String(passwordField.method ?? '').toLowerCase();
  if (method === 'get') {
    throw new Error(`the password field on ${before.url || 'this page'} sits in a form that submits by GET, so the password would travel in the URL; the agent refuses to put a secret in an address. Use a POST form, or sign in by hand.`);
  }

  if (usernameField) {
    await driver.click(usernameField.x, usernameField.y);
    await driver.type(String(account.username));
  }
  await driver.click(passwordField.x, passwordField.y);
  await driver.type(String(account.password));
  if (submit) await driver.click(submit.x, submit.y);

  const waited = await waitForGateClear(driver, { timeoutMs, intervalMs, sleep });
  return {
    signedIn: waited.cleared,
    account: host,
    user: maskUser(account.username),
    fields: { username: Boolean(usernameField), password: Boolean(passwordField), submit: Boolean(submit) },
    before: { url: before.url, title: before.title },
    after: { url: waited.after?.url ?? '', title: waited.after?.title ?? '' },
    checks: waited.checks,
    why: waited.cleared ? '' : waited.why
  };
}
