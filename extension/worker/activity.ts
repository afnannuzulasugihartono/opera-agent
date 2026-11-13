// @last-edited: 2026-11-14 UTC+7.
// @title: agent-activity - the one place that knows an agent is working, and where.
// @state: owns the in-memory activity table mirrored to chrome.storage.local; the chip in the held tab renders from it and the popup reads it.
// @dependencies: guards

// WHY IN MEMORY FIRST AND STORAGE MIRROR SECOND.
// The dispatch path may fire many times per page; a storage read per call would add a round trip to every agent command.
// Memory is the truth, storage is what the popup and the first chip see.

import { isRecord } from '../lib/guards.js';

export interface AgentActivity {
  tabId: number | null;
  kinds: string[];
  since: number;
}

let activity: AgentActivity | null = null;

const ACTIVITY_STORAGE_KEY = 'oa_agent_activity';

// WHY THE HELPER: an agent holds the tab only the moment a command carries an explicit tabId; a bare ping has no target and gets no marker.

export function agentTabFor(params: unknown): number | null {
  if (!isRecord(params)) return null;
  const raw = params.tabId;
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function now(): number {
  return Date.now();
}

// Best effort: the worker keeps the memory truth even if the mirror fails.

function mirrorToStorage() {
  return chrome.storage.local.set({ [ACTIVITY_STORAGE_KEY]: activity }).catch(() => {});
}

export function beginAgentActivity(tabId: number, kind: string) {
  activity = {
    tabId,
    kinds: activity ? [...new Set([...activity.kinds, kind])] : [kind],
    since: activity?.since ?? now(),
  };
  void mirrorToStorage();
}

export async function endAgentActivity(kind: string) {
  if (!activity) return;
  const kinds = activity.kinds.filter((k) => k !== kind);
  activity = kinds.length === 0 ? null : { ...activity, kinds };
  await mirrorToStorage();
}
