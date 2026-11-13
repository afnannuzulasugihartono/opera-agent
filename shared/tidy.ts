// @last-edited: 2026-11-13 UTC+7.
// @title: tidy - the shape a model reads: the answer first, the transport gone.
// @state: the envelope rules, the tab fields, the bridge fields, and one flag that returns the raw envelope.
// The one shared source, both roads bundle it.
// @dependencies: none.

// No tool accepts a command id, a run id or a timing block, so a model can never spend them.

const TRANSPORT_KEYS = ["commandId", "runId", "timing"];

// Browser window chrome, not the page the caller asked about.

const TAB_KEYS = ["muted", "pinned", "audible", "windowId"];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTab(value: Json): boolean {
  return typeof value.id === "number" && typeof value.url === "string";
}

function isBridge(value: Json): boolean {
  return Array.isArray(value.trace)
    && ("port" in value || "url" in value || "linked" in value || "commands" in value);
}

function trimValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimValue);
  if (!isObject(value)) return value;

  if (isTab(value)) {
    const tab: Json = { ...value };
    for (const key of TAB_KEYS) delete tab[key];
    return tab;
  }

  if (isBridge(value)) {
    return typeof value.lastError === "string" && value.lastError ? { lastError: value.lastError } : {};
  }

  const trimmed: Json = {};
  for (const [key, item] of Object.entries(value)) {
    const next = trimValue(item);
    if (key === "bridge" && isObject(next) && Object.keys(next).length === 0) continue;
    trimmed[key] = next;
  }
  return trimmed;
}

export function tidyForAi(value: unknown): Json {
  if (!isObject(value)) return { value: value ?? null };

  const out: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (TRANSPORT_KEYS.includes(key)) continue;
    if (key === "status" && item === "completed") continue;
    if (key === "error" && item == null) continue;
    out[key] = item;
  }

  // The answer sits one level down in the envelope; opening it puts the answer at the top.
  const result = out.result;
  if (isObject(result)) {
    delete out.result;
    for (const [key, item] of Object.entries(result)) {
      if (key === "ok" || key in out) continue;
      out[key] = item;
    }
  } else if (result == null) {
    delete out.result;
  }

  if (!("ok" in out)) out.ok = true;
  return trimValue(out) as Json;
}
