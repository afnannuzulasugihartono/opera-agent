// @last-edited: 2026-11-05 UTC+7.
// @title: captcha-solver — the opt-in path that pays a service to read one captcha image, and refuses everything else.
// @state: one settings reader, one domain allowlist, one task-then-poll client over an injected fetch.
// @dependencies: none.

// WHY THIS MODULE IS OPT-IN AND SEPARATE.
// Reading a captcha for the person is a capability, not a default: it spends their money at a third party and defeats a control a site chose to put there.
// So it is off until the person sets three environment values, it only runs on the domains they named, and the gate that reported the captcha is the only caller.

// WHY THE DOMAIN ALLOWLIST IS NOT OPTIONAL.
// The same key would otherwise answer a captcha on any page an agent wandered onto, which is a paid action nobody agreed to.
// The list is what makes the spend the person's decision, per host, before the request leaves the machine.

// WHY THE SERVICE CONTRACT IS THE ONE EVERY SUCH SERVICE SPEAKS.
// createTask returns a task id, getTaskResult is polled until the solution is ready; the exact JSON shapes here are the ones a solver run by this product already uses, so pointing it at a compatible service needs no adapter.

export function solverSettings(env = {}) {
  const baseUrl = String(env.OPERA_CAPTCHA_API_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(env.OPERA_CAPTCHA_API_KEY ?? '').trim();
  const domains = String(env.OPERA_CAPTCHA_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return { baseUrl, apiKey, domains, configured: Boolean(baseUrl && apiKey && domains.length) };
}

export function captchaAllowed(settings, url) {
  if (!settings?.baseUrl || !settings?.apiKey || !Array.isArray(settings?.domains) || settings.domains.length === 0) return false;
  let host = '';
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return false;
  }
  return settings.domains.some((domain) => host === domain || host.endsWith('.' + domain));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY THE ANSWER IS READ AND NOT ASSUMED.
// A solver that returns errorId 0 with processing forever costs the person money and time, so the poll has a ceiling and says it came back without an answer rather than inventing one.
// A refusal from the service is raised with its own code, so a bad key reads as a bad key instead of a captcha that was simply hard.

export async function solveImageCaptcha({
  baseUrl,
  apiKey,
  image,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = 60000,
  pollMs = 2000
} = {}) {
  if (!baseUrl || !apiKey) throw new Error('the captcha solver is not configured: set OPERA_CAPTCHA_API_URL and OPERA_CAPTCHA_API_KEY.');
  if (!image) throw new Error('solveImageCaptcha needs the captcha image as base64 in image.');

  const post = async (method, body) => {
    const reply = await fetchImpl(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!reply?.ok) throw new Error(`the captcha solver answered HTTP ${reply?.status ?? '?'} for ${method}`);
    return reply.json();
  };

  const created = await post('createTask', { clientKey: apiKey, task: { type: 'ImageToText', body: image } });
  if (created?.errorId) {
    throw new Error(`the captcha solver refused the task: ${created.errorCode ?? 'unknown'}: ${created.errorDescription ?? 'no description'}`);
  }
  const taskId = created?.taskId;
  if (!taskId) throw new Error('the captcha solver answered createTask without a task id');

  const startedAt = Date.now();
  const maxChecks = Math.max(2, Math.ceil(timeoutMs / Math.max(1, pollMs)) + 1);
  let checks = 0;
  while (checks < maxChecks && Date.now() - startedAt < timeoutMs) {
    if (checks > 0) await sleep(pollMs);
    checks += 1;
    const result = await post('getTaskResult', { clientKey: apiKey, taskId });
    if (result?.errorId) {
      throw new Error(`the captcha solver refused the task: ${result.errorCode ?? 'unknown'}: ${result.errorDescription ?? 'no description'}`);
    }
    if (result?.status === 'ready') {
      const text = result?.solution?.text;
      if (!text) throw new Error('the captcha solver answered ready without a solution text');
      return { text: String(text), taskId, checks };
    }
  }

  throw new Error(`the captcha solver came back without an answer for task ${taskId} within ${timeoutMs} ms`);
}
