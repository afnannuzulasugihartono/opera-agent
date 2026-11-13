// @last-edited: 2026-11-14 UTC+7.
// @title: global.d.ts — the contract between the classic content scripts and the worker: every helper a manifest classic script publishes on globalThis, declared once, here.
// @state: owns every `OperaAgent*` global the extension publishes; a classic script cannot import, so it publishes, and the worker reads the value back through this type.
// @dependencies: none.
// @why-no-casts: reading a global through a double assertion closes this file's eyes and the type then lies by omission; declaring the global here is the one place the shape is named, and both sides check against it.

export {};

declare global {
  var __operaAgentContentV1: boolean | undefined;
  var OPERA_BRIDGE_WS: string | undefined;
  var OPERA_BRIDGE_HANDLE_TIMEOUT_MS: number | string | undefined;
  var OPERA_SOCKET_EXECUTE_TIMEOUT_MS: number | string | undefined;
  var OperaAgentBrowserId: { browserName: string } | undefined;
  var OperaAgentLog: OperaAgentLog | undefined;
  var OperaAgentRoleReconcile: OperaAgentRoleReconcile | undefined;
  var OperaAgentHoverSettle: OperaAgentHoverSettle | undefined;
  var OperaAgentStatementFile: OperaAgentStatementFile | undefined;
  var OperaAgentSemanticIdentity: OperaAgentSemanticIdentity | undefined;
  var OperaAgentSemanticViews: OperaAgentSemanticViews | undefined;
  var OperaAgentPageMap: OperaAgentPageMap | undefined;
  var OperaAgentRecord: Record<string, ((payload?: unknown) => unknown) | undefined> | undefined;

  interface Navigator {
    readonly userAgentData?: { brands?: Array<{ brand?: unknown }> | undefined } | undefined;
    readonly brave?: { isBrave?: (() => boolean) | undefined } | undefined;
  }

  interface OperaAgentLogEntry {
    readonly t: string;
    readonly level: 'debug' | 'warn' | 'error';
    readonly code: string;
    readonly message: string;
    readonly commandId: string | null;
  }

  interface OperaAgentLogFault {
    readonly code: string;
    readonly message: string;
    readonly count: number;
    readonly firstAt?: string | undefined;
    readonly lastAt?: string | undefined;
  }

  interface OperaAgentLog {
    readonly configure: (options: { level?: 'debug' | 'warn' | 'error' } | undefined) => void;
    readonly log: (level: 'debug' | 'warn' | 'error', code: unknown, message: unknown, fields?: { commandId?: unknown } | undefined) => OperaAgentLogEntry;
    readonly debug: (code: unknown, message: unknown, fields?: { commandId?: unknown } | undefined) => OperaAgentLogEntry;
    readonly warn: (code: unknown, message: unknown, fields?: { commandId?: unknown } | undefined) => OperaAgentLogEntry;
    readonly error: (code: unknown, message: unknown, fields?: { commandId?: unknown } | undefined) => OperaAgentLogEntry;
    readonly entries: () => OperaAgentLogEntry[];
    readonly clear: () => void;
    readonly errors: () => OperaAgentLogFault[];
    readonly clearErrors: () => void;
    readonly errorCount: () => number;
  }

  interface OperaAgentRoleReconcile {
    readonly GENERIC_ROLES: readonly string[];
    readonly ROLE_GAP_SAMPLE_SIZE: number;
    readonly isGenericRole: (role: unknown) => boolean;
    readonly hasRoleGap: (root: unknown, axIndex?: unknown) => boolean;
    readonly implicitRole: (item: unknown) => string;
    readonly normalizeAxRole: (role: unknown) => string;
    readonly axRoleIndex: (items: unknown) => unknown;
    readonly reconcileElementRole: (item: unknown, index: unknown) => unknown;
    readonly reconcileElements: (items: unknown, index: unknown) => unknown;
  }

  interface OperaAgentHoverSettleNormalized {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly stableRounds: number;
    readonly text: string;
  }

  interface OperaAgentHoverSettleDecision {
    readonly done: boolean;
    readonly reason: string;
    readonly stableRounds?: unknown;
    readonly expectedText?: string | undefined;
  }

  interface OperaAgentHoverSettle {
    readonly DEFAULTS: Readonly<{ timeoutMs: number; intervalMs: number; stableRounds: number }>;
    readonly normalize: (options?: Record<string, unknown> | undefined) => OperaAgentHoverSettleNormalized;
    readonly plan: (state?: Record<string, unknown> | undefined) => OperaAgentHoverSettleDecision;
  }

  interface OperaAgentStatementFile {
    readonly kindOf: (bytes: Uint8Array) => string;
    readonly countPages: (bytes: Uint8Array) => number;
    readonly pagesFrom: (kind: string, pages: number) => string;
    readonly balanceDigits: (raw: unknown) => string | null;
  }

  interface OperaAgentSemanticState {
    readonly observationRevision?: number | undefined;
    readonly [key: string]: unknown;
  }

  interface OperaAgentSemanticObservation {
    readonly items: unknown[];
    readonly state: OperaAgentSemanticState;
    readonly delta: unknown;
  }

  interface OperaAgentIdentityEngine {
    readonly reset: (reason?: string) => void;
    readonly observe: (items: unknown[]) => OperaAgentSemanticObservation;
    readonly inspect: () => OperaAgentSemanticState;
  }

  interface OperaAgentSemanticIdentity {
    readonly createIdentityEngine: (options?: Record<string, unknown> | undefined) => OperaAgentIdentityEngine;
    readonly stableHash: (value: unknown) => string;
  }

  interface OperaAgentViewEngine {
    readonly observe: (input?: Record<string, unknown> | undefined) => unknown;
    readonly reset: () => void;
  }

  interface OperaAgentSemanticViews {
    readonly COMPLETION_STATUSES: readonly string[];
    readonly classifyCompletion: (input?: Record<string, unknown> | undefined) => {
      readonly status: string;
      readonly scope: string;
      readonly evidence: string[];
      readonly limits: string[];
      readonly unresolved: string[];
      readonly blockedReason?: string | undefined;
    };
    readonly createViewEngine: (options?: Record<string, unknown> | undefined) => OperaAgentViewEngine;
  }

  interface OperaAgentPageMapElement {
    readonly kind?: string | undefined;
    readonly tag?: string | undefined;
    readonly role?: string | null | undefined;
    readonly name?: string | undefined;
    readonly checked?: boolean | undefined;
    readonly type?: string | undefined;
    readonly href?: string | undefined;
    readonly visible?: boolean | undefined;
    readonly style: { pointerEvents?: string | undefined; [key: string]: unknown };
    readonly [key: string]: unknown;
  }

  interface OperaAgentPageMapPull<T = OperaAgentPageMapElement> {
    readonly elements: T[];
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextOffset?: number | null | undefined;
  }

  interface OperaAgentPageMap {
    readonly PAGE_MAP_CLASSES: readonly string[];
    readonly CLASS_FIELDS: Readonly<Record<string, readonly string[]>>;
    readonly PAGE_MAP_MAX_ELEMENTS: number;
    readonly classify: (input: Record<string, unknown>) => string;
    readonly isMapClass: (name: unknown) => boolean;
    readonly isActionableClass: (kind: unknown) => boolean;
    readonly projectElement: (raw: Record<string, unknown>) => OperaAgentPageMapElement;
    readonly paginate: (elements: OperaAgentPageMapElement[], offset: unknown, limit: unknown) => OperaAgentPageMapPull;
    readonly unionBox: (elements: OperaAgentPageMapElement[]) => { x: number; y: number; width: number; height: number } | null;
    readonly summarizeClass: (className: string, elements: OperaAgentPageMapElement[]) => { class: string; count: number; bbox: { x: number; y: number; width: number; height: number } | null };
  }
}
