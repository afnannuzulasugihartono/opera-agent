// @last-edited: 2026-10-14 UTC+7.
// @title: command-result — re-export so the Node suite reaches the shared command verdict.
// @state: the implementation lives in supabase/functions/_shared, where edge functions import it; this file only points at it.
// @dependencies: ../supabase/functions/_shared/command-result.

export * from '../supabase/functions/_shared/command-result.js';
