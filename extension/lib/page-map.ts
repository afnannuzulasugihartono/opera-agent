// @last-edited: 2026-11-08 UTC+7.
// @title: page-map — the rules that name an element and page it out, with no DOM in sight.
// @state: the seventeen classes in rule order, the field each class adds, the projection, and the pull.
// @dependencies: none.

(() => {
  'use strict';
  if (globalThis.OperaAgentPageMap) return;

  interface Descriptor {
    readonly tag: string;
    readonly role: string;
    readonly type: string;
    readonly href: string;
    readonly side: number;
  }

  interface ClassRule {
    readonly class: string;
    readonly tags?: readonly string[];
    readonly roles?: readonly string[];
    readonly inputTypes?: readonly string[];
    readonly needsHref?: boolean;
    readonly minSide?: number;
    readonly maxSide?: number;
  }

  interface PageMapRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly centerX: number;
    readonly centerY: number;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const PAGE_MAP_MAX_ELEMENTS = 20000;
  const PAGE_MAP_LIMIT = 200;
  const PAGE_MAP_LIMIT_MAX = 1000;
  const PAGE_MAP_SIDE_MIN = 24;
  const ACTIONABLE_CLASSES = Object.freeze(['button', 'choice', 'input', 'select', 'link', 'media', 'iframe']);

  // The field a class adds on top of the projection's common ones; `role` is common, so a class never repeats it.

  const CLASS_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    button: Object.freeze([]),
    choice: Object.freeze(['checked', 'name', 'type']),
    input: Object.freeze(['type', 'name', 'value', 'placeholder']),
    select: Object.freeze(['name', 'options']),
    heading: Object.freeze(['level']),
    link: Object.freeze(['href']),
    media: Object.freeze(['src', 'paused', 'currentTime', 'duration']),
    iframe: Object.freeze(['src', 'title']),
    picture: Object.freeze(['src', 'alt']),
    icon: Object.freeze(['src', 'alt']),
    table: Object.freeze(['rows', 'cols', 'headers']),
    list: Object.freeze(['itemCount']),
    form: Object.freeze(['fieldCount']),
    region: Object.freeze(['kind']),
    separator: Object.freeze([]),
    status: Object.freeze(['value']),
    text: Object.freeze(['for', 'row', 'col'])
  });

  const PAGE_MAP_CLASSES = Object.freeze(Object.keys(CLASS_FIELDS));

  const COMMON_FIELDS = Object.freeze([
    'class', 'ref', 'tag', 'role', 'text', 'label',
    'order', 'depth', 'regionId',
    'visible', 'actionable', 'disabled',
    'logicalId', 'stableKey'
  ]);

  // The rules run in this order, so the first one that matches is the class; a class may own more than one rule.

  const RULES = Object.freeze([
    Object.freeze({ class: 'button', tags: ['button'] }),
    Object.freeze({ class: 'text', tags: ['summary'] }),
    Object.freeze({ class: 'button', roles: ['button'] }),
    Object.freeze({ class: 'button', tags: ['input'], inputTypes: ['submit', 'button', 'reset', 'image'] }),
    Object.freeze({ class: 'choice', tags: ['input'], inputTypes: ['checkbox', 'radio'] }),
    Object.freeze({ class: 'choice', roles: ['checkbox', 'radio', 'switch'] }),
    Object.freeze({ class: 'input', tags: ['textarea'] }),
    Object.freeze({ class: 'input', tags: ['input'] }),
    Object.freeze({ class: 'select', tags: ['select'] }),
    Object.freeze({ class: 'heading', tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] }),
    Object.freeze({ class: 'heading', roles: ['heading'] }),
    Object.freeze({ class: 'link', tags: ['a', 'area'], needsHref: true }),
    Object.freeze({ class: 'link', roles: ['link'] }),
    Object.freeze({ class: 'media', tags: ['video', 'audio'] }),
    Object.freeze({ class: 'iframe', tags: ['iframe', 'frame', 'object', 'embed'] }),
    Object.freeze({ class: 'picture', tags: ['img', 'picture', 'canvas', 'svg'], minSide: PAGE_MAP_SIDE_MIN }),
    Object.freeze({ class: 'picture', roles: ['img'], minSide: PAGE_MAP_SIDE_MIN }),
    Object.freeze({ class: 'icon', tags: ['img', 'picture', 'canvas', 'svg'], maxSide: PAGE_MAP_SIDE_MIN }),
    Object.freeze({ class: 'icon', roles: ['img'], maxSide: PAGE_MAP_SIDE_MIN }),
    Object.freeze({ class: 'table', tags: ['table'] }),
    Object.freeze({ class: 'table', roles: ['table', 'grid'] }),
    Object.freeze({ class: 'list', tags: ['ul', 'ol'] }),
    Object.freeze({ class: 'list', roles: ['list'] }),
    Object.freeze({ class: 'form', tags: ['form'] }),
    Object.freeze({ class: 'form', roles: ['form'] }),
    Object.freeze({ class: 'region', tags: ['header', 'nav', 'aside', 'footer', 'main', 'dialog'] }),
    Object.freeze({ class: 'region', roles: ['dialog', 'banner', 'navigation', 'complementary', 'contentinfo', 'main'] }),
    Object.freeze({ class: 'separator', tags: ['hr'] }),
    Object.freeze({ class: 'separator', roles: ['separator'] }),
    Object.freeze({ class: 'status', tags: ['output'] }),
    Object.freeze({ class: 'status', roles: ['status', 'alert', 'progressbar', 'meter'] }),
    Object.freeze({ class: 'text', tags: ['p', 'li', 'td', 'th', 'blockquote', 'figcaption', 'dd', 'dt', 'pre', 'summary', 'label', 'caption'] })
  ]);

  function matchesRule(rule: ClassRule, descriptor: Descriptor): boolean {
    if (!rule.tags && !rule.roles) return false;
    if (rule.tags && !rule.tags.includes(descriptor.tag)) return false;
    if (rule.roles && !rule.roles.includes(descriptor.role)) return false;
    if (rule.inputTypes && !rule.inputTypes.includes(descriptor.type)) return false;
    if (rule.needsHref && !descriptor.href) return false;
    if (rule.minSide !== undefined && descriptor.side < rule.minSide) return false;
    if (rule.maxSide !== undefined && descriptor.side >= rule.maxSide) return false;
    return true;
  }

  function classify(descriptor: Record<string, unknown> = {}): string {
    const tag = String(descriptor.tag || '').toLowerCase();
    const role = String(descriptor.role || '').toLowerCase();
    const type = String(descriptor.type || '').toLowerCase();
    const href = typeof descriptor.href === 'string' ? descriptor.href : '';
    const side = Math.max(Number(descriptor.width) || 0, Number(descriptor.height) || 0);
    if (tag === 'input' && type === 'hidden') return '';
    const normalized = { tag, role, type, href, side };
    for (const rule of RULES) {
      if (matchesRule(rule, normalized)) return rule.class;
    }
    return '';
  }

  function isMapClass(name: unknown): boolean {
    return PAGE_MAP_CLASSES.includes(String(name || ''));
  }

  function isActionableClass(name: unknown): boolean {
    return ACTIONABLE_CLASSES.includes(String(name || ''));
  }

  function rectOf(raw: Record<string, unknown>): PageMapRect {
    const x = Number(raw.x) || 0;
    const y = Number(raw.y) || 0;
    const width = Number(raw.width) || 0;
    const height = Number(raw.height) || 0;
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
  }

  const EMPTY_VALUES: readonly unknown[] = [undefined, null, ''];

  function projectElement(raw: Record<string, unknown> = {}): OperaAgentPageMapElement {
    const projected: Record<string, unknown> = { rect: rectOf(raw) };
    for (const field of COMMON_FIELDS) projected[field] = raw[field];
    const rawClass = raw.class;
    const classFields = typeof rawClass === 'string' ? CLASS_FIELDS[rawClass] ?? [] : [];
    for (const field of classFields) projected[field] = raw[field];
    const cleaned = Object.fromEntries(
      Object.entries(projected).filter(([, value]) => !EMPTY_VALUES.includes(value))
    );
    return cleaned as OperaAgentPageMapElement;
  }

  function paginate(elements: OperaAgentPageMapElement[], offset: unknown, limit: unknown) {
    const list = Array.isArray(elements) ? elements : [];
    const total = list.length;
    const start = Math.max(0, Math.min(Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0, total));
    const wanted = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.trunc(Number(limit)) : PAGE_MAP_LIMIT;
    const size = Math.min(PAGE_MAP_LIMIT_MAX, Math.max(1, wanted));
    const page = list.slice(start, start + size);
    const next = start + page.length;
    const hasMore = next < total;
    return { elements: page, offset: start, limit: size, total, hasMore, nextOffset: hasMore ? next : null };
  }

  function unionBox(elements: OperaAgentPageMapElement[]): { x: number; y: number; width: number; height: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const element of Array.isArray(elements) ? elements : []) {
      const rect = element?.rect;
      if (!rect) continue;
      const box: Record<string, unknown> = isRecord(rect) ? rect : {};
      minX = Math.min(minX, Number(box.x));
      minY = Math.min(minY, Number(box.y));
      maxX = Math.max(maxX, Number(box.x) + Number(box.width));
      maxY = Math.max(maxY, Number(box.y) + Number(box.height));
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function summarizeClass(className: string, elements: OperaAgentPageMapElement[]): { class: string; count: number; bbox: { x: number; y: number; width: number; height: number } | null } {
    const list = Array.isArray(elements) ? elements : [];
    return { class: className, count: list.length, bbox: unionBox(list) };
  }

  globalThis.OperaAgentPageMap = Object.freeze({
    PAGE_MAP_CLASSES,
    CLASS_FIELDS,
    PAGE_MAP_MAX_ELEMENTS,
    classify,
    isMapClass,
    isActionableClass,
    projectElement,
    paginate,
    unionBox,
    summarizeClass
  });
})();
