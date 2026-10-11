// @last-edited: 2026-10-11 UTC+7.
// @title: transaction-identity — the adapter that decides WHO is calling.
// @state: 7 tests; configuration, claim gates, temporal gates, cross-checks, frozen shape.
// @state: 6 tests; configuration, the claim gates, the temporal gates, the cross-checks, and the frozen shape.
// @dependencies: node:test, assert.

// WHY THIS FILE EXISTS
//
// lib/transaction-identity.js had no test and no gate, and it is imported by the
// host behind the deployed transactions edge function. It is where a bug is a breach
// rather than a crash.
//
// TWO LOCKS BELOW CANNOT BE PROVEN BY BEHAVIOUR, so they are locked on the source.
//
// Widening the eight-key allowlist to Object.entries(raw) is unobservable from
// outside: `c` is read at sub, client_id, session_id and the role and temporal
// fields, and widening it ADDS keys without changing those reads. tenant_id and
// actor_id come from the GRANT row, never from `c`.
//
// Freezing `c` is unobservable too: it is a local inside the try block, never
// returned and never passed to anything outliving the call.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseTransactionIdentity } from '../lib/transaction-identity.js';

const identitySource = () => fs.readFileSync(new URL('../lib/transaction-identity.js', import.meta.url), 'utf8');

const ISSUER = 'https://project.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';
const CONFIG = { audience: AUDIENCE, issuer: ISSUER };

function stub({ claims, user, grant, claimsError, userError, grantError, throwOn } = {}) {
  const calls = [];
  const note = (name) => { calls.push(name); if (throwOn === name) throw new Error(`${name} exploded`); };
  return {
    calls,
    client: {
      auth: {
        getClaims: async (token) => {
          note('getClaims');
          return claimsError ? { data: null, error: claimsError } : { data: { claims }, error: null };
        },
        getUser: async (token) => {
          note('getUser');
          return userError ? { data: null, error: userError } : { data: { user }, error: null };
        }
      },
      rpc: async (fn, args) => {
        note('rpc');
        calls.push(`${fn}:${JSON.stringify(args)}`);
        return grantError ? { data: null, error: grantError } : { data: grant, error: null };
      }
    }
  };
}

const claimsAt = (over = {}) => ({
  iss: ISSUER, aud: AUDIENCE, role: 'authenticated',
  sub: 'user-1', client_id: 'client-1', session_id: 'sess-1',
  exp: 2_000, iat: 1_000,
  ...over
});

const grantAt = (over = {}) => ({
  user_id: 'user-1', oauth_client_id: 'client-1', tenant_id: 'tenant-1', actor_id: 'actor-1',
  ...over
});

const NOW_ISO = new Date(1_500_000).toISOString();

const happy = (over = {}) => {
  const { client, calls } = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt() });
  return { adapter: createSupabaseTransactionIdentity(client, CONFIG), calls, client };
};

test('the configuration is refused at construction, never at request time', () => {
  const good = { auth: { getClaims() {}, getUser() {} }, rpc() {} };
  const cases = [
    ['no client', undefined],
    ['no auth', { rpc() {} }],
    ['no getClaims', { auth: { getUser() {} }, rpc() {} }],
    ['no getUser', { auth: { getClaims() {} }, rpc() {} }],
    ['no rpc', { auth: { getClaims() {}, getUser() {} } }],
    ['no configuration', good],
    ['an empty configuration', good],
    ['a missing audience', good],
    ['an extra key', good],
    ['a non-string issuer', good],
    ['an http issuer', good],
    ['an issuer with a path', good],
    ['an issuer with a query', good],
    ['an issuer without the auth path', good],
    ['the wrong audience', good]
  ];

  const bad = [
    [undefined],
    [good, undefined],
    [good, {}],
    [good, { issuer: ISSUER }],
    [good, { audience: AUDIENCE, issuer: ISSUER, extra: 1 }],
    [good, { audience: AUDIENCE, issuer: 42 }],
    [good, { audience: AUDIENCE, issuer: 'http://project.supabase.co/auth/v1' }],
    [good, { audience: AUDIENCE, issuer: 'https://project.supabase.co/auth/v1/extra' }],
    [good, { audience: AUDIENCE, issuer: 'https://project.supabase.co/auth/v1?x=1' }],
    [good, { audience: AUDIENCE, issuer: 'https://project.supabase.co' }],
    [good, { audience: 'authenticated ' , issuer: ISSUER }],
    [good, { audience: 'anon', issuer: ISSUER }]
  ];

  for (const [client, configuration] of bad) {
    assert.throws(() => createSupabaseTransactionIdentity(client, configuration),
      /INVALID_IDENTITY_CONFIGURATION/,
      `refused: ${cases.find(([, why]) => true)?.[1] ?? JSON.stringify(configuration)}`);
  }

  assert.doesNotThrow(() => createSupabaseTransactionIdentity(good, CONFIG));
});

