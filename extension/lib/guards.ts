// @last-edited: 2026-11-14 UTC+7.
// @title: guards — runtime type guards for data that crosses a boundary the compiler cannot see.
// @state: owns isRecord and isString; every module that reads a value from outside its process states it through this file.
// @dependencies: none.

// WHY A MODULE AND NOT INLINE CHECKS.
// The boundary is the same everywhere: chrome messaging, storage, executeScript results, the bridge socket.
// One copy of each check means one place where a weak guard lets a bad value through.
// A guard is the honest alternative to an assertion: it asks the value itself.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}
