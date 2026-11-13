// @last-edited: 2026-11-13 UTC+7.
// @title: reactive-vm-core - the one guard factory the VM family shares.
// @state: the three VM modules (collect, control-flow, host) carried the same eleven helpers verbatim; this is the only copy.
// @dependencies: ./secret-pattern.js, ../hosted/functions/_shared/goal-ledger.js.

import { canonicalJson } from '../hosted/functions/_shared/goal-ledger.js';
import { SECRET_VALUE } from './secret-pattern.js';

// WHY A FACTORY AND NOT A DEFAULT CODE ARGUMENT.
// The collect and control-flow modules fail programs with INVALID_SEMANTICS; the host fails with INVALID_SCHEMA.
// One guard set, parameterized at construction, keeps the call sites byte-identical.

export class ReactiveVmError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReactiveVmError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;

export function makeGuards(defaultCode) {
  const fail = (code, message, details) => {
    throw new ReactiveVmError(code, message, details);
  };

  const isPlainObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const assertPlainObject = (value, path, code = defaultCode) => {
    if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
  };

  const assertExactKeys = (value, required, optional, path, code = defaultCode) => {
    assertPlainObject(value, path, code);
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
    }
    for (const key of required) {
      if (!(key in value)) fail(code, `${path}.${key} is required.`);
    }
  };

  const byteLength = (value) => new TextEncoder().encode(value).length;

  const assertSafeInteger = (value, path, min, max, code = defaultCode) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, `${path} is outside its bounds.`);
  };

  const cloneJson = (value, path = '$') => {
    try {
      return JSON.parse(canonicalJson(value));
    } catch {
      fail('INVALID_SEMANTICS', `${path} must be acyclic canonical JSON data.`);
    }
  };

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  };

  const assertNoSensitive = (value, path = '$', seen = new WeakSet()) => {
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) fail('INVALID_SEMANTICS', `${path} contains a cycle.`);
    seen.add(value);
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
    for (const [key, child] of entries) {
      if (!Array.isArray(value) && SECRET_FIELD.test(key)) fail('SENSITIVE_VALUE', `${path}.${key} is a forbidden sensitive field.`);
      assertNoSensitive(child, `${path}.${key}`, seen);
    }
    seen.delete(value);
  };

  return { fail, isPlainObject, assertPlainObject, assertExactKeys, byteLength, assertSafeInteger, cloneJson, deepFreeze, assertNoSensitive };
}
