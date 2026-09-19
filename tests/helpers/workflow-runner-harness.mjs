import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the real interpreter; only the browser command boundary is mocked.
export async function runWorkflow(definition, input, command) {
  const source = fs.readFileSync(new URL('../../supabase/functions/opera-agent-runner/index.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('class WorkflowError'), source.indexOf('async function processRun'));
  const context = vm.createContext({ console, setTimeout, TextEncoder, structuredClone, command });
  vm.runInContext(stripTypeScriptTypes(body) + '\nrunCommand = async (_run, method, params) => ({ok:true, result:await command(method,params)}); globalThis.api={executeSteps,resolveValue};', context);
  const ctx = { input, vars: {}, steps: {}, metrics: null };
  await context.api.executeSteps(definition.steps, ctx, {}, Date.now() + 10000);
  return JSON.parse(JSON.stringify(context.api.resolveValue(definition.output, ctx)));
}

export function candidateWorkflow(suffix) {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const name = fs.readdirSync(dir).find(name => name.endsWith(suffix));
  if (!name) throw new Error(`Missing candidate migration: ${suffix}`);
  const sql = fs.readFileSync(new URL(name, dir), 'utf8');
  return JSON.parse(sql.split('$wf$')[1]);
}
