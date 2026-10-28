// @last-edited: 2026-10-28 UTC+7.
// @title: local-leases — the tab claim: who holds a tab, who is refused, and when a silent agent loses it.
// @state: one claim per tab, renewed by every call, released by its owner, and expired by the clock.
// @dependencies: ../local/leases.js.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createLeaseTable, DEFAULT_TTL_MS } from '../local/leases.js';

const clock = () => {
  let at = 1000;
  return { now: () => at, advance: (ms) => { at += ms; } };
};

describe('the tab claim', () => {
  test('a fresh claim is granted to the agent that asked', () => {
    const leases = createLeaseTable();
    const answer = leases.claim('7', 'agent-a');

    assert.equal(answer.granted, true);
    assert.equal(answer.holder.owner, 'agent-a');
    assert.equal(leases.state('7').owner, 'agent-a');
  });

  test('a second agent is refused, and the refusal names the holder and the expiry', () => {
    const leases = createLeaseTable({ ttlMs: 5000 });
    leases.claim('7', 'agent-a', 5000);

    const answer = leases.claim('7', 'agent-b');

    assert.equal(answer.granted, false, 'the tab is held');
    assert.equal(answer.holder.owner, 'agent-a', 'and the refusal says by whom');
    assert.equal(answer.holder.expiresAt - Date.now() < 5000 + 5000, true, 'and until when');
    assert.equal(leases.state('7').owner, 'agent-a', 'and the claim is unchanged');
  });

  test('the same agent claiming again is a renewal, not a refusal', () => {
    const { now, advance } = clock();
    const leases = createLeaseTable({ ttlMs: 1000, now });
    const first = leases.claim('7', 'agent-a');
    advance(900);
    const second = leases.claim('7', 'agent-a');

    assert.equal(second.granted, true, 'the holder keeps its own tab');
    assert.ok(second.holder.expiresAt > first.holder.expiresAt, 'and its expiry moves with the work');
  });

  test('a claim past its window is gone, so the next agent gets the tab', () => {
    const { now, advance } = clock();
    const leases = createLeaseTable({ ttlMs: 1000, now });
    leases.claim('7', 'agent-a');
    advance(1000);

    assert.equal(leases.state('7'), null, 'the silent agent no longer holds the tab');
    const answer = leases.claim('7', 'agent-b');
    assert.equal(answer.granted, true, 'and the next agent is not kept out by a ghost');
  });

  test('a release frees the tab at once, but only for the owner that holds it', () => {
    const leases = createLeaseTable();
    leases.claim('7', 'agent-a');

    assert.equal(leases.release('7', 'agent-b'), false, 'another agent cannot evict the holder');
    assert.equal(leases.state('7').owner, 'agent-a', 'and the claim stands');
    assert.equal(leases.release('7', 'agent-a'), true, 'the holder gives the tab up');
    assert.equal(leases.state('7'), null, 'and it is free for anyone');
  });

  test('a second tab is a second claim, so parallel agents work side by side', () => {
    const leases = createLeaseTable();
    leases.claim('7', 'agent-a');

    assert.equal(leases.claim('8', 'agent-b').granted, true, 'a different tab is a different claim');
    assert.equal(leases.release('8', null), true, 'and a claim with no owner named still releases');
    assert.equal(leases.state('7').owner, 'agent-a', 'while the first claim is untouched');
  });

  test('the default window is long enough for a drive and short enough to clear', () => {
    assert.equal(DEFAULT_TTL_MS, 60000);
    const leases = createLeaseTable();
    leases.claim('7', 'agent-a');
    assert.ok(leases.state('7').expiresAt > Date.now(), 'the claim outlives the call that made it');
  });
});