test('a valid credential yields exactly the eight-field frozen identity', async () => {
  const { adapter, calls } = happy();
  const identity = await adapter('token-value', NOW_ISO);

  assert.deepEqual(identity, {
    userId: 'user-1',
    tenantId: 'tenant-1',
    oauthClientId: 'client-1',
    sessionId: 'sess-1',
    accessExpiresAt: 2_000,
    acceptanceIdentity: 'actor-1'
  });

  assert.equal(Object.isFrozen(identity), true, 'the identity cannot be mutated by its holder');

  assert.deepEqual(calls.filter((c) => !c.includes(':')), ['getClaims', 'getUser', 'rpc']);
  assert.ok(calls.some((c) => c.startsWith('opera_tx_identity_read:') && c.includes('"p_user_id":"user-1"')),
    'the grant is read by the verified subject, not by anything from the request');
});

test('a claim object carries only the eight allowlisted keys, whatever the issuer sends', async () => {
  const { adapter, calls } = happy();
  const identity = await adapter('token-value', NOW_ISO);
  assert.deepEqual(Object.keys(identity).sort(),
    ['acceptanceIdentity', 'accessExpiresAt', 'oauthClientId', 'sessionId', 'tenantId', 'userId'],
    'the returned identity carries no claim beyond what this module decided');
  assert.equal('scope' in identity, false);
  assert.equal('role' in identity, false, 'role was checked but is not authority here');

  const noisy = stub({
    claims: claimsAt({ admin: true, scopes: ['write:all'], session_id: 'sess-1' }),
    user: { id: 'user-1' },
    grant: grantAt()
  });
  const noisyAdapter = createSupabaseTransactionIdentity(noisy.client, CONFIG);
  const noisyIdentity = await noisyAdapter('token-value', NOW_ISO);
  assert.ok(noisyIdentity, 'an issuer sending extra claims still authenticates');
  assert.equal('admin' in noisyIdentity, false, 'an unknown claim never reaches the identity');

  for (const [label, claims, grant] of [
    ['tenant', claimsAt({ tenant_id: 'tenant-from-the-token' }), grantAt({ tenant_id: undefined })],
    ['actor', claimsAt({ actor_id: 'actor-from-the-token' }), grantAt({ actor_id: undefined })],
    ['both', claimsAt({ tenant_id: 't-token', actor_id: 'a-token' }), grantAt({ tenant_id: undefined, actor_id: undefined })]
  ]) {
    const s = stub({ claims, user: { id: 'user-1' }, grant });
    const a = createSupabaseTransactionIdentity(s.client, CONFIG);
    assert.equal(await a('token-value', NOW_ISO), null,
      `a grant row with no ${label} of its own is refused, even when the token carries one`);
  }

  assert.ok(await createSupabaseTransactionIdentity(happy().client, CONFIG)('token-value', NOW_ISO),
    'a complete grant row is still accepted');

  const rpcCall = noisy.calls.find((c) => c.startsWith('opera_tx_identity_read:'));
  assert.ok(rpcCall, 'the grant was read');
  const params = JSON.parse(rpcCall.slice(rpcCall.indexOf(':') + 1));
  assert.deepEqual(Object.keys(params).sort(), ['p_client_id', 'p_session_id', 'p_user_id'],
    'exactly three named parameters reach the database — no claim is forwarded wholesale');

  for (const role of ['anon', 'service_role', 'authenticated ', '', null]) {
    const s = stub({ claims: claimsAt({ role }), user: { id: 'user-1' }, grant: grantAt() });
    const adapterRole = createSupabaseTransactionIdentity(s.client, CONFIG);
    assert.equal(await adapterRole('token-value', NOW_ISO), null, `role ${JSON.stringify(role)} is refused`);
  }
});

