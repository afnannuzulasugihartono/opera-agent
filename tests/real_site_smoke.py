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


def record(name, ok, detail=''):
    RESULTS.append((name, ok, detail))
    mark = 'ok  ' if ok else 'FAIL'
    print(f'{mark} {name}{"  " + detail if detail else ""}', flush=True)


async def drive(method, params=None, timeout_ms=45000):
    """Send one command to the extension through the mock bridge."""
    cid = harness.STATE.push(method, params or {})
    body = await asyncio.to_thread(harness.STATE.wait, cid)
    return harness.assert_completed_ok(body)


def host_of(url):
    return url.split('/')[2].lower() if '://' in url else ''


async def open_and_read(url, wait_ms=20000):
    """Open a real page and return (tab_id, page_payload)."""
    result = await drive('tabs.open', {'url': url, 'active': True, 'wait': True})
    tab = result['tab']
    if host_of(tab['url']) != host_of(url):
        raise AssertionError(f'redirected {url} -> {tab["url"]}')
    page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
    return tab, page


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
        record(name, page['totalTextChars'] > 200,
               f'{host_of(tab["url"])} title={tab["title"][:40]!r} chars={page["totalTextChars"]} elements={len(page["elements"])}')
    except Exception as exc:  # a real site can fail any number of ways
        record(name, False, f'{type(exc).__name__}: {str(exc)[:120]}')


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

        await case_landing('https://opencode.ai/', 'opencode landing')

        if google_email and google_password:
            await case_login_and_navigate('google', 'https://accounts.google.com/signin',
                                          google_email, google_password)
        else:
            record('google login', False, 'OA_GOOGLE_EMAIL / OA_GOOGLE_PASSWORD not set')

        if github_email and github_password:
            await case_login_and_navigate('github', 'https://github.com/login',
                                          github_email, github_password)
        else:
            record('github login', False, 'OA_GITHUB_EMAIL / OA_GITHUB_PASSWORD not set')

        await case_landing('https://docs.google.com/', 'google docs')
        await case_landing('https://www.youtube.com/', 'youtube')
        await case_landing('https://www.google.com/maps', 'google maps')

        await drive('tabs.close', {'tabId': (await drive('tabs.list'))['tabs'][0]['id']})
        await context.close()


def main():
    if os.environ.get('OA_REAL_SITE') != '1':
        print('skipped: set OA_REAL_SITE=1 to run live-site smoke (it hits the real internet)')
        return 0

    import tempfile
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer((HOST, 0), harness.Handler)
    port = server.server_address[1]
    threading_started = __import__('threading').Thread(target=server.serve_forever, daemon=True)
    threading_started.start()
    print(f'live-site smoke: mock bridge on {HOST}:{port}, real pages on the internet\n')

    with tempfile.TemporaryDirectory(prefix='oa-real-site-') as profile_dir:
        try:
            asyncio.run(run(port, Path(profile_dir.name)))
        except AssertionError as exc:
            record('harness setup', False, str(exc)[:200])

    print()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [name for name, ok, _ in RESULTS if not ok]
    print(f'{passed}/{len(RESULTS)} passed')
    if failed:
        print('failed: ' + ', '.join(failed))
    return 0 if not failed else 1


if __name__ == '__main__':
    raise SystemExit(main())
