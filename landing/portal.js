/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: portal - the account fold in the masthead: one shared builder injects the door and the dialog; the reader opens and closes it; its banner carries three facts the reader can walk past.
 * @state: click toggles, Escape closes, click outside closes, Tab walks the doors inside; the banner chevrons cycle the three messages, and the timer only turns while the fold is open.
 * Pages carry two mounts (data-portal-toggle, data-portal-menu), never the markup itself.
 * @dependencies: site.css (.portalMenu, .navPortal, .portalBannerMsg).
 */

// WHY THE PORTAL IS BUILT HERE AND NOT COPIED INTO SIXTEEN PAGES.
// The fold was authored markup on every page, so its doors had to be corrected page by page and the copies drifted - the shared builder means one place defines the dialog, the banner and the chevrons.
// WHY THE PORTAL FOLDS FROM THE NAV, NOT THE BODY: the account door is a door in the masthead; a page-wide overlay is for a question, not for choosing where your work lives.
// WHY IT CLOSES ON ESCAPE AND ON A CLICK OUTSIDE: a reader who opens it must be able to wave it away without finding the close button.

(function () {
  'use strict';

  var NAV_TOGGLE = `<button class="navPortal" id="navPortalToggle" type="button" aria-expanded="false" aria-controls="portalMenu"><span data-i18n="nav.portal">Portal</span><svg class="navPortalChevron" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></button>`;
  var PORTAL_MENU = `    <div class="portalMenu" id="portalMenu" role="dialog" aria-modal="false" aria-labelledby="portalBannerLink" hidden>
      <div class="portalBanner">
        <a class="portalBannerLink" id="portalBannerLink" href="./akun.html">
          <span class="portalBannerMark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="13"/><path d="M3 16h26"/><ellipse cx="16" cy="16" rx="13" ry="5.6"/></svg></span>
          <span class="portalBannerText"><span class="portalBannerLinkText" data-i18n="portal.banner.link">Portal Opera Agent</span><span class="portalBannerRest"><span class="portalBannerMsg" data-i18n="portal.banner.m1">Satu akun. Semua model. Semua device.</span><span class="portalBannerMsg" data-i18n="portal.banner.m2" hidden>Bayar per pekerjaan selesai.</span><span class="portalBannerMsg" data-i18n="portal.banner.m3" hidden>Data tidak pernah meninggalkan device.</span></span></span>
        </a>
        <div class="portalBannerNav">
          <button class="portalBannerChev" id="portalBannerPrev" type="button" data-i18n-attr="aria-label:portal.banner.prev" aria-label="Pesan sebelumnya"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg></button>
          <button class="portalBannerChev" id="portalBannerNext" type="button" data-i18n-attr="aria-label:portal.banner.next" aria-label="Pesan berikutnya"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
      </div>
      <div class="portalBody">
        <div class="portalRow">
          <div class="portalBigCol">
            <p class="portalKind" data-i18n="portal.label.platform">Platform</p>
            <p class="portalBig" data-i18n="portal.big.platform">Portal</p>
          </div>
          <ul class="portalDoors">
            <li><a class="portalDoor" href="./docs.html" role="menuitem">
              <span class="portalDoorName" data-i18n="portal.overview.title">Ikhtisar</span>
              <span class="portalDoorDesc" data-i18n="portal.overview.body">Hubungkan agent ke setiap device</span>
              <svg class="portalArrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M17 7H9M17 7v8"/></svg>
            </a></li>
            <li><a class="portalDoor" href="./harga.html" role="menuitem">
              <span class="portalDoorName" data-i18n="portal.plans.title">Paket</span>
              <span class="portalDoorDesc" data-i18n="portal.plans.body">Harga tetap per pekerjaan selesai</span>
              <svg class="portalArrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M17 7H9M17 7v8"/></svg>
            </a></li>
            <li><a class="portalDoor" href="./unduh.html" role="menuitem">
              <span class="portalDoorName" data-i18n="portal.referrals.title">Mulai dari sini</span>
              <span class="portalDoorDesc" data-i18n="portal.referrals.body">Pasang extension, pair sekali, lalu kerja</span>
              <svg class="portalArrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M17 7H9M17 7v8"/></svg>
            </a></li>
          </ul>
        </div>
        <div class="portalDivider" aria-hidden="true"></div>
        <div class="portalRow">
          <div class="portalBigCol">
            <p class="portalKind" data-i18n="portal.label.access">Akun</p>
            <p class="portalBig" data-i18n="portal.big.access">Akses</p>
          </div>
          <ul class="portalDoors">
            <li><a class="portalDoor" href="./index.html" role="menuitem">
              <span class="portalDoorName" data-i18n="portal.signin.title">Masuk</span>
              <span class="portalDoorDesc" data-i18n="portal.signin.body">Lanjutkan ke dashboard Anda</span>
              <svg class="portalArrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M17 7H9M17 7v8"/></svg>
            </a></li>
            <li><a class="portalDoor" href="./index.html" role="menuitem">
              <span class="portalDoorName" data-i18n="portal.signup.title">Akun baru</span>
              <span class="portalDoorDesc" data-i18n="portal.signup.body">Satu akun untuk semua device</span>
              <svg class="portalArrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M17 7H9M17 7v8"/></svg>
            </a></li>
          </ul>
        </div>
      </div>
    </div>`;

  function build() {
    var toggleMount = document.querySelector('[data-portal-toggle]');

    if (toggleMount) toggleMount.outerHTML = NAV_TOGGLE;

    var menuMount = document.querySelector('[data-portal-menu]');

    if (menuMount) menuMount.outerHTML = PORTAL_MENU;
  }

  build();

  var toggle = document.getElementById('navPortalToggle');
  var menu = document.getElementById('portalMenu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
  }

  function isOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  toggle.addEventListener('click', function () {
    setOpen(!isOpen());
  });

  menu.addEventListener('click', function (event) {
    var door = event.target.closest('a');
    if (door) setOpen(false);
  });

  document.addEventListener('pointerdown', function (event) {
    if (!isOpen()) return;
    var inside = menu.contains(event.target) || toggle.contains(event.target);
    if (!inside) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !isOpen()) return;
    setOpen(false);
    toggle.focus();
  });

  var msgs = menu.querySelectorAll('.portalBannerMsg');
  var prev = document.getElementById('portalBannerPrev');
  var next = document.getElementById('portalBannerNext');

  if (msgs.length > 1 && prev && next) {
    var index = 0;
    var reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function show(i) {
      index = ((i % msgs.length) + msgs.length) % msgs.length;
      for (var k = 0; k < msgs.length; k += 1) {
        msgs[k].hidden = k !== index;
      }
    }

    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });

    if (!reduced) {
      window.setInterval(function () {
        if (isOpen() && !document.hidden) show(index + 1);
      }, 4500);
    }
  }
})();