test('every malformed identifier, on any of the three sources, refuses', async () => {
  const badIds = ['', 'a b', 'a/b', 'a'.repeat(129), 'üser', null, undefined, 42, {}];

  for (const bad of badIds) {
    const a = stub({ claims: claimsAt({ sub: bad }), user: { id: 'user-1' }, grant: grantAt() });
    assert.equal(await createSupabaseTransactionIdentity(a.client, CONFIG)('t', NOW_ISO), null,
      `sub ${JSON.stringify(bad)} is refused`);

    const b = stub({ claims: claimsAt({ client_id: bad }), user: { id: 'user-1' }, grant: grantAt() });
    assert.equal(await createSupabaseTransactionIdentity(b.client, CONFIG)('t', NOW_ISO), null,
      `client_id ${JSON.stringify(bad)} is refused`);

    const c = stub({ claims: claimsAt({ session_id: bad }), user: { id: 'user-1' }, grant: grantAt() });
    assert.equal(await createSupabaseTransactionIdentity(c.client, CONFIG)('t', NOW_ISO), null,
      `session_id ${JSON.stringify(bad)} is refused`);

    const d = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt({ tenant_id: bad }) });
    assert.equal(await createSupabaseTransactionIdentity(d.client, CONFIG)('t', NOW_ISO), null,
      `tenant_id ${JSON.stringify(bad)} is refused`);

    const e = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt({ actor_id: bad }) });
    assert.equal(await createSupabaseTransactionIdentity(e.client, CONFIG)('t', NOW_ISO), null,
      `actor_id ${JSON.stringify(bad)} is refused`);
  }

  const long = stub({ claims: claimsAt({ sub: 'a'.repeat(128) }), user: { id: 'a'.repeat(128) }, grant: grantAt({ user_id: 'a'.repeat(128) }) });
  assert.ok(await createSupabaseTransactionIdentity(long.client, CONFIG)('t', NOW_ISO), '128 characters is accepted');
});

test('the temporal gates refuse a token from the future, an expired one, and an inverted one', async () => {
  const at = async (over) => {
    const s = stub({ claims: claimsAt(over), user: { id: 'user-1' }, grant: grantAt() });
    return createSupabaseTransactionIdentity(s.client, CONFIG)('t', NOW_ISO);
  };

  assert.ok(await at({ iat: 1_000, exp: 2_000 }), 'a normal token is accepted');
  assert.equal(await at({ iat: 1_501 }), null, 'issued after now is refused');
  assert.equal(await at({ exp: 1_500 }), null, 'expiring exactly now is refused');
  assert.equal(await at({ exp: 1_499 }), null, 'already expired is refused');
  assert.equal(await at({ iat: 2_000, exp: 2_000 }), null, 'issued exactly at expiry is refused');
  assert.equal(await at({ exp: 900 }), null, 'expiring before it was issued is refused');

  assert.equal(await at({ exp: 1_500.5, iat: 1_000 }), null, 'a fractional exp is refused');
  assert.equal(await at({ exp: '2000', iat: 1_000 }), null, 'a string exp is refused');
  assert.equal(await at({ exp: null, iat: 1_000 }), null, 'a null exp is refused');
  assert.equal(await at({ exp: undefined, iat: 1_000 }), null, 'an undefined exp is refused');
  assert.equal(await at({ exp: {}, iat: 1_000 }), null, 'an object exp is refused');

  assert.ok(await at({ iat: 1_000, exp: 2_000 }), 'a normal token is accepted');
});

