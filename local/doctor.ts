// @last-edited: 2026-11-09 UTC+7.
// @title: doctor - the operator's one question about this machine, answered in words.
// @state: the bridge's state, the device's meter, the pairing, the cloud login, and the CRX link.
// @dependencies: ./wallet-client.js, ./oauth.js, ./lib/endpoints.js.

// WHY THIS FILE EXISTS

// An install that cannot say what it is doing misleads the operator into debugging the wrong thing: a missing pairing looks like a broken install, and a refused meter looks like a broken extension.
// The doctor reads the only state that is real - the loopback bridge's own health answer, the paired device file, and the cloud login - and prints one line per answer, plus the one fix that applies.

import { readDevice } from './wallet-client.js';
import { readStoredToken } from './oauth.js';
import { UPDATE_BASE_URL } from './lib/endpoints.js';

const CRX_URL = `${UPDATE_BASE_URL}/download/opera-agent.crx`;
const PROBE_TIMEOUT_MS = 2000;

interface BridgeProbe {
  ok: boolean;
  error?: string;
  health?: unknown;
}

async function probeBridge(port: number, fetchImpl: typeof fetch): Promise<BridgeProbe> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, error: `the bridge answered ${response.status}` };
    return { ok: true, health: await response.json().catch(() => null) };
  } catch (error: unknown) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export async function doctor({ env = process.env, stdout = process.stdout, fetchImpl = fetch }: { env?: NodeJS.ProcessEnv; stdout?: { write(chunk: string): unknown }; fetchImpl?: typeof fetch } = {}): Promise<number> {
  const port = Number(env.OPERA_BRIDGE_PORT || 9451);
  const home = typeof env.OPERA_AGENT_HOME === 'string' ? env.OPERA_AGENT_HOME : undefined;
  const lines: string[] = [];
  const problems: string[] = [];
  const say = (label: string, value: unknown) => lines.push(`${label.padEnd(14)}${String(value)}`);

  const paired = readDevice(home === undefined ? {} : { home });
  say('device file', paired ? `paired as ${paired.deviceName} (wallet and hosted tools use it)` : 'none (only the wallet and hosted tools need it)');

  const envToken = typeof env.OPERA_AGENT_MCP_TOKEN === 'string' && env.OPERA_AGENT_MCP_TOKEN.trim();
  const stored = envToken ? null : readStoredToken(env);
  if (envToken) {
    say('cloud login', 'OPERA_AGENT_MCP_TOKEN (a static token from the environment)');
  } else if (stored) {
    say('cloud login', `signed in (token expires ${new Date(Number(stored.expires_at) || 0).toISOString()})`);
  } else {
    say('cloud login', 'not signed in — cloud mode needs it (`opera-agent-mcp auth`, or OPERA_AGENT_MCP_TOKEN)');
  }

  const probe = await probeBridge(port, fetchImpl);
  if (!probe.ok) {
    say('bridge', `not listening on 127.0.0.1:${port} (${probe.error})`);
    problems.push('start the everyday browser with the Opera Agent extension installed');
  } else {
    const health = (probe.health ?? {}) as Record<string, unknown>;
    const devices = (Array.isArray(health.devices) ? health.devices : []) as Array<Record<string, unknown>>;
    const linked = health.linked === true;
    const refusal = typeof health.meterRefusal === 'string' && health.meterRefusal.trim() ? health.meterRefusal.trim() : null;
    say('bridge', devices.length
      ? `listening on 127.0.0.1:${port}; ${devices.length} device(s) linked`
      : linked
        ? `listening on 127.0.0.1:${port}; linked to a bridge from before the meter — restart the driver and reload the extension`
        : `listening on 127.0.0.1:${port}; nothing linked`);
    if (refusal) {
      say('meter', refusal);
      problems.push('the meter refused the session — update the extension to 1.6.32 (the everyday browser sends its paired credentials there) and reload it');
    }
    if (!devices.length && !refusal) {
      problems.push(linked
        ? 'the bridge runs pre-meter code — restart the driver process so it can report the session'
        : 'the extension is not linked to this bridge; reload the everyday browser with Opera Agent installed');
    }
    const preferRaw = (health as Record<string, unknown>).preferredSlot;
    say('preferred', typeof preferRaw === 'number' ? `slot ${preferRaw} (tab-less commands follow it)` : 'none (tab-less commands follow the first ready browser)');
    for (const device of devices) {
      const slot = device?.slot ?? '?';
      say(`device ${slot}`, `version ${device?.extensionVersion ?? 'unknown (the hello carried none)'}; id ${device?.id ?? 'unknown'}`);
      const meter = device?.meter as Record<string, unknown> | undefined;
      if (meter) {
        say('  plan', `${meter.plan}`);
        say('  allowance', `${meter.allowance} commands per session (this session sent ${meter.sent ?? 0})`);
        say('  daily quota', `${meter.dailyQuota} per day (${meter.usedToday ?? 0} used today across surfaces, ${meter.sent ?? 0} this session, ${meter.remaining ?? 0} left)`);
      } else {
        say('  meter', 'no session metered yet (a fresh bridge has not heard a hello)');
        problems.push('reload the everyday browser so its hello reaches the bridge');
      }
    }
  }

  say('CRX download', CRX_URL);

  const ready = problems.length === 0;
  say('verdict', ready ? 'ready' : `degraded: ${problems[0]}`);
  for (const problem of problems.slice(1)) say('  also', problem);
  stdout.write(`opera-agent-mcp doctor\n\n${lines.join('\n')}\n`);
  return ready ? 0 : 1;
}
