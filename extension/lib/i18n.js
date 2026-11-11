// @last-edited: 2026-11-11 UTC+7.
// @title: i18n - every word the extension shows, in one table per language.
// @state: id and en; the next language is a table of the same keys, nothing else.
// @dependencies: none.

// WHY THE WORDS LIVE IN A TABLE AND NOT IN THE MARKUP.
// One reader opens the popup in Indonesian and another in English, and the layout does not change with the language - the words must not change it either.
// A table per language keeps the swap total, and a new language is a new table of the same keys and nothing else.
// The reader's language is the browser's language; anything that is not Indonesian falls back to English, which is the table every key is checked against.

const ID = {
  'status.starting': 'Memulai…',
  'status.connected': 'Terhubung',
  'status.connecting': 'Menghubungkan…',
  'status.reconnecting': 'Menyambung ulang…',
  'status.disconnected': 'Terputus',
  'status.notPaired': 'Belum dipair',
  'doors.dashboard': 'Buka Dashboard',
  'doors.docs': 'Dokumentasi',
  'doors.pairing': 'Pairing',
  'doors.updateAuto': 'Update otomatis',
  'doors.updateNow': 'Perbarui sekarang',
  'doors.forgetFolder': 'Lupakan folder',
  'pair.title': 'Sambungkan device',
  'pair.label': 'Kode pairing',
  'pair.placeholder': 'Tempel kode dari dashboard',
  'pair.submit': 'Sambungkan',
  'pair.hintBefore': 'Buat kode di ',
  'pair.hintLink': 'Pairing',
  'pair.hintAfter': ', lalu tempel di sini.',
  'update.available': 'Versi {v} sudah tersedia.',
  'update.download': 'Unduh {v}',
  'update.now': 'Perbarui sekarang',
  'reload.extension': 'Muat ulang ekstensi',
  'update.closeable': 'Halaman ini boleh ditutup. Worker extension pull update seperti git pull — tanpa unduh, tanpa muat ulang manual.',
  'update.title': 'Update otomatis — Opera Agent',
  'update.state.granted': 'Folder: {name}',
  'update.state.prompt': 'Izin folder perlu diulang',
  'update.state.none': 'Belum diizinkan',
  'update.pickLabel': 'Izinkan folder extension',
  'update.pickAgain': 'Izinkan lagi',
  'update.pickFailed': 'Browser ini tidak memberi izin folder: {message}',
  'update.pickAbort': 'Pemilih folder ditutup tanpa memilih apa pun.',
  'update.braveFlag': 'Browser ini menyembunyikan File System Access API. Brave menyembunyikannya di balik flag: brave://flags, cari file-system-access-api, pilih Enabled, lalu Relaunch. Chrome, Edge, Opera dan Vivaldi sudah punya.',
  'update.failed': 'Update gagal: {message}',
  'update.needsFolder': 'Update otomatis belum bisa jalan: folder atau izinnya belum ada.',
  'update.upToDate': 'Sudah terbaru ({v}).',
  'footer.brand': 'Privasi sejak awal. Berjalan di latar.',
  'footer.help': 'Bantuan',
  'footer.changes': 'Catatan perubahan',
  'footer.source': 'Kode sumber di GitHub',
  'popup.title': 'Opera Agent'
};

const EN = {
  'status.starting': 'Starting…',
  'status.connected': 'Connected',
  'status.connecting': 'Connecting…',
  'status.reconnecting': 'Reconnecting…',
  'status.disconnected': 'Disconnected',
  'status.notPaired': 'Not paired',
  'doors.dashboard': 'Open Dashboard',
  'doors.docs': 'Documentation',
  'doors.pairing': 'Pairing',
  'doors.updateAuto': 'Automatic updates',
  'doors.updateNow': 'Update now',
  'doors.forgetFolder': 'Forget the folder',
  'pair.title': 'Connect a device',
  'pair.label': 'Pairing code',
  'pair.placeholder': 'Paste the code from the dashboard',
  'pair.submit': 'Connect',
  'pair.hintBefore': 'Create a code in ',
  'pair.hintLink': 'Pairing',
  'pair.hintAfter': ', then paste it here.',
  'update.available': 'Version {v} is available.',
  'update.download': 'Download {v}',
  'update.now': 'Update now',
  'reload.extension': 'Reload the extension',
  'update.closeable': 'You can close this page. The extension worker pulls the update like git pull — no download, no manual reload.',
  'update.title': 'Automatic updates — Opera Agent',
  'update.state.granted': 'Folder: {name}',
  'update.state.prompt': 'The folder permission needs to be granted again',
  'update.state.none': 'Not allowed yet',
  'update.pickLabel': 'Allow the extension folder',
  'update.pickAgain': 'Allow it again',
  'update.pickFailed': 'This browser does not grant folder access: {message}',
  'update.pickAbort': 'The folder picker was closed without choosing anything.',
  'update.braveFlag': 'This browser hides the File System Access API. Brave hides it behind a flag: brave://flags, search for file-system-access-api, set it to Enabled, then Relaunch. Chrome, Edge, Opera and Vivaldi carry it.',
  'update.failed': 'The update failed: {message}',
  'update.needsFolder': 'Automatic updates cannot run yet: the folder or its permission is missing.',
  'update.upToDate': 'Already up to date ({v}).',
  'footer.brand': 'Private from day one. Runs in the background.',
  'footer.help': 'Help',
  'footer.changes': 'Changelog',
  'footer.source': 'Source on GitHub',
  'popup.title': 'Opera Agent'
};

const DICTIONARIES = Object.freeze({ id: Object.freeze(ID), en: Object.freeze(EN) });

const raw = String((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en').toLowerCase();
const language = raw.startsWith('id') ? 'id' : 'en';

export { language };

export function t(key, vars = {}) {
  const table = DICTIONARIES[language] ?? DICTIONARIES.en;
  const template = table[key] ?? DICTIONARIES.en[key];
  if (template === undefined) return key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

// WHY THE APPLIER IS ONE PASS OVER THE MARKUP.
// The words are declared where they are shown, so the layout can never drift from the table; one pass fills them on load.

export function applyI18n(root = document) {
  if (typeof root?.querySelectorAll !== 'function') return;
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.getAttribute('data-i18n') || '');
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder') || ''));
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria') || ''));
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.setAttribute('title', t(node.getAttribute('data-i18n-title') || ''));
  }
  const langNode = root.documentElement ?? root.querySelector?.('html');
  if (langNode) langNode.setAttribute('lang', language);
  const titleNode = root.querySelector?.('title[data-i18n]');
  if (titleNode?.getAttribute('data-i18n')) document.title = t(titleNode.getAttribute('data-i18n'));
}
