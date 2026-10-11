// @last-edited: 2026-10-11 UTC+7.
// @title: command-stream — drains a running command's events until it reaches a terminal status.
// @state: the loop is bounded by a deadline, advances its cursor, and stops on a terminal status or a lost stream, never on an empty pass.
// @dependencies: none.

// Streaming a command is two calls, not one. This drains the event channel so
// progress can be forwarded while the work runs; the caller still asks
// opera_await_adaptive for the result afterwards, which returns at once because
// the command is already terminal by then. Keeping the result fetch separate is
// deliberate: it means the existing result, error and timing handling in runCommand
// is untouched, and a stream that dies cannot corrupt a result.
//
// The database side parks this loop for at most p_timeout_ms and re-reads the
// command status every 5ms while it waits, so a command that finishes without
// emitting anything is still noticed within milliseconds. That is why the wait
// slice can be long: it bounds how long one database connection is held, not how
// long a finished command goes unnoticed.
//
// A notification callback is allowed to throw. A model that disconnects mid-run
// must not turn into a command that never completes, and the events have already
// been recorded either way.

export const TERMINAL_COMMAND_STATUSES = Object.freeze(['completed', 'failed', 'expired', 'cancelled']);

const WAIT_SLICE_CEILING_MS = 30000;

const waitSliceMs = (remainingMs) => Math.max(100, Math.min(WAIT_SLICE_CEILING_MS, remainingMs));

export async function streamCommandEvents({ rpc, commandId, onEvent, deadlineMs = 30000 }) {
  const deadline = Date.now() + Math.max(200, deadlineMs);
  const events = [];
  let cursor = 0;
  let status = '';

  for (;;) {
    const slice = await rpc('opera_command_events_wait', {
      p_command_id: commandId,
      p_after_id: cursor,
      p_timeout_ms: waitSliceMs(deadline - Date.now())
    });

    if (!slice?.ok) {
      return { ok: false, status, events, error: slice?.error ?? 'Command stream lost.' };
    }

    for (const event of slice.events ?? []) {
      cursor = Number(event?.id) || cursor;
      events.push(event);
      try { onEvent?.(event); } catch {}
    }

    status = String(slice.status ?? status);
    if (TERMINAL_COMMAND_STATUSES.includes(status)) return { ok: true, status, events };

    if (Date.now() >= deadline) {
      return { ok: false, status, events, error: { code: 'AWAIT_TIMEOUT', message: 'Timed out streaming command progress.' } };
    }
  }
}