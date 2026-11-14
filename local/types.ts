// @last-edited: 2026-11-13 UTC+7.
// @title: types - the two shapes every dynamic boundary in the local road shares.
// @state: a JSON-shaped record for MCP and page payloads, and the driver surface whose methods are called by name.
// @dependencies: none.

// WHY JsonRecord CARRIES `any` IN ITS INDEX AND NOT `unknown`.
// The MCP argument bag is composed by a model and read by fifty tool branches, and the tool schema has already promised the key and its type before the branch runs.
// Typed `unknown`, every one of those reads needs a narrowing the schema already proved, and the noise would bury the few reads that genuinely need a check.
// This is the one place in `local/` where the type is deliberately open; everything that is not the argument bag is narrowed.

// biome-ignore lint/suspicious/noExplicitAny: WHY THE RECORD IS OPEN. The MCP argument bag is composed by a model and read by fifty tool branches, and the tool schema has already promised the key and its type before the branch runs; every other read narrows. This is the one place in `local/` where the type is deliberately open.
export type JsonRecord = Record<string, any>;

// WHY THE DRIVER IS A NAMED INTERFACE AND NOT AN INDEX SIGNATURE.
// The drive calls its transport by verb, and the two transports answer the same verbs over different pipes.
// Naming every verb once means a call site that types `driver.clik(...)` is a compile error, and a driver that grows a verb grows it here first.

export type DriverMethod = (...args: unknown[]) => Promise<unknown>;

export interface Driver {
  append: DriverMethod;
  ask: DriverMethod;
  capture: DriverMethod;
  captureSized: DriverMethod;
  caretLine: DriverMethod;
  click: DriverMethod;
  clickFraction: DriverMethod;
  clickRow: DriverMethod;
  close: DriverMethod;
  computed: DriverMethod;
  dialogPress: DriverMethod;
  dialogState: DriverMethod;
  dialogType: DriverMethod;
  download: DriverMethod;
  dropFile: DriverMethod;
  ensureFront: DriverMethod;
  evaluate: DriverMethod;
  find: DriverMethod;
  focusWindow: DriverMethod;
  front: DriverMethod;
  guide: DriverMethod;
  hasFocus: DriverMethod;
  hover: DriverMethod;
  interceptFileChooser: DriverMethod;
  key: DriverMethod;
  keys: DriverMethod;
  menuTree: DriverMethod;
  navigate: DriverMethod;
  open: DriverMethod;
  openMenu: DriverMethod;
  pageLook: DriverMethod;
  pageState: DriverMethod;
  read: DriverMethod;
  resolve: DriverMethod;
  scroll: DriverMethod;
  settle: DriverMethod;
  snapshot: DriverMethod;
  surfaceProfile: DriverMethod;
  tabs: DriverMethod;
  type: DriverMethod;
  upload: DriverMethod;
  waitForRow: DriverMethod;
  waitForStill: DriverMethod;
  waitForText: DriverMethod;
waitForUrl: DriverMethod;
  windowState: DriverMethod;
}

// WHY ONE ROW TYPE FOR THE ACCESSIBILITY TREE AND THE MENU TREE.
// Both are page-computed records with a stable core (role, name, a box, a depth) and whatever extra fields the expression that made them carried.
// Naming the core means a row that loses one of those fields is a compile error; the index signature keeps the extra fields honest without pretending the module knows them.

export interface AxRow {
  role?: string;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  depth?: number;
  node?: number;
  expanded?: boolean;
  branch?: boolean;
  disabled?: boolean;
  [key: string]: unknown;
}
