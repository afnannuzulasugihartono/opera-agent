// @last-edited: 2026-11-02 UTC+7.
// @title: gobiz-probe.test — the probe normalizes a phone number and sends the header set the server checks.
// @state: which phone formats reach the same account, and which headers the login call carries.
// @dependencies: node:test, strict, ../scripts/gobiz-probe.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { barePhone, deviceHeaders, dataHeaders } from '../scripts/gobiz-probe.mjs';

test('every phone format reaches the same bare national number', () => {
  assert.equal(barePhone('0812 3456 7890'), '81234567890');
  assert.equal(barePhone('+6281234567890'), '81234567890');
  assert.equal(barePhone('6281234567890'), '81234567890');
  assert.equal(barePhone('81234567890'), '81234567890');
});

test('a number that cannot be a phone number dies before any request', () => {
  assert.throws(() => barePhone(''), /phone number/);
  assert.throws(() => barePhone('123'), /phone number/);
  assert.throws(() => barePhone(null), /phone number/);
});

test('the login call carries the device header set the server checks', () => {
  const headers = deviceHeaders('token');
  assert.equal(headers.Authorization, 'Bearer token');
  assert.equal(headers['X-User-Type'], 'merchant');
  assert.equal(headers['x-appId'], 'go-biz-web-dashboard');
  assert.equal(headers['x-DeviceOS'], 'Web');
  assert.equal(headers['Gojek-Country-Code'], 'ID');
  assert.match(headers['X-AppVersion'], /^platform-v3\./);
  assert.match(headers['x-uniqueid'], /[0-9a-f-]{36}/);
});

test('a data call carries no device header', () => {
  const headers = dataHeaders('token');
  assert.equal(headers['X-User-Type'], undefined);
  assert.equal(headers['x-uniqueid'], undefined);
  assert.equal(headers['Authentication-Type'], 'go-id');
});
