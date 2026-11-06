// @last-edited: 2026-11-05 UTC+7.
// @title: palette - one search door for the whole site: Ctrl or Cmd plus K opens a list of pages and sections, and the arrow keys walk it.
// @state: one dialog built at run time; it filters a static list of destinations and leaves the page alone when the script never arrives.
// @dependencies: none.

// WHY THIS FILE EXISTS: measured against docs.firecrawl.dev on 2026-11-05, a reader searches the site from a dialog instead of hunting the nav row.
// One shared file keeps the doors in one place, and a page that never loads it keeps the nav it had.
// WHY THE LIST IS WRITTEN HERE AND NOT SCRAPED: the nav row is five doors, and a reader who asks for a section of the guide asks for something the nav does not carry.
// WHY THE DIALOG IS BUILT AT RUN TIME: eleven pages would otherwise carry the same markup, and a copy of a dialog is a copy that drifts.

const STRINGS = {
  id: { label: 'Cari halaman', placeholder: 'Cari halaman atau bagian', empty: 'Tidak ada yang cocok.', all: 'Semua halaman', key: 'Ctrl K' },
  en: { label: 'Search pages', placeholder: 'Search pages and sections', empty: 'Nothing matches.', all: 'All pages', key: 'Ctrl K' }
};

const DESTINATIONS = [
  { path: '/beranda.html', id: 'Beranda', en: 'Home', hint: { id: 'Mulai dari sini', en: 'Start here' }, keys: 'beranda home mulai awal ringkasan overview' },
  { path: '/fitur.html', id: 'Fitur', en: 'Features', hint: { id: 'Yang bisa dikerjakan', en: 'What it can do' }, keys: 'fitur features kemampuan bento tugas capability' },
  { path: '/studi.html', id: 'Studi kasus', en: 'Case study', hint: { id: 'Satu file jadi empat berkas', en: 'One file becomes four files' }, keys: 'studi kasus case study contoh sample laporan excel deck pptx word docx' },
  { path: '/bukti.html', id: 'Bukti', en: 'Proof', hint: { id: 'Satu jalannya, empat berkas', en: 'One run, four files' }, keys: 'bukti proof hash sha256 jalannya run record bukti jalan' },
  { path: '/harga', id: 'Harga', en: 'Pricing', hint: { id: 'Biaya dan saldo', en: 'Cost and balance' }, keys: 'harga pricing biaya cost saldo top up money' },
  { path: '/unduh.html', id: 'Unduh', en: 'Download', hint: { id: 'Extension browser', en: 'Browser extension' }, keys: 'unduh download extension pasang install chrome' },
  { path: '/unduh-berkas.html', id: 'Berkas', en: 'Files', hint: { id: 'Berkas rilis', en: 'Release files' }, keys: 'berkas files zip rilis release' },
  { path: '/docs.html', id: 'Docs', en: 'Docs', hint: { id: 'Panduan', en: 'The guide' }, keys: 'docs panduan guide baca read' },
  { path: '/docs#pasang', id: 'Pasang extension', en: 'Install the extension', hint: { id: 'Mulai', en: 'Start' }, keys: 'pasang install extension' },
  { path: '/docs#pairing', id: 'Pair device', en: 'Pair a device', hint: { id: 'Kode sekali pakai', en: 'One time code' }, keys: 'pair pairing device kode' },
  { path: '/docs#tugas', id: 'Tugas pertama', en: 'First job', hint: { id: 'Prompt jadi hasil', en: 'Prompt to result' }, keys: 'tugas job pertama perintah prompt hasil result' },
  { path: '/docs#saldo', id: 'Saldo', en: 'Balance', hint: { id: 'Isi dan tagihan', en: 'Top up and billing' }, keys: 'saldo balance tagihan billing qr' },
  { path: '/docs#mcp', id: 'Hubungkan AI harness', en: 'Connect an AI harness', hint: { id: 'MCP', en: 'MCP' }, keys: 'mcp opencode kilo claude harness konektor connector' },
  { path: '/docs#batas', id: 'Batas yang dijaga', en: 'The limits kept', hint: { id: 'Yang ditolak', en: 'What is refused' }, keys: 'batas limits izin permissions tolak refuse' },
  { path: '/dukungan.html', id: 'Dukungan', en: 'Support', hint: { id: 'Bantuan', en: 'Help' }, keys: 'dukungan support bantuan help' },
  { path: '/dashboard.html', id: 'Dashboard', en: 'Dashboard', hint: { id: 'Panel', en: 'Panel' }, keys: 'dashboard dasbor panel' },
  { path: '/akun.html', id: 'Akun', en: 'Account', hint: { id: 'Akun Anda', en: 'Your account' }, keys: 'akun account profil profile' },
  { path: '/privasi.html', id: 'Privasi', en: 'Privacy', hint: { id: 'Data', en: 'Data' }, keys: 'privasi privacy data' },
  { path: '/syarat.html', id: 'Syarat', en: 'Terms', hint: { id: 'Ketentuan', en: 'Conditions' }, keys: 'syarat terms ketentuan' },
  { path: '/', id: 'Masuk', en: 'Sign in', hint: { id: 'Akun', en: 'Account' }, keys: 'masuk sign in login akun' }
];