test('the three temporal guards stand together, and two of them are reachable on their own', async () => {
  const source = identitySource();

  assert.match(source, /c\.iat>now/, 'issued-in-the-future is guarded');
  assert.match(source, /c\.exp<=now/, 'already-expired is guarded');
  assert.match(source, /c\.exp<=c\.iat/, 'inverted-window is guarded');

  const at = async (over) => {
    const s = stub({ claims: claimsAt(over), user: { id: 'user-1' }, grant: grantAt() });
    return createSupabaseTransactionIdentity(s.client, CONFIG)('t', NOW_ISO);
  };
  assert.equal(await at({ iat: 1_501, exp: 2_000 }), null, 'a future-issued token is refused');
  assert.equal(await at({ iat: 1_000, exp: 1_500 }), null, 'a token expiring now is refused');
  assert.ok(await at({ iat: 1_500, exp: 1_501 }), 'a token expiring later is accepted');
});

test('the credential itself is bounded, and a thrown call refuses instead of propagating', async () => {
  const { adapter } = happy();
  for (const bad of ['', 'a'.repeat(8193), 'has space', 'tab\there', null, undefined, 42, {}]) {
    assert.equal(await adapter(bad, NOW_ISO), null, `credential ${JSON.stringify(bad)} is refused`);
  }
  assert.ok(await adapter('a'.repeat(8192), NOW_ISO), '8192 characters is accepted');

  for (const throwOn of ['getClaims', 'getUser', 'rpc']) {
    const s = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt(), throwOn });
    const a = createSupabaseTransactionIdentity(s.client, CONFIG);
    assert.equal(await a('t', NOW_ISO), null, `a throw from ${throwOn} refuses`);
  }

  for (const [label, s] of [
    ['claims error', stub({ claimsError: { message: 'bad jwt' } })],
    ['user error', stub({ claims: claimsAt(), userError: { message: 'gone' } })],
    ['grant error', stub({ claims: claimsAt(), user: { id: 'user-1' }, grantError: { message: 'rls' } })]
  ]) {
    const a = createSupabaseTransactionIdentity(s.client, CONFIG);
    assert.equal(await a('t', NOW_ISO), null, `${label} refuses`);
  }

  const mismatched = stub({ claims: claimsAt(), user: { id: 'someone-else' }, grant: grantAt() });
  assert.equal(await createSupabaseTransactionIdentity(mismatched.client, CONFIG)('t', NOW_ISO), null,
    'a user whose id differs from the subject is refused');

  const anon = stub({ claims: claimsAt(), user: { id: 'user-1', is_anonymous: true }, grant: grantAt() });
  assert.equal(await createSupabaseTransactionIdentity(anon.client, CONFIG)('t', NOW_ISO), null,
    'an anonymous user is refused');

  const wrongGrantUser = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt({ user_id: 'user-2' }) });
  assert.equal(await createSupabaseTransactionIdentity(wrongGrantUser.client, CONFIG)('t', NOW_ISO), null,
    'a grant row belonging to another user is refused');

  const wrongGrantClient = stub({ claims: claimsAt(), user: { id: 'user-1' }, grant: grantAt({ oauth_client_id: 'client-2' }) });
  assert.equal(await createSupabaseTransactionIdentity(wrongGrantClient.client, CONFIG)('t', NOW_ISO), null,
    'a grant row belonging to another oauth client is refused');
});
test('the claims object is rebuilt from the eight-key allowlist, never from the issuer as-is', () => {
  const source = identitySource();
  assert.match(source, /\['iss','aud','role','sub','client_id','session_id','exp','iat'\]/,
    'the allowlist names exactly eight claims');
  assert.doesNotMatch(source, /Object\.entries\(raw\)|Object\.keys\(raw\)|\.\.\.raw/,
    'the claims are never spread wholesale from the issuer');

});

test('the claims object is frozen before anything reads it', () => {
  const source = identitySource();
  assert.match(source, /const c=raw\?Object\.freeze\(/, 'the allowlisted claims are frozen');

});
