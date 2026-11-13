// @last-edited: 2026-11-13 UTC+7.
// @title: reactive-vm-core - the one guard factory the VM family shares.
// @state: the three VM modules (collect, control-flow, host) carried the same eleven helpers verbatim; this is the only copy.
// @dependencies: ./secret-pattern.js, ./digest.js.

import { canonicalJson } from './digest.js';
import { SECRET_VALUE } from './secret-pattern.js';

// WHY A FACTORY AND NOT A DEFAULT CODE ARGUMENT.
// The collect and control-flow modules fail programs with INVALID_SEMANTICS; the host fails with INVALID_SCHEMA.
// One guard set, parameterized at construction, keeps the call sites byte-identical.

export class ReactiveVmError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ReactiveVmError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export interface Guards {
  fail: (code: string, message: string, details?: unknown) => never;
  isPlainObject: (value: unknown) => value is Record<string, unknown>;
  assertPlainObject: (value: unknown, path: string, code?: string) => asserts value is Record<string, unknown>;
  assertExactKeys: (value: unknown, required: string[], optional: string[], path: string, code?: string) => asserts value is Record<string, unknown>;
  byteLength: (value: string) => number;
  assertSafeInteger: (value: unknown, path: string, min: number, max: number, code?: string) => asserts value is number;
  cloneJson: (value: unknown, path?: string) => unknown;
  deepFreeze: <T>(value: T) => T;
  assertNoSensitive: (value: unknown, path?: string, seen?: WeakSet<object>) => void;
}

export function makeGuards(defaultCode: string): Guards {
  const fail = (code: string, message: string, details?: unknown): never => {
    throw new ReactiveVmError(code, message, details);
  };

  function assertPlainObject(value: unknown, path: string, code = defaultCode): asserts value is Record<string, unknown> {
    if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
  }

  function assertExactKeys(value: unknown, required: string[], optional: string[], path: string, code = defaultCode): asserts value is Record<string, unknown> {
    assertPlainObject(value, path, code);
    const allowed = new Set<string>([...required, ...optional]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
    }
    for (const key of required) {
      if (!(key in value)) fail(code, `${path}.${key} is required.`);
    }
  }

  function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  function assertSafeInteger(value: unknown, path: string, min: number, max: number, code = defaultCode): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(code, `${path} is outside its bounds.`);
  }

  const cloneJson = (value: unknown, path = '$'): unknown => {
    try {
      return JSON.parse(canonicalJson(value));
    } catch {
      fail('INVALID_SEMANTICS', `${path} must be acyclic canonical JSON data.`);
    }
  };

  function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value as object)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return Object.freeze(value as T & object) as T;
  }

  function assertNoSensitive(value: unknown, path = '$', seen = new WeakSet<object>()): void {
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) fail('INVALID_SEMANTICS', `${path} contains a cycle.`);
    seen.add(value);
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (!Array.isArray(value) && SECRET_FIELD.test(String(key))) fail('SENSITIVE_VALUE', `${path}.${String(key)} is a forbidden sensitive field.`);
      assertNoSensitive(child, `${path}.${String(key)}`, seen);
    }
    seen.delete(value);
  }

  return { fail, isPlainObject, assertPlainObject, assertExactKeys, byteLength, assertSafeInteger, cloneJson, deepFreeze, assertNoSensitive };
}