const MARKUP = [
  '<div class="paletteBar">',
  '  <svg class="paletteIcon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M10.6 10.6 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>',
  '  <input class="paletteInput" type="text" role="combobox" aria-expanded="true" aria-controls="paletteList" aria-autocomplete="list" autocomplete="off" spellcheck="false">',
  '  <kbd class="paletteKey">Esc</kbd>',
  '</div>',
  '<p class="paletteCaption"></p>',
  '<ul class="paletteList" id="paletteList" role="listbox"></ul>',
  '<p class="paletteEmpty" hidden></p>'
].join('');

const language = () => (window.OperaAgentI18n && window.OperaAgentI18n.getLang() === 'en' ? 'en' : 'id');

const words = () => STRINGS[language()];

const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || '');

const keyHint = () => (isApple() ? 'Cmd K' : 'Ctrl K');

const haystack = (item) => [item.id, item.en, item.hint.id, item.hint.en, item.keys].join(' ').toLowerCase();

const matches = (item, query) => query.split(/\s+/).every((word) => haystack(item).includes(word));

const start = () => {
  document.documentElement.classList.add('hasPalette');

  const dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.innerHTML = MARKUP;
  document.body.appendChild(dialog);

  const input = dialog.querySelector('.paletteInput');
  const list = dialog.querySelector('.paletteList');
  const empty = dialog.querySelector('.paletteEmpty');
  const caption = dialog.querySelector('.paletteCaption');
  const button = document.querySelector('.navSearch');
  let hits = [];
  let cursor = 0;

  const label = () => {
    const text = words();
    input.placeholder = text.placeholder;
    empty.textContent = text.empty;
    caption.textContent = text.all;
    dialog.setAttribute('aria-label', text.label);
    if (button) {
      button.setAttribute('aria-label', text.label);
      const hint = button.querySelector('.navSearchKey');
      if (hint) hint.textContent = keyHint();
    }
  };

  const move = (index) => {
    if (hits.length === 0) return;
    cursor = (index + hits.length) % hits.length;
    for (const [position, row] of [...list.children].entries()) {
      row.setAttribute('aria-selected', position === cursor ? 'true' : 'false');
      row.classList.toggle('isActive', position === cursor);
    }
    input.setAttribute('aria-activedescendant', `paletteOpt${cursor}`);
    list.children[cursor].scrollIntoView({ block: 'nearest' });
  };

  const go = (item) => {
    window.location.href = item.path;
  };

  const paint = () => {
    const query = input.value.trim().toLowerCase();
    const limit = query === '' ? DESTINATIONS.length : 8;
    hits = (query === '' ? DESTINATIONS : DESTINATIONS.filter((item) => matches(item, query))).slice(0, limit);
    cursor = 0;
    list.textContent = '';
    for (const [index, item] of hits.entries()) {
      const row = document.createElement('li');
      row.className = 'paletteItem';
      row.id = `paletteOpt${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      row.classList.toggle('isActive', index === 0);
      const title = document.createElement('span');
      title.className = 'paletteLabel';
      title.textContent = language() === 'en' ? item.en : item.id;
      const hint = document.createElement('span');
      hint.className = 'paletteHint';
      hint.textContent = language() === 'en' ? item.hint.en : item.hint.id;
      row.append(title, hint);
      row.addEventListener('mouseenter', () => move(index));
      row.addEventListener('click', () => go(item));
      list.appendChild(row);
    }
    empty.hidden = hits.length > 0;
    caption.hidden = query !== '';
    input.setAttribute('aria-activedescendant', hits.length > 0 ? 'paletteOpt0' : '');
  };

  const open = () => {
    label();
    paint();
    if (!dialog.open) dialog.showModal();
    input.focus();
    input.select();
  };

  const close = () => {
    if (dialog.open) dialog.close();
    input.value = '';
  };

  input.addEventListener('input', paint);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(cursor + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(cursor - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (hits[cursor]) go(hits[cursor]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) close();
      else open();
    }
  });

  if (button) button.addEventListener('click', open);

  label();
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
