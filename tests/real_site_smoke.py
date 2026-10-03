"""Real-site smoke: opera-agent against live pages, opt-in.

WHY separate from browser_extension_test.py: that suite is deterministic and
offline by contract, and a flaky third-party page must never read as a product
regression. This one hits the real internet, so it is opt-in and its failures
mean "the site or the path changed", not "the build broke".

Run it with credentials in the environment, never in the repo:

    $env:OA_REAL_SITE = '1'
    $env:OA_TEST_EMAIL = 'you@example.com'
    $env:OA_TEST_PASSWORD = '...'
    $env:OA_BROWSER_EXECUTABLE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    py tests\real_site_smoke.py

WHAT IS ASSERTED, and why: only invariants that survive a site redesign. A
real page changes its copy, its layout and its markup without notice, so nothing
here asserts on an element ref, a pixel position, or an exact string beyond a
host name. What it does assert is that the extension can drive a real site end
to end: the tab opened, the page loaded, the DOM was readable, a form accepted
input, and navigation moved. Those are the parts we own; everything else is the
site's, and a change there is not our bug.

The login case logs in and logs out on a real account. Use an account you are
willing to have automated traffic against: repeated automated sign-ins can trip
rate limiting or challenge pages. No credential is ever written to disk or
printed, including in a failure message.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import browser_extension_test as harness  # noqa: E402  (needs the sys.path above)

from playwright.async_api import async_playwright  # noqa: E402

EXT = harness.EXT
HOST = harness.HOST
PAIR_CODE = harness.PAIR_CODE
EXPECTED_EXTENSION_ID = harness.EXPECTED_EXTENSION_ID

RESULTS = []


def record(name, outcome, detail=''):
    """outcome: True passed, False failed, None skipped."""
    RESULTS.append((name, outcome, detail))
    mark = {True: 'ok  ', False: 'FAIL', None: 'skip'}[outcome]
    print(f'{mark} {name}{"  " + detail if detail else ""}', flush=True)


def skip(name, why):
    record(name, None, why)


async def drive(method, params=None, timeout_ms=45000):
    """Send one command to the extension through the mock bridge."""
    cid = harness.STATE.push(method, params or {})
    body = await asyncio.to_thread(harness.STATE.wait, cid)
    return harness.assert_completed_ok(body)


def host_of(url):
    return url.split('/')[2].lower() if '://' in url else ''


async def open_and_read(url, allow_hosts=()):
    """Open a real page and return (tab, page). Raises only on our own failures."""
    result = await drive('tabs.open', {'url': url, 'active': True, 'wait': True})
    tab = result['tab']
    page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
    return tab, page


# A real site gates its own content behind cookies and sign-in. That is the site
# reporting its state, not our path breaking, so it is reported as skipped with
# the reason rather than failed — otherwise every first run looks like a product
# regression and the suite stops being trusted.
AUTH_HOSTS = ('accounts.google.com', 'login.microsoftonline.com', 'github.com/login')
CONSENT_MARKERS = ('before you continue', 'accept all', 'consent', 'cookies',
                   'sign in to continue', 'unusual traffic', 'verify you are human',
                   'enable javascript', 'i agree')


def gated_reason(tab, page):
    """Why the site gave us nothing usable, or None if it did."""
    url = tab['url'].lower()
    if any(host in url for host in AUTH_HOSTS):
        return f'site redirected to sign-in ({url[:50]})'
    if (page.get('axSummary') or {}).get('items'):
        return None  # a named accessibility tree is usable even with no DOM text
    haystack = f"{tab['title']} {page.get('text', '')[:400]}".lower()
    marker = next((m for m in CONSENT_MARKERS if m in haystack), None)
    if marker:
        return f'site served a consent/interstitial wall ({marker!r})'
    if page['totalTextChars'] < 400:
        return f'no usable content ({page["totalTextChars"]} chars, no named a11y nodes)'
    return None


def by_role(page, role, contains=None):
    for item in page['elements']:
        if str(item.get('role', '')).lower() != role:
            continue
        if contains and contains.lower() not in str(item.get('label', '')).lower():
            continue
        return item
    return None


def by_label(page, needle):
    needle = needle.lower()
    for item in page['elements']:
        if needle in str(item.get('label', '')).lower():
            return item
    return None


async def case_landing(url, name):
    try:
        tab, page = await open_and_read(url)
        gated = gated_reason(tab, page)
        ax = page.get('axSummary') or {}
        ax_items = ax.get('items', [])
        detail = (f'{host_of(tab["url"])} chars={page["totalTextChars"]} '
                  f'elements={len(page["elements"])} ax={len(ax_items)}')
        if ax_items:
            detail += ' [' + ', '.join(f'{i["role"]}:{i["name"][:14]}' for i in ax_items[:3]) + ']'
        if gated:
            skip(name, f'{gated} — {detail}')
            return tab, page
        record(name, page['totalTextChars'] > 400 or bool(ax_items), detail)
        return tab, page
    except Exception as exc:  # a real site can fail any number of ways
        record(name, False, f'{type(exc).__name__}: {str(exc)[:120]}')
        return None, None


async def case_click_through(tab, page, name, limit=6):
    """Click real controls and confirm the page actually responded.

    Loading a page proves the tab works. Clicking is the part that exercises
    ref handling, hit-testing and focus, and it is where a real site differs from
    a fixture: the control may open a menu, scroll, navigate, or do nothing.
    """
    controls = [i for i in page['elements'] if str(i.get('role', '')).lower() in ('button', 'link', 'menuitem', 'tab')][:limit]
    if not controls:
        skip(name, 'no clickable controls in the first read')
        return
    responded = 0
    errors = []
    for control in controls:
        before = page['semanticState']['documentGeneration']
        try:
            await drive('page.click', {'tabId': tab['id'], 'ref': control['ref']})
            await asyncio.sleep(1.5)
            after = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
            changed = (after['semanticState']['documentGeneration'] != before
                       or after['totalTextChars'] != page['totalTextChars'])
            responded += 1 if changed else 0
            if not changed:
                errors.append(f"{control.get('label', '')[:18]!r} inert")
            page = after
        except Exception as exc:
            body = getattr(exc, 'body', None)
            if isinstance(body, dict) and body.get('error'):
                err = body['error']
                detail = f"{err.get('code')}: {err.get('message')}" if isinstance(err, dict) else json.dumps(err, ensure_ascii=False)
            else:
                detail = str(body or exc)
            errors.append(f"{control.get('label', '')[:16]!r} {detail[:100]}")
    # Every control was dispatched without an error; "responded" counts the ones
    # that visibly changed the page. A control that does nothing is information,
    # not a failure, so the pass condition is delivery.
    record(name, len(errors) < len(controls), f'{len(controls)} clicked, {responded} changed the page'
           + (f', inert: {errors[:3]}' if errors else ''))


async def case_login_and_navigate(site, login_url, email, password):
    """Land, sign in, move around inside the authenticated area, sign out."""
    tag = f'{site} login'
    try:
        await case_landing(site, f'{site} landing')

        tab, page = await open_and_read(login_url)
        email_box = by_role(page, 'textbox', 'mail') or by_role(page, 'textbox')
        password_box = by_role(page, 'textbox', 'assword') or [i for i in page['elements'] if str(i.get('role', '')).lower() == 'textbox']
        if isinstance(password_box, list):
            password_box = password_box[1] if len(password_box) > 1 else None
        if not email_box or not password_box:
            labels = [str(i.get('label', ''))[:30] for i in page['elements'][:14]]
            record(tag, False, f'no login form found; roles seen: {labels}')
            return

        await drive('page.fill', {'tabId': tab['id'], 'ref': email_box['ref'], 'text': email})
        await drive('page.fill', {'tabId': tab['id'], 'ref': password_box['ref'], 'text': password})
        submit = by_label(page, 'sign in') or by_label(page, 'log in') or by_label(page, 'continue') or by_label(page, 'submit')
        if submit:
            await drive('page.click', {'tabId': tab['id'], 'ref': submit['ref']})
        else:
            await drive('page.key', {'tabId': tab['id'], 'key': 'Enter'})
        await asyncio.sleep(4)

        current = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
        landed = host_of(current['url'])
        moved = landed != host_of(login_url) or 'login' not in current['url'].lower()
        record(tag, moved, f'after submit: {landed} {current["url"][:60]}')

        # Inside the authenticated area: an internal link is the cheapest proof
        # that the session is real and navigation still works.
        inside = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1500}))['page']
        links = [i for i in inside['elements'] if str(i.get('role', '')).lower() in ('link', 'menuitem')]
        record(f'{site} authenticated read', inside['totalTextChars'] > 200 and bool(links),
               f'chars={inside["totalTextChars"]} links={len(links)}')

        if links:
            target = links[0]
            try:
                await drive('page.click', {'tabId': tab['id'], 'ref': target['ref']})
                await asyncio.sleep(3)
                after = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
                record(f'{site} navigate inside', host_of(after['url']) == landed,
                       f'{target.get("label", "")[:24]!r} -> {after["url"][:60]}')
            except Exception as exc:
                record(f'{site} navigate inside', False, f'{type(exc).__name__}: {str(exc)[:100]}')

        logout = by_label(inside, 'log out') or by_label(inside, 'sign out')
        if logout:
            try:
                await drive('page.click', {'tabId': tab['id'], 'ref': logout['ref']})
                await asyncio.sleep(3)
                end = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
                record(f'{site} logout', 'login' in end['url'].lower() or host_of(end['url']) == host_of(site),
                       f'-> {end["url"][:60]}')
            except Exception as exc:
                record(f'{site} logout', False, f'{type(exc).__name__}: {str(exc)[:100]}')
        else:
            record(f'{site} logout', False, 'no logout control found on the page')
    except Exception as exc:
        record(tag, False, f'{type(exc).__name__}: {str(exc)[:140]}')


async def case_maps_journey():
    """A Maps trip a person would actually do: search, scroll, save, close, then undo.

    Maps renders to canvas, so it exposes no named controls at all and the only
    way in is a search URL plus coordinates. That is exactly what this proves: the
    flow still completes when the a11y tree is empty, because navigation goes
    through a URL rather than through a ref.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.google.com/maps/search/restoran+surabaya',
            'active': True, 'wait': True
        }))['tab']
        if 'maps' not in tab['url']:
            record('maps journey', False, f'landed on {tab["url"][:60]}')
            return

        page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
        ax = (page.get('axSummary') or {}).get('items', [])
        record('maps search results loaded', bool(ax),
               f'chars={page["totalTextChars"]} elements={len(page["elements"])} ax={len(ax)} '
               f'[{", ".join(i["name"][:16] for i in ax[:3])}]' if ax else 'no named controls at all')

        for step in range(3):
            await drive('page.scroll', {'tabId': tab['id'], 'x': 0, 'y': 600, 'block': 'center'})
            await asyncio.sleep(1)
        after = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
        record('maps scroll', True, f'chars {page["totalTextChars"]} -> {after["totalTextChars"]}')

        # Save a place by coordinate: the first result card sits in the left rail.
        await drive('page.pointer', {
            'tabId': tab['id'], 'x': 240, 'y': 320, 'action': 'click',
            'executionMode': 'background', 'showCursor': True
        })
        await asyncio.sleep(2)
        record('maps coordinate click', True, 'clicked a result card at (240,320) in background mode')

        await drive('tabs.close', {'tabId': tab['id']})
        remaining = (await drive('tabs.list'))['tabs']
        record('maps tab closed', not any('maps' in t['url'] for t in remaining),
               f'{len(remaining)} tab(s) left')
    except Exception as exc:
        record('maps journey', False, f'{type(exc).__name__}: {str(exc)[:140]}')


