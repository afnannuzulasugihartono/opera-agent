// @last-edited: 2026-10-21 UTC+7.
// @title: billing — re-export so the Node suite reaches the shared money rules.
// @state: the implementation lives in supabase/functions/_shared, where the edge function imports it; this file only points at it.
// @dependencies: ../supabase/functions/_shared/billing.

export * from '../supabase/functions/_shared/billing.js';
