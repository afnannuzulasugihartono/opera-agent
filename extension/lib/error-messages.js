// @last-edited: 2026-10-06 09:58 UTC+7.
// @title: error-messages — messages — User-facing error mapping for the popup and options page (page lang `id`).
// @state: lock store error strings against mapper drift.
// @dependencies: none.

// User-facing error mapping for the popup and options page (page lang `id`).

// Background-supplied strings can carry raw internals (fetch TypeErrors, `HTTP <status>`, gateway `data.error`, chrome tab errors, truncated `lastError` payloads).
// Only exact static source strings are mapped; every dynamic, unknown, or token-shaped input falls back to GENERIC so raw internals never reach the popup label.
// The two options-page keys below are client-side settings validation literals thrown by `lib/options-store.js` (static, authored here, safe to surface), not backend internals.

// Source strings stay English because that is what the background throws; the shown strings are Indonesian because that is what the reader reads.

const KNOWN = new Map([
  ['Pairing failed.', 'Pairing gagal. Periksa kode lalu coba lagi.'],
  ['Unable to update tab privacy.', 'Tab ini tidak bisa diperbarui. Muat ulang halaman lalu coba lagi.'],
  ['Invalid pairing code.', 'Kode pairing itu tidak valid. Periksa kode lalu coba lagi.'],
  ['Invalid tabId.', 'Tab ini tidak bisa diperbarui. Muat ulang halaman lalu coba lagi.'],
  ['Invalid bridge URL.', 'Alamat bridge tidak valid. Periksa alamat lalu coba lagi.'],
  [
    'Enter an https:// URL or leave empty to reset.',
    'Masukkan alamat https://, atau kosongkan untuk memakai bridge bawaan.',
  ],
  [
    'Log level must be debug, warn, or error.',
    'Pilih level log: debug, warn, atau error.',
  ],
  [
    'Enter an https:// URL for the model endpoint, or a loopback http:// address for a local model.',
    'Masukkan alamat https:// untuk endpoint model, atau alamat http:// loopback bila model berjalan di mesin ini.',
  ],
  [
    'Enter a model name of 1 to 120 characters.',
    'Masukkan nama model dari providermu, hingga 120 karakter.',
  ],
]);

const GENERIC = 'Terjadi kesalahan. Jalankan uji mandiri, lalu periksa koneksi.';

export function userErrorMessage(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (KNOWN.has(text)) return KNOWN.get(text);
  return GENERIC;
}
