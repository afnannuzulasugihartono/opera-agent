-- Deprecation notes for dead RPCs (2026-10-08 Wave E audit).

-- CONFIRMED DEAD (no caller in supabase/functions, landing, extension, lib, scripts, or tests as of 2026-10-08): the two-phase compatibility wrappers from 20260908035531 — opera_start_command, opera_run, opera_run_workflow.
-- Every live path (gateway, MCP, runner, VM, bridge) enqueues with opera_enqueue and awaits separately, so nothing calls these wrappers.

-- DELIBERATELY NOT DELETED: applied migrations are never rewritten, and dropping a granted function is an owner decision, not an audit side effect.
-- COMMENT ON is metadata only — it changes no behavior, no grant, and no signature — so the deprecation is visible in \df+ without touching the code.

-- EXPLICITLY RETAINED, not marked here:
-- - opera_claim_next: no edge caller today, but 20261003110000 keeps it by design as the single-shot non-waiting claim next to opera_claim_next_wait.
-- - opera_run_fast: dead and unusable (enqueue+await in one transaction), but 20261004090000 already carries the full trap note plus the owner decision.
-- - opera_workflow_versions / opera_rollback_workflow: no runtime caller, but tests/workflow-dsl.test.mjs pins their existence as the rollback path.

comment on function public.opera_start_command(text, jsonb, integer, text, text) is
  'DEPRECATED 2026-10-08 (Wave E audit): no caller in functions, landing, extension, lib, scripts, or tests. Live paths call opera_enqueue directly. Retained because applied migrations are never rewritten; removal is an owner decision.';

comment on function public.opera_run(text, jsonb, integer, text, text) is
  'DEPRECATED 2026-10-08 (Wave E audit): the deferred-async redefinition from the two-phase API has no caller; live paths call opera_enqueue directly. Retained because applied migrations are never rewritten; removal is an owner decision.';

comment on function public.opera_run_workflow(text, jsonb, integer, text) is
  'DEPRECATED 2026-10-08 (Wave E audit): no caller in functions, landing, extension, lib, scripts, or tests. Live paths call opera_start_workflow plus opera_get_workflow_run directly. Retained because applied migrations are never rewritten; removal is an owner decision.';
