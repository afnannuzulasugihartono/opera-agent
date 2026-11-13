// @last-edited: 2026-11-13 UTC+7.
// @title: socket-protocol — declarations for the generated copy beside it, never committed at runtime.
// @state: compiles against the emitted socket-protocol.js copy; names mirror extension/lib/socket-protocol.js exactly.
// @dependencies: none.

export const FRAME_MAX_BYTES: number;
export const DEVICE_PROTOCOL_VERSION: number;
export const GZIP_FRAME_VERSION: number;
export interface ParsedFrame {
  ok: boolean;
  message?: Record<string, unknown>;
}
export function handshakeFrame(token: string, deviceName: string, instanceId?: string, extensionVersion?: string): Record<string, unknown>;
export function completionFrame(commandId: string, ok: boolean, result: unknown, error?: unknown): Record<string, unknown>;
export function encodeCompletionFrame(commandId: string, ok: boolean, result: unknown, error?: unknown): Promise<Record<string, unknown>>;
export function parseFrame(raw: string | Buffer | ArrayBuffer, maxBytes?: number): ParsedFrame;
export function pongFrame(): Record<string, unknown>;
export function isRunnableCommand(message: unknown): boolean;
export function normalizeCommand(message: unknown): Record<string, unknown> | null;
export function isReady(message: unknown): boolean;
export function isFatalClose(code: unknown): boolean;
