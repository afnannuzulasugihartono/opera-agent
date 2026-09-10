import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url);
const configUrl = new URL('../supabase/functions/opera-agent-mcp/deno.json', import.meta.url);
const authUrl = new URL('../supabase/functions/opera-agent-auth/index.ts', import.meta.url);
const consentUrl = new URL('../oauth-consent/index.html', import.meta.url);
const vercelConfigUrl = new URL('../oauth-consent/vercel.json', import.meta.url);
const supabaseConfigUrl = new URL('../supabase/config.toml', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const authSource = await readFile(authUrl, 'utf8');
const consentSource = await readFile(consentUrl, 'utf8');
const vercelConfig = JSON.parse(await readFile(vercelConfigUrl, 'utf8'));
const supabaseConfig = await readFile(supabaseConfigUrl, 'utf8');

test('MCP dependencies are pinned', () => {
  for (const specifier of Object.values(config.imports)) {
    assert.match(specifier, /@[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.doesNotMatch(specifier, /@(latest|next)$/);
  }
});

test('MCP exposes focused browser tools and no generic command escape hatch', () => {
  const tools = [...source.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools, [
    'browser_status', 'run_browser_burst', 'list_tabs', 'open_url', 'activate_tab', 'navigate_tab', 'close_tab',
    'read_page', 'capture_page', 'find_elements', 'click_element', 'fill_element', 'press_key', 'scroll_page',
    'move_pointer', 'click_at', 'drag_pointer', 'wheel_at'
  ]);
  assert.equal(new Set(tools).size, tools.length);
  assert.doesNotMatch(source, /registerTool\("(?:run_command|execute_command|raw_command)"/);
});

test('MCP requires bearer auth and never exposes the service role key', () => {
  assert.match(source, /if \(!await authenticate\(req\)\) return unauthorized\(req\)/);
  assert.match(source, /OPERA_AGENT_MCP_TOKEN/);
  assert.match(source, /OPERA_AGENT_MCP_USER_IDS/);
  assert.match(source, /OPERA_AGENT_MCP_USER_EMAILS/);
  assert.doesNotMatch(source, /SERVICE_ROLE_KEY[^\n]*(?:content|structuredContent|console\.log)/);
});

test('OAuth protected-resource metadata uses the canonical public function URL', () => {
  assert.match(source, /SUPABASE_URL\.replace\(\/\\\/\$\/, ""\)\}\/functions\/v1\/opera-agent-mcp/);
  assert.match(source, /resource: publicBaseUrl\(\)/);
});

test('MCP delegates only known Opera Agent methods', () => {
  const methods = [...source.matchAll(/execute\("([a-z.]+)"/g)].map((match) => match[1]);
  const allowed = new Set([
    'browser.ping', 'browser.burst', 'tabs.list', 'tabs.open', 'tabs.activate', 'tabs.navigate', 'tabs.close',
    'page.read', 'page.capture', 'page.find', 'page.click', 'page.fill', 'page.key', 'page.scroll', 'page.pointer'
  ]);
  assert.ok(methods.length >= 16);
  for (const method of methods) assert.ok(allowed.has(method), `unexpected method ${method}`);
});

test('MCP instructions make browser usage discoverable without mentioning Supabase', () => {
  assert.match(source, /Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect/);
  assert.match(source, /open_url defaults to an inactive tab, retain its returned tabId/);
  assert.match(source, /Never substitute the user's active tab during a multi-step task/);
  assert.match(source, /Never use activate_tab as an implicit recovery step/);
  assert.match(source, /Coordinate actions default to invisible background CDP input/);
  assert.match(source, /Use capture_page adaptively only/);
  assert.match(source, /pass previousHash to avoid retransmitting unchanged images/);
  assert.match(source, /If a tool returns FOREGROUND_REQUIRED/);
  assert.match(source, /Supabase is internal transport and should not be mentioned/);
});

test('MCP returns screenshots as image content without duplicating base64 in structured metadata', () => {
  assert.match(source, /type: "image", data, mimeType/);
  assert.match(source, /delete metadataScreenshot\.data/);
  assert.match(source, /runCommand\("page\.capture"/);
  assert.match(source, /method === "page\.capture" \? "opera_await_capture" : "opera_await"/);
  assert.match(source, /user-private, password, OTP, payment/);
  assert.doesNotMatch(source, /captureVisibleTab/);
});

test('MCP defaults to background tabs and requires explicit automation targets', () => {
  assert.match(source, /active: active \?\? false/);
  assert.doesNotMatch(source, /active: active \?\? true/);
  assert.match(source, /const tabIdSchema = z\.number\(\)\.int\(\)\.nonnegative\(\)/);
  assert.doesNotMatch(source, /const tabIdSchema[^\n]*\.optional\(\)/);
  assert.match(source, /z\.enum\(\["background", "foreground"\]\)\.optional\(\)/);
  assert.doesNotMatch(source, /"auto"/);
  assert.match(source, /executionMode: executionMode \?\? "background"/);
  assert.match(source, /value, trusted: true, executionMode/);
  assert.match(source, /Background mode is invisible and does not activate the tab/);
});

test('MCP preserves structured command failures for foreground permission handling', () => {
  assert.match(source, /class CommandFailure extends Error/);
  assert.match(source, /code: error\.code, message: error\.message/);
  assert.match(source, /throw new CommandFailure\(code, message/);
  assert.match(source, /structuredContent = \{ ok: false, error: failure \}/);
});

test('MCP burst schema is bounded and does not expose arbitrary commands or code', () => {
  assert.match(source, /z\.array\(burstStepSchema\)\.min\(1\)\.max\(8\)/);
  assert.match(source, /cannot open, navigate, close, loop, branch, or execute JavaScript/);
  assert.doesNotMatch(source, /browser\.plan/);
});

test('OAuth config endpoint exposes only public client configuration', () => {
  assert.match(authSource, /SUPABASE_ANON_KEY/);
  assert.match(authSource, /Access-Control-Allow-Origin/);
  assert.match(authSource, /opera-agent-auth-config/);
  assert.doesNotMatch(authSource, /SERVICE_ROLE|OPERA_AGENT_MCP_TOKEN/);
});

test('hosted OAuth consent artifact has no embedded privileged secret', () => {
  assert.match(consentSource, /@supabase\/supabase-js@2\.116\.0/);
  assert.match(consentSource, /opera-agent-auth\/config/);
  assert.match(consentSource, /getAuthorizationDetails/);
  assert.match(consentSource, /approveAuthorization/);
  assert.match(consentSource, /denyAuthorization/);
  assert.doesNotMatch(consentSource, /service_role|OPERA_AGENT_MCP_TOKEN|eyJhbGci/);
  assert.match(consentSource, /session\?\.user\?\.is_anonymous/);
  assert.match(consentSource, /data\.user\?\.is_anonymous/);
  assert.match(consentSource, /signOut\(\{ scope: 'local' \}\)/);
  assert.equal(vercelConfig.rewrites[0].source, '/oauth/consent');
  assert.equal(vercelConfig.rewrites[0].destination, '/');
  assert.ok(vercelConfig.headers[0].headers.some((header) => header.key === 'Content-Security-Policy'));
});

test('hosted OAuth consent module has valid JavaScript syntax', () => {
  const moduleSource = consentSource.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
  const parseableSource = moduleSource.replace(/^\s*import\s+.*?;\s*$/m, '');
  assert.doesNotThrow(() => new Function(`return (async () => {${parseableSource}\n})`));
});

test('Supabase OAuth config declares a hosted consent page and dynamic registration', () => {
  assert.match(supabaseConfig, /\[auth\.oauth_server\]/);
  assert.match(supabaseConfig, /enabled = true/);
  assert.match(supabaseConfig, /authorization_path = "\/oauth\/consent"/);
  assert.match(supabaseConfig, /allow_dynamic_registration = true/);
});
