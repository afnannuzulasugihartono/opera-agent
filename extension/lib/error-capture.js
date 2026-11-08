// @last-edited: 2026-11-08 UTC+7.
// @title: error-capture — the worker's own faults, handed to the logger instead of only to Chrome.
// @state: two listeners over an injected target, and the message each one carries whole.
// @dependencies: none.

// The target and the logger arrive as arguments, so this runs under node:test without a worker and without Chrome.

export function captureWorkerErrors({ target, log }) {
  if (!target || typeof target.addEventListener !== 'function') return { installed: false };
  const messageOf = (event) => String(
    event?.error?.message ?? event?.reason?.message ?? event?.message ?? event?.reason ?? ''
  );
  target.addEventListener('error', (event) => log.error('WORKER_UNCAUGHT_ERROR', messageOf(event)));
  target.addEventListener('unhandledrejection', (event) => log.error('WORKER_UNHANDLED_REJECTION', messageOf(event)));
  return { installed: true };
}
