// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-edge-routing-evidence — edge-routing-evidence-8d — Bounded, non-secret routing-trace evidence for ho.
// @state: add bounded Edge routing evidence helper.
// @dependencies: none.

// Bounded, non-secret routing-trace evidence for hosted Edge races.
// Raw header values are inspected in memory only and are never returned or logged.

export const EDGE_TRACE_HEADERS=Object.freeze(['x-deno-execution-id','cf-ray']);
export const EDGE_REGION_HEADERS=Object.freeze(['x-sb-edge-region']);
const EXPECTED_SAMPLES=8;

function headerSummary(responses,name){
  const values=[];
  for(const response of responses){
    const value=response?.headers?.get?.(name);
    if(typeof value==='string'&&value.trim())values.push(value.trim());
  }
  return Object.freeze({name,samples:values.length,distinct:new Set(values).size});
}

export function collectEdgeRoutingEvidence(responses){
  if(!Array.isArray(responses)||responses.length!==EXPECTED_SAMPLES)throw new Error('EDGE_WORKER_TRACE_EVIDENCE_INVALID');
  const traces=EDGE_TRACE_HEADERS.map(name=>headerSummary(responses,name));
  const trace=traces.find(item=>item.samples===EXPECTED_SAMPLES&&item.distinct>=2);
  if(!trace)throw new Error('EDGE_WORKER_TRACE_EVIDENCE_MISSING');
  const regions=EDGE_REGION_HEADERS.map(name=>headerSummary(responses,name));
  const region=regions.find(item=>item.samples>0)??null;
  return Object.freeze({
    traceHeader:trace.name,
    samples:trace.samples,
    distinctRoutingTraces:trace.distinct,
    regionHeader:region?.name??null,
    distinctRegions:region?.distinct??0
  });
}
