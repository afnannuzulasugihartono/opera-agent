// @last-edited: 2026-10-08 UTC+7.
// @title: adhoc-compile — re-export so the Node suite reaches the shared compiler.
// @state: the implementation lives in supabase/functions/_shared, where the edge function imports it; this file only points at it.
// @dependencies: _shared/adhoc-compile.

export * from '../supabase/functions/_shared/adhoc-compile.js';
