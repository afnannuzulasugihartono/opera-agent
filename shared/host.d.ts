// @last-edited: 2026-11-13 UTC+7.
// @title: host - the exact host surface the pure core is allowed to touch.
// @state: ambient declarations, each with the road that provides it; nothing else from a host leaks in.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// `shared/` is compiled with `lib: ["es2022"]` and nothing else, so a module that reaches for `document`, `chrome` or `process` fails to compile — the pure-core rule, enforced by the compiler rather than by prose.
// The names below are the whole host surface the core actually uses; all three roads (Node, Deno, the browser) provide every one of them.
// The two Node-isms this core used to carry (`Buffer.byteLength`) were replaced with `TextEncoder`, which is the same UTF-8 length in all three.

declare function setTimeout(handler: () => void, timeoutMs?: number): number;
declare function clearTimeout(handle: number): void;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly hostname: string;
  readonly pathname: string;
  readonly searchParams: { get(name: string): string | null };
}

declare function atob(data: string): string;

declare const crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };

// The one Node/Deno builtin `shared/semantic-working-state.ts` carries (sha256 over completed state bytes).
// The browser never imports that module; both roads that can, provide node:crypto.

declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}
