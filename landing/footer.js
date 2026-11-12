/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: footer - the legal and the map, built from one canonical block onto every mount; the reader always knows where the rules live.
 * @state: one builder injects the shared footer onto [data-footer-mount] mounts; pages that need an authored variant keep their own and carry no mount.
 * @dependencies: site.css (.footGrid, .footCol, .footBrand, .doors), i18n-dict on the page (footer.* keys).
 */

// WHY THE FOOTER IS BUILT HERE AND NOT COPIED INTO NINE PAGES.
// The nine pages that carry the shared footer were byte-identical copies, so a link fixed in one stayed broken in the other eight.
// The pages with an authored variant (harga carries the Akun column, akun is Bahasa-only by design, dashboard keys footer.copy, mcp leads with the install door, dukungan marks the current page) keep their inline footer on purpose.

(function () {
  'use strict';

  var FOOTER_INNER = `    <div class="wrap footGrid simplified">
      <div class="footCol">
        <span class="footBrand">Opera Agent</span>
        <span class="footNote" data-i18n="footer.rights">© 2026 Opera Agent. Hak cipta dilindungi.</span>
        <span class="doors"><a href="https://github.com/afnannuzulasugihartono/opera-agent" data-i18n="footer.source">Kode sumber</a></span>
      </div>
      <div class="footCol">
        <h3 data-i18n="footer.product">Produk</h3>
        <span class="doors">
          <a href="./beranda.html" data-i18n="footer.home">Beranda</a>
          <a href="./fitur.html" data-i18n="footer.features">Fitur</a>
          <a href="./unduh.html" data-i18n="footer.download">Unduh</a>
          <a href="./mcp.html">Pasang MCP</a>
          <a href="./bukti.html" data-i18n="footer.bukti">Bukti</a>
          <a href="./docs.html" data-i18n="footer.docs">Docs</a>
          <a href="./harga.html">Harga</a>
          <a href="./akun.html" data-i18n="footer.account">Akun</a>
          <a href="./dashboard.html">Dashboard</a>
        </span>
      </div>
      <div class="footCol">
        <h3 data-i18n="footer.legal">Legal</h3>
        <span class="doors">
          <a href="./privasi.html" data-i18n="footer.privacy">Privasi</a>
          <a href="./syarat.html" data-i18n="footer.terms">Syarat</a>
          <a href="./dukungan.html" data-i18n="footer.support">Dukungan</a>
        </span>
      </div>
    </div>`;

  var mount = document.querySelector('[data-footer-mount]');

  if (mount) mount.outerHTML = FOOTER_INNER;
})();
