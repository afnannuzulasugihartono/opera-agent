// @last-edited: 2026-10-13 UTC+7.
// @title: docs-ui-map — re-export so the Node suite reaches the shared menu map.
// @state: the implementation lives in supabase/functions/_shared, where edge functions import it; this file only points at it.
// @dependencies: ../supabase/functions/_shared/docs-ui-map.

export * from '../supabase/functions/_shared/docs-ui-map.js';
