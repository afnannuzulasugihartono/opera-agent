// Last edited: 2026-10-04 17:52. Title: transaction-edge-routing-evidence-8d — Bounded, non-secret routing-trace evidence for Checkpoint 8D hosted Edge races. Now: add bounded 8D Edge routing evidence helper.

// Bounded, non-secret routing-trace evidence for Checkpoint 8D hosted Edge races.
// Raw header values are inspected in memory only and are never returned or logged.

export const EDGE_TRACE_HEADERS_8D=Object.freeze(['x-deno-execution-id','cf-ray']);
export const EDGE_REGION_HEADERS_8D=Object.freeze(['x-sb-edge-region']);
const EXPECTED_SAMPLES_8D=8;

function headerSummary(responses,name){
  const values=[];
  for(const response of responses){
    const value=response?.headers?.get?.(name);
    if(typeof value==='string'&&value.trim())values.push(value.trim());
  }
  return Object.freeze({name,samples:values.length,distinct:new Set(values).size});
}

export function collectEdgeRoutingEvidence8D(responses){
  if(!Array.isArray(responses)||responses.length!==EXPECTED_SAMPLES_8D)throw new Error('8D_EDGE_WORKER_TRACE_EVIDENCE_INVALID');
  const traces=EDGE_TRACE_HEADERS_8D.map(name=>headerSummary(responses,name));
  const trace=traces.find(item=>item.samples===EXPECTED_SAMPLES_8D&&item.distinct>=2);
  if(!trace)throw new Error('8D_EDGE_WORKER_TRACE_EVIDENCE_MISSING');
  const regions=EDGE_REGION_HEADERS_8D.map(name=>headerSummary(responses,name));
  const region=regions.find(item=>item.samples>0)??null;
  return Object.freeze({
    traceHeader:trace.name,
    samples:trace.samples,
    distinctRoutingTraces:trace.distinct,
    regionHeader:region?.name??null,
    distinctRegions:region?.distinct??0
  });
}
