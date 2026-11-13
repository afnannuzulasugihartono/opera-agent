// @last-edited: 2026-11-13 UTC+7.
// @title: required-env - the environment edge functions read at boot, without the non-null assertion gamble.
// @state: fails loud at import time when a required variable is missing; the alternative to deploying a function that silently crashes on its first request.
// @dependencies: none.

// WHY A SHARED HELPER AND NOT SPRINKLED GUARDS.
// Every edge function used to write `Deno.env.get("X")!` at module scope, the non-null assertion telling the typechecker what deploy already knows.
// The helper names the same invariant once, with the message a deployer actually needs.

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required but not set in the deploy environment.`);
  return value;
}
