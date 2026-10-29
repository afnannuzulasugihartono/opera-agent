// @last-edited: 2026-10-13 UTC+7.
// @title: docs-ui-map — the Docs menu and dialog labels both locales use.
// @state: canonical English paths with Indonesian translations and verify selectors; workflows consume it instead of hardcoding labels.
// @dependencies: none.

// WHY a map instead of hardcoded labels.
// Menu text differs by locale, and a label baked into a workflow is a workflow that only works in one language.
// The map holds researched labels (Google support pages, id locale) keyed by canonical English path segments; resolveMenuTarget localizes a path and hands back the verify selector with it.
// Unresearched labels stay out until live evidence promotes them — a miss fails loudly, never clicks blind.

const MENU_SELECTOR = "[role='menu'], [role='menuitem']";
const DIALOG_SELECTOR = "[role='dialog']";
const PICKER_SELECTOR = "[role='menuitem'][aria-label], [role='gridcell'], [role='menu'] [role='menuitem']";

const ENTRIES = {
  File: {
    id: 'File',
    verify: MENU_SELECTOR
  },
  Edit: {
    id: 'Edit',
    verify: MENU_SELECTOR
  },
  View: {
    id: 'Lihat',
    verify: MENU_SELECTOR
  },
  Insert: {
    id: 'Sisipkan',
    verify: MENU_SELECTOR
  },
  Format: {
    id: 'Format',
    verify: MENU_SELECTOR
  },
  Tools: {
    id: 'Alat',
    verify: MENU_SELECTOR
  },
  Table: {
    id: 'Tabel',
    verify: MENU_SELECTOR
  },
  Image: {
    id: 'Gambar',
    verify: MENU_SELECTOR
  },
  'By URL': {
    id: 'Menurut URL',
    verify: MENU_SELECTOR
  },
  Footnote: {
    id: 'Catatan kaki',
    verify: MENU_SELECTOR
  },
  Header: {
    id: 'Header',
    verify: MENU_SELECTOR
  },
  Footer: {
    id: 'Footer',
    verify: MENU_SELECTOR
  },
  'Headers & footers': {
    id: 'Header & footer',
    verify: MENU_SELECTOR
  },
  'Page numbers': {
    id: 'Nomor halaman',
    verify: MENU_SELECTOR
  },
  'Table of contents': {
    id: 'Daftar isi',
    verify: MENU_SELECTOR
  },
  'Page setup': {
    id: 'Penyiapan halaman',
    verify: MENU_SELECTOR
  },
  'Paragraph styles': {
    id: 'Gaya paragraf',
    verify: MENU_SELECTOR
  },
  Download: {
    id: 'Download',
    verify: MENU_SELECTOR
  },
  PDF: {
    id: 'Dokumen PDF (.pdf)',
    verify: MENU_SELECTOR
  },
  'Heading 1': {
    id: 'Heading 1',
    verify: MENU_SELECTOR
  },
  'Heading 2': {
    id: 'Heading 2',
    verify: MENU_SELECTOR
  },
  'Heading 3': {
    id: 'Heading 3',
    verify: MENU_SELECTOR
  },
  'Automatic 1': {
    id: 'Otomatis 1',
    verify: MENU_SELECTOR
  },
  'Upload from computer': {
    id: 'Unggah dari komputer',
    verify: MENU_SELECTOR
  },
  'PDF Document (.pdf)': {
    id: 'Dokumen PDF (.pdf)',
    verify: MENU_SELECTOR
  },
  '1 x 1': {
    id: '1 x 1',
    verify: PICKER_SELECTOR
  },
  Top: {
    id: 'Atas',
    verify: DIALOG_SELECTOR
  },
  Bottom: {
    id: 'Bawah',
    verify: DIALOG_SELECTOR
  },
  Left: {
    id: 'Kiri',
    verify: DIALOG_SELECTOR
  },
  Right: {
    id: 'Kanan',
    verify: DIALOG_SELECTOR
  },
  OK: {
    id: 'Oke',
    verify: DIALOG_SELECTOR
  },
};

export const MENU_MAP = Object.freeze(
  Object.fromEntries(Object.entries(ENTRIES).map(([
    en,
    entry
  ]) => [
    en,
    Object.freeze({ ...entry })
  ]))
);

export function resolveMenuTarget(
  path,
  locale = 'en'
) {
  const segments = Array.isArray(path) ? path : [path];
  if (!segments.length) return null;
  const lowered = Object.fromEntries(
    Object.keys(MENU_MAP).map((name) => [
      name.toLowerCase(),
      name
    ])
  );
  const labels = [];
  for (const segment of segments) {
    const canonical = lowered[String(segment).toLowerCase()];
    if (!canonical) return null;
    labels.push(locale === 'id' ? MENU_MAP[canonical].id : canonical);
  }
  return {
    labels,
    verify: { selector: MENU_MAP[lowered[String(segments[segments.length - 1]).toLowerCase()]].verify }
  };
}
