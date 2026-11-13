// @last-edited: 2026-11-04 UTC+7.
// @title: local-wallet-tools — a declared wallet tool is a branch the local server actually answers.
// @state: the seven tools, their required arguments, and the order that keeps them reachable with the browser closed.
// @dependencies: node:test, node:assert/strict, node:fs, ../local/tools.js.

// WHY THE DECLARATION AND THE BRANCH ARE CHECKED TOGETHER.
// A tool listed but not handled answers nothing, and the agent reads that as a refusal with no reason.
// The wallet tools are also the only ones that must work with no tab open, so their branch has to come before the tab is resolved.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { TOOLS } from '../../local/tools.js';

const server = fs.readFileSync(new URL('../../local/mcp-server.js', import.meta.url), 'utf8');
const WALLET_TOOLS = ['wallet_pair', 'wallet_balance', 'wallet_quote', 'wallet_top_up', 'task_reserve', 'task_settle', 'task_refund'];

test('every wallet tool is declared once', () => {
  const names = TOOLS.map((tool) => tool.name);
  for (const name of WALLET_TOOLS) {
    assert.equal(names.filter((candidate) => candidate === name).length, 1, `${name} must be declared exactly once`);
  }
});

test('every declared wallet tool has a branch in the server', () => {
  for (const name of WALLET_TOOLS) {
    assert.match(server, new RegExp(`name === '${name}'`), `${name} is advertised but never answered`);
  }
});

test('a tool that spends money states what it needs', () => {
  const required = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.inputSchema.required || []]));
  assert.deepEqual(required.task_reserve, ['artifact', 'estSteps']);
  assert.deepEqual(required.task_settle, ['reservationId', 'artifactHash']);
  assert.deepEqual(required.task_refund, ['reservationId', 'reason']);
  assert.deepEqual(required.wallet_pair, ['code', 'deviceName']);
  assert.deepEqual(required.wallet_balance, []);
});

test('the wallet answers before a tab is resolved, because a wallet has no tab', () => {
  const walletBranch = server.indexOf("name === 'wallet_balance'");
  const tab = server.indexOf('const tab = name === \'close_tab\'');
  assert.ok(walletBranch > 0 && tab > 0, 'both the wallet branch and the tab resolution must exist');
  assert.ok(walletBranch < tab, 'a wallet call that needed a tab would fail with the browser closed');
});