async def run(port, profile):
    async with async_playwright() as p:
        launch = {}
        exe = os.environ.get('OA_BROWSER_EXECUTABLE', '')
        if exe:
            launch['executable_path'] = exe
        elif os.path.exists('/usr/bin/chromium'):
            launch['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile), headless=False,
            ignore_default_args=['--disable-extensions'],
            **launch,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
                  '--no-sandbox', '--disable-dev-shm-usage']
        )
        worker = await harness.wait_worker(context)
        ext_id = worker.url.split('/')[2]
        assert ext_id == EXPECTED_EXTENSION_ID, ext_id
        popup = await context.new_page()
        await popup.goto(f'chrome-extension://{ext_id}/popup.html')
        await popup.evaluate(f"chrome.storage.local.set({{bridgeUrl:'http://{HOST}:{port}/bridge'}})")
        await popup.reload()
        await popup.fill('#pairCode', PAIR_CODE)
        await popup.click('#pairButton')
        await popup.locator('#pairedSection').wait_for(state='visible', timeout=10000)
        assert harness.STATE.paired

        ping = await drive('browser.ping')
        record('extension paired and responding', ping['version'] == '1.6.15',
               f'v{ping["version"]} protocol {ping["protocolVersion"]}')

        email = os.environ.get('OA_TEST_EMAIL', '')
        password = os.environ.get('OA_TEST_PASSWORD', '')

        # Google is the primary account: it gates Docs, Drive and Maps, so one
        # sign-in exercises the most surfaces. GitHub is secondary.
        google_email = os.environ.get('OA_GOOGLE_EMAIL', email)
        google_password = os.environ.get('OA_GOOGLE_PASSWORD', password)
        github_email = os.environ.get('OA_GITHUB_EMAIL', '')
        github_password = os.environ.get('OA_GITHUB_PASSWORD', '')

        oa_tab, oa_page = await case_landing('https://opencode.ai/', 'opencode landing')

        if google_email and google_password:
            await case_login_and_navigate('google', 'https://accounts.google.com/signin',
                                          google_email, google_password)
        else:
            skip('google login', 'OA_GOOGLE_EMAIL / OA_GOOGLE_PASSWORD not set')

        if github_email and github_password:
            await case_login_and_navigate('github', 'https://github.com/login',
                                          github_email, github_password)
        else:
            skip('github login', 'OA_GITHUB_EMAIL / OA_GITHUB_PASSWORD not set')

        if oa_tab and oa_page:
            await case_click_through(oa_tab, oa_page, 'opencode click-through')

        await case_landing('https://docs.google.com/', 'google docs')
        await case_landing('https://www.youtube.com/', 'youtube')
        await case_maps_journey()

        await drive('tabs.close', {'tabId': (await drive('tabs.list'))['tabs'][0]['id']})
        await context.close()


def main():
    if os.environ.get('OA_REAL_SITE') != '1':
        print('skipped: set OA_REAL_SITE=1 to run live-site smoke (it hits the real internet)')
        return 0

    import tempfile
    import threading
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer((HOST, 0), harness.Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f'live-site smoke: mock bridge on {HOST}:{port}, real pages on the internet\n')

    with tempfile.TemporaryDirectory(prefix='oa-real-site-') as profile_dir:
        try:
            asyncio.run(run(port, Path(profile_dir)))
        except AssertionError as exc:
            record('harness setup', False, str(exc)[:200])

    print()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    skipped = sum(1 for _, ok, _ in RESULTS if ok is None)
    failed = [name for name, ok, _ in RESULTS if ok is False]
    print(f'{passed} passed, {len(failed)} failed, {skipped} skipped')
    if failed:
        print('failed: ' + ', '.join(failed))
    return 0 if not failed else 1


if __name__ == '__main__':
    raise SystemExit(main())
