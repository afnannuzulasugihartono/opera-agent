// One-off generator: builds the R7 v5 youtube.get_transcript workflow migration
// from the v4 definition captured from production (Temp/wf_v4.json).
// Run: node scripts/gen-r7-transcript-v5.mjs
import fs from 'node:fs';

const v4 = JSON.parse(JSON.parse(fs.readFileSync('C:/Users/ASUS/AppData/Local/Temp/wf_v4.json', 'utf8'))[0].definition);
const clone = (x) => JSON.parse(JSON.stringify(x));
const byId = (id) => clone(v4.steps.find((s) => s.id === id));

const ifTabId = clone(v4.steps[1]);
const watch = byId('watch');
const defaults = v4.steps.slice(4, 7).map(clone);
const panel = byId('panel');
const panelIf = clone(v4.steps[8]);
const segmentFast = byId('segmentFast');
const actIf = clone(v4.steps[10]);
const textInit = v4.steps.slice(11, 13).map(clone);
const chunks = byId('chunks');
const tab = byId('tab');
const restoreIf = clone(v4.steps[15]);

// activation branch gains prevActive (round-trip reduction) + prevActiveId var
const actThen = actIf.then;
actThen.unshift({ type: 'command', id: 'prevActive', method: 'tabs.get', params: { tabId: { $ref: 'vars.tabId' } } });
const activateIdx = actThen.findIndex((s) => s.id === 'activateForRender');
actThen.splice(activateIdx + 1, 0, { type: 'set', name: 'prevActiveId', value: { $ref: 'steps.prevActive.result.tab.id' } });

// restore path now reads vars.prevActiveId
const inner = restoreIf.then && restoreIf.then[0];
if (!inner || !inner.condition) throw new Error('restore inner if tidak ditemukan');
inner.condition.left = { $ref: 'vars.prevActiveId' };
const restore = (inner.then || []).find((s) => s.id === 'restoreActive');
if (restore) restore.params.tabId = { $ref: 'vars.prevActiveId' };

// transcript-scoped primary collection + v4 chunk loop as bounded fallback
const segments = {
  type: 'command', id: 'segments', method: 'page.query', continueOnError: true,
  params: { tabId: { $ref: 'vars.tabId' }, selector: 'ytd-transcript-segment-renderer', limit: 100, visibleOnly: false }
};
const segIf = {
  type: 'if', id: 'segmentsAvailable',
  condition: { left: { $ref: 'steps.segments.result.count' }, op: 'truthy' },
  // `then` is the serialized IF-branch field of the workflow AST (JSON contract
  // consumed by the runner VM); renaming would change bytes, not fix a promise
  // misuse.
  then: [], else: [...textInit, chunks] // NOSONAR S7739 - serialized AST field names
};

const v5 = {
  steps: [byId('yt'), ifTabId, watch, ...defaults, panel, panelIf, segmentFast, actIf, segments, segIf, tab, restoreIf],
  output: {
    tab: { $ref: 'steps.tab.result.tab' },
    segments: { $ref: 'steps.segments.result.items' },
    segmentCount: { $ref: 'steps.segments.result.count' },
    openMethod: { $ref: 'vars.openMethod' },
    panelWasOpen: { $ref: 'vars.panelWasOpen' },
    activatedForRender: { $ref: 'vars.activatedForRender' }
  }
};

const json = JSON.stringify(v5);
const sql = `-- Pre-8E repair R7/T034-T037: transcript-scoped YouTube transcript collection.
-- Historical workflow migrations remain untouched. This versions
-- youtube.get_transcript so the primary path collects transcript segments
-- directly (ytd-transcript-segment-renderer, bounded to 100 items, visibleOnly
-- false) instead of chunked full-page page.read loops, so the model-facing
-- output excludes description/comments/recommendations noise. The v4 chunked
-- text loop is preserved verbatim as the bounded fallback branch for DOM
-- variants where the segment query returns nothing. The unconditional
-- previousActive tabs.get moves into the activation branch (background-first
-- round-trip reduction); activation stays a bounded render fallback with
-- active-tab restore.
--
-- No public MCP tool/schema, protocol, primitive count, production schema, VM,
-- signing, auth, or transport boundary changes are introduced here.

select public.opera_register_workflow(
  'youtube.get_transcript',
  $wf$${json}$wf$::jsonb,
  'Collect a clean transcript via segment-scoped queries with the chunked full-text reader kept as a bounded fallback.',
  true
);
`;
fs.writeFileSync('supabase/migrations/20260920090000_pre_8e_r7_transcript_cleanup.sql', sql);
console.log('migrasi ditulis, json bytes:', json.length);
console.log('langkah v5:', v5.steps.map((s) => s.id || s.type).join(', '));
