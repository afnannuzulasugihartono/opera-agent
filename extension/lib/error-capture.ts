// @last-edited: 2026-11-08 UTC+7.
// @title: error-capture — the worker's own faults, handed to the logger instead of only to Chrome.
// @state: two listeners over an injected target, and the message each one carries whole.
// @dependencies: none.

// The target and the logger arrive as arguments, so this runs under node:test without a worker and without Chrome.

export function captureWorkerErrors({ target, log }: { target?: Pick<EventTarget, 'addEventListener'> | null | undefined; log?: { error?: (code: string, message: string) => void } | undefined }) {
  if (!target || typeof target.addEventListener !== 'function' || !log || typeof log.error !== 'function') return { installed: false };
  const logError = log.error.bind(log);
  const messageOf = (event: Event & { error?: { message?: string } | undefined; reason?: { message?: string } | undefined; message?: unknown } & { reason?: unknown }) => String(
    event?.error?.message ?? event?.reason?.message ?? event?.message ?? event?.reason ?? ''
  );
  target.addEventListener('error', (event) => logError('WORKER_UNCAUGHT_ERROR', messageOf(event)));
  target.addEventListener('unhandledrejection', (event) => logError('WORKER_UNHANDLED_REJECTION', messageOf(event)));
  return { installed: true };
}
