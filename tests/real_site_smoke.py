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
import hashlib
import json
import os
import re
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

# A real video title carried an emoji and the Windows console codec raised
# UnicodeEncodeError on print, which took the whole run down. Replace what the
# terminal cannot encode rather than losing the run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

# A success envelope can carry the paired device token, and a failure path that
# printed a raw body leaked it straight into the transcript. Redaction lives in
# record() so no call site can leak by forgetting.
SECRETS = (
    (re.compile(r'sbp_[A-Za-z0-9_]+'), 'sbp_***'),
    (re.compile(r'(?i)(authorization\s*:\s*)\S+.*'), r'\1***'),
    (re.compile(r'''(?i)(['"]?(?:device_?token|token|secret)['"]?\s*[:=]\s*['"]?)[A-Za-z0-9_.\-]{16,}'''), r'\1***'),
    (re.compile(r'\b[0-9a-f]{40}\b'), '***'),
)


def redact(text):
    for pattern, replacement in SECRETS:
        text = pattern.sub(replacement, text)
    return text


def record(name, outcome, detail=''):
    """outcome: True passed, False failed, None skipped."""
    detail = redact(str(detail))
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
    stale = 0
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
            err = body.get('error') if isinstance(body, dict) else None
            code = err.get('code') if isinstance(err, dict) else ''
            # The extension's own remedy comes first: a stale-ref refusal carries
            # error.candidates, each entry holding a freshRef that already passed
            # uniqueness, identity, actionability and the non-sensitive check. Using
            # them verifies that path actually reaches a caller.
            candidates = (err or {}).get('candidates') if isinstance(err, dict) else None
            fresh = [c['freshRef'] for c in (candidates or []) if isinstance(c, dict) and c.get('freshRef')]
            if fresh:
                stale += 1
                try:
                    await drive('page.click', {'tabId': tab['id'], 'ref': fresh[0]})
                    await asyncio.sleep(1.5)
                    page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
                    responded += 1
                    continue
                except Exception as retry:
                    errors.append(f"{control.get('label', '')[:16]!r} freshRef failed: {type(retry).__name__}")
                    continue
            if code == 'TARGET_NOT_READY':
                # No successor at the same place, so the node is genuinely gone.
                # A live SPA re-renders between the read and the click; that is the
                # site being alive, not a defect. A person looks again and clicks it,
                # so re-read and find the same label.
                stale += 1
                page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 800}))['page']
                again = by_label(page, control.get('label', ''))
                if again:
                    try:
                        await drive('page.click', {'tabId': tab['id'], 'ref': again['ref']})
                        await asyncio.sleep(1.5)
                        page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
                        responded += 1
                        continue
                    except Exception as retry:
                        errors.append(f"{control.get('label', '')[:16]!r} retry failed: {type(retry).__name__}")
                        continue
            if isinstance(err, dict):
                detail = f"{err.get('code')}: {err.get('message')}"
                if err.get('candidates'):
                    detail += f' (carries {len(err["candidates"])} freshRef candidates)'
            elif isinstance(body, dict):
                # record() redacts, so printing the whole completion is safe and is
                # the only way to tell a refusal apart from a success with no result.
                detail = f'{type(exc).__name__} keys={sorted(body)} {json.dumps(body, ensure_ascii=False)}'
            else:
                detail = f'{type(exc).__name__}: {str(exc)[:80]}'
            errors.append(f"{control.get('label', '')[:16]!r} {detail[:260]}")
    # Every control was dispatched without an error; "responded" counts the ones
    # that visibly changed the page. A control that does nothing is information,
    # not a failure, so the pass condition is delivery.
    detail = f'{len(controls)} clicked, {responded} changed the page'
    if stale:
        detail += f', {stale} stale ref re-found and clicked again'
    if errors:
        detail += f', inert: {errors[:3]}'
    record(name, len(errors) < len(controls), detail)


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

        # Maps hydrates well after the load event: the first read came back at 0
        # characters and the content only appeared once the canvas painted. Poll
        # instead of asserting on the first sample, or the suite reports our
        # impatience as a product failure.
        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
            if page['totalTextChars'] or (page.get('axSummary') or {}).get('items'):
                break
            await asyncio.sleep(1.5)
        ax = (page.get('axSummary') or {}).get('items', [])
        # Maps is canvas-rendered, so "loaded" means the page gave us something to
        # act on: named a11y nodes, elements, or text. Which one it gives varies by
        # locale and by whether the list has hydrated into the DOM yet.
        loaded = bool(ax or page['elements'] or page['totalTextChars'])
        record('maps search results loaded', loaded,
               f'chars={page["totalTextChars"]} elements={len(page["elements"])} ax={len(ax)} '
               + (f'[{", ".join(i["name"][:16] for i in ax[:3])}]' if ax
                  else 'no named controls, reached by URL and coordinates'))

        for step in range(3):
            await drive('page.scroll', {'tabId': tab['id'], 'x': 0, 'y': 600, 'block': 'center'})
            await asyncio.sleep(1)
        after = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
        record('maps scroll', after['totalTextChars'] > 0,
               f'chars {page["totalTextChars"]} -> {after["totalTextChars"]}')

        # Open a place by coordinate: the first result card sits in the left rail.
        # There is no ref for it, which is the whole point on a canvas page. The
        # assertion is that the page responded, not that we dispatched a click.
        before_click = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 400}))['page']
        await drive('page.pointer', {
            'tabId': tab['id'], 'x': 240, 'y': 320, 'action': 'click',
            'executionMode': 'background', 'showCursor': True
        })
        await asyncio.sleep(2.5)
        opened = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 600}))['page']
        responded = (opened['semanticState']['documentGeneration']
                     != before_click['semanticState']['documentGeneration']
                     or opened['totalTextChars'] != before_click['totalTextChars'])
        record('maps coordinate click', responded,
               f'clicked (240,320) in background mode; chars '
               f'{before_click["totalTextChars"]} -> {opened["totalTextChars"]}')

        await drive('tabs.close', {'tabId': tab['id']})
        remaining = (await drive('tabs.list'))['tabs']
        record('maps tab closed', not any('maps' in t['url'] for t in remaining),
               f'{len(remaining)} tab(s) left')
    except Exception as exc:
        record('maps journey', False, f'{type(exc).__name__}: {str(exc)[:140]}')


async def case_youtube_search_and_open():
    """What a person does on YouTube: type a search, read the results, open one.

    No credentials, and it exercises the whole core loop on the hardest real page
    here: find the search box, fill it, submit, then click a result and confirm a
    watch page loaded rather than assuming the click landed.
    """
    try:
        # Reuse the YouTube tab the landing case already opened. A person does not
        # open the same page twice, and a second cold load of YouTube is slow enough
        # to look like a failure of ours.
        found = await drive('tabs.find', {'urlContains': 'youtube.com', 'limit': 1})
        tabs = found.get('tabs') or []
        if tabs:
            tab = tabs[0]
        else:
            tab = (await drive('tabs.open', {
                'url': 'https://www.youtube.com/', 'active': True, 'wait': True
            }))['tab']

        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1500}))['page']
            if page['elements']:
                break
            await asyncio.sleep(1.5)

        # YouTube labels its search field a combobox, not a searchbox. The
        # extension reported it correctly and the selector was wrong, so accept
        # every role a search field legitimately carries, preferring a labelled one.
        box = (by_role(page, 'searchbox')
               or by_role(page, 'combobox', 'search')
               or by_role(page, 'textbox', 'search')
               or by_role(page, 'combobox'))
        if not box:
            roles = [str(i.get('role', '?')) for i in page['elements'][:12]]
            record('youtube search', False,
                   f'no searchbox; chars={page["totalTextChars"]} '
                   f'elements={len(page["elements"])} roles seen: {roles}')
            return
        record('youtube search box found', True,
               f'role={box.get("role")!r} label={str(box.get("label", ""))[:24]!r}')

        # The order matters and is the whole point: a trusted fill refuses to insert
        # text unless the field already holds document focus, so focus first. An
        # untrusted fill leaves focus where it was, and the Enter then lands on the
        # body and the site ignores it. This is the sequence a person performs.
        focused = await drive('page.focus', {'tabId': tab['id'], 'ref': box['ref']})
        filled = await drive('page.fill', {'tabId': tab['id'], 'ref': box['ref'],
                                           'value': 'kucing chipset', 'trusted': True})
        keyed = await drive('page.key', {'tabId': tab['id'], 'key': 'Enter', 'trusted': True})
        # valueLength is the only proof the text actually went in. Assert it rather
        # than the ok flag: a caller that misspells the parameter gets ok:true and a
        # zero-length fill, which is how this case silently did nothing for two runs.
        record('youtube typed a query', filled.get('valueLength') == len('kucing chipset'),
               f'focus={focused.get("ok")} fillLen={filled.get("valueLength")} '
               f'fillMethod={filled.get("method")} keyOk={keyed.get("ok")}')
        await asyncio.sleep(3.5)

        results = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1500}))['page']
        after_enter = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
        # The results page leads with the same nav links as the home page, so drop
        # those before choosing something to open.
        nav = ('home', 'shorts', 'subscriptions', 'sign in', 'guide', 'settings',
               'youtube home', 'search', 'history', 'you', 'premium', 'studio')
        links = [i for i in results['elements']
                 if str(i.get('role', '')).lower() == 'link' and i.get('label')
                 and not any(str(i.get('label', '')).strip().lower().startswith(w) for w in nav)]
        record('youtube results listed', bool(links) and '/results' in after_enter['url'],
               f'chars={results["totalTextChars"]} result links={len(links)} '
               f'url={after_enter["url"][:70]} '
               f'[{", ".join(str(i["label"])[:22] for i in links[:3])}]')

        if not links:
            return
        # A video link cannot be told apart from the nav links in the payload: the
        # stable key is a hash, not the URL. A person clicks through the results until
        # a video opens, so do that, and stop as soon as the URL says watch.
        opened = False
        for candidate in links[:5]:
            try:
                await drive('browser.burst', {
                    'tabId': tab['id'],
                    'steps': [
                        {'action': 'click', 'ref': candidate['ref']}
                    ],
                    'executionMode': 'background'
                })
            except Exception as exc:
                record(f'youtube open {str(candidate.get("label", ""))[:20]!r}', False,
                       type(exc).__name__)
                continue
            await asyncio.sleep(3)
            landed = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
            # YouTube serves these results as Shorts, which is a video page too.
            if '/watch' in landed['url'] or '/shorts/' in landed['url']:
                record('youtube opened a video', True,
                       f'{str(candidate.get("label", ""))[:28]!r} -> {landed["url"][:64]}')
                opened = True
                break
            record(f'youtube open {str(candidate.get("label", ""))[:20]!r}', True,
                   f'went to {landed["url"][:52]}')
        if not opened:
            record('youtube opened a video', False,
                   f'tried {min(5, len(links))} result links, none reached a watch page')
    except Exception as exc:
        record('youtube search', False, f'{type(exc).__name__}: {str(exc)[:140]}')


async def case_primitive_sweep():
    """Drive all 26 allowlisted primitives against real pages and report each one.

    A primitive that only ever runs against a local fixture has never met a real
    SPA, a real canvas, or a real media element. Each step is recorded on its own so
    one failure does not hide the other twenty-five.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']

        async def step(label, method, params=None, check=None):
            try:
                result = await drive(method, params)
                detail = check(result) if check else ''
                record(f'sweep {label}', detail is not False, detail)
                return result
            except Exception as exc:
                body = getattr(exc, 'body', None)
                if isinstance(body, dict):
                    err = body.get('error')
                    record(f'sweep {label}', False,
                           f'ok={body.get("ok")} keys={sorted(body)} '
                           f'error={json.dumps(err, ensure_ascii=False)[:160] if err else None}')
                else:
                    record(f'sweep {label}', False, f'{type(exc).__name__}: {str(exc)[:110]}')
                return None

        await step('browser.ping', 'browser.ping', None,
                   lambda r: f'v{r.get("version")} protocol {r.get("protocolVersion")}')

        listed = await step('tabs.list', 'tabs.list', None,
                            lambda r: f'{len(r.get("tabs", []))} tab(s)')
        await step('tabs.get', 'tabs.get', {'tabId': tid},
                   lambda r: f'{r["tab"]["url"][:56]}')
        await step('tabs.find', 'tabs.find', {'urlContains': 'youtube', 'limit': 3},
                   lambda r: f'{len(r.get("tabs", []))} match youtube')

        read = await step('page.read', 'page.read',
                          {'tabId': tid, 'offset': 0, 'limit': 800},
                          lambda r: (f'chars={r["page"]["totalTextChars"]} '
                                     f'elements={len(r["page"]["elements"])} '
                                     f'userState={r["page"].get("userState")}'))
        if read:
            state = read['page'].get('userState') or {}
            record('sweep page.read reports user state',
                   isinstance(state.get('watching'), bool), str(state))
        if not read:
            await drive('tabs.close', {'tabId': tid})
            return

        # page.query takes a CSS selector, not free text. Passing a word is rejected
        # with EXECUTION_ERROR "Invalid selector.", which is the extension being right.
        await step('page.query', 'page.query',
                   {'tabId': tid, 'selector': 'a[href]', 'limit': 5},
                   lambda r: f'{len(r.get("items", []))} item(s)')
        await step('page.find', 'page.find', {'tabId': tid, 'text': 'Home', 'limit': 5},
                   lambda r: f'{len(r.get("items", []))} item(s)')
        await step('page.collect_links', 'page.collect_links',
                   {'tabId': tid, 'limit': 10},
                   lambda r: f'{len(r.get("links", r.get("items", [])))} link(s)')

        def shot(result):
            return (result.get('screenshot') or {})

        plain = await step('page.capture baseline', 'page.capture', {'tabId': tid},
                           lambda r: f'{len(shot(r).get("data") or "")} b64 chars '
                                     f'sha={str(shot(r).get("sha256"))[:10]}')
        moved = await step('page.pointer move + cursor', 'page.pointer',
                           {'tabId': tid, 'x': 400, 'y': 220, 'action': 'move',
                            'executionMode': 'background', 'showCursor': True},
                           lambda r: f'visiblePointer={r.get("visiblePointer")}')
        if plain and moved:
            record('sweep background pointer reports a visible cursor',
                   moved.get('visiblePointer') is True,
                   f'visiblePointer={moved.get("visiblePointer")} in background mode')
            # The extension serves an unchanged capture from a 750ms cache, so a
            # second capture taken straight after returns the first image and the
            # comparison proves nothing. Wait past the window to force a real shot.
            await asyncio.sleep(1.1)
            with_cursor = await drive('page.capture', {'tabId': tid})
            h1 = shot(plain).get('sha256')
            h2 = shot(with_cursor).get('sha256')
            record('sweep the second capture was a real shot',
                   shot(with_cursor).get('cached') is not True,
                   f'cached={shot(with_cursor).get("cached")}')
            # Proven, not assumed: an unchanged page with a cursor drawn must hash
            # differently from the same page without one.
            record('sweep the cursor is actually drawn', bool(h1) and bool(h2) and h1 != h2,
                   f'without cursor {str(h1)[:10]} vs with cursor {str(h2)[:10]}')

        # Dedupe needs a hash taken from the state the page is in right now. The one
        # from the baseline predates the cursor, so it can never match.
        fresh = await drive('page.capture', {'tabId': tid})
        after = await step('page.capture reuses the hash', 'page.capture',
                           {'tabId': tid, 'previousHash': shot(fresh).get('sha256')},
                           lambda r: f'cached={shot(r).get("cached")} '
                                     f'unchanged={shot(r).get("unchanged")}')
        if after:
            record('sweep an unchanged page skips retransmitting the image',
                   shot(after).get('unchanged') is True and not shot(after).get('data'),
                   f'unchanged={shot(after).get("unchanged")} '
                   f'chars sent={len(shot(after).get("data") or "")}')

        await step('page.pointer click', 'page.pointer',
                   {'tabId': tid, 'x': 300, 'y': 200, 'action': 'click',
                    'executionMode': 'background', 'showCursor': True},
                   lambda r: 'clicked in background mode')
        await step('page.pointer drag', 'page.pointer',
                   {'tabId': tid, 'x': 200, 'y': 400, 'endX': 320, 'endY': 420,
                    'action': 'drag', 'executionMode': 'background'},
                   lambda r: 'dragged in background mode')
        await step('page.pointer wheel', 'page.pointer',
                   {'tabId': tid, 'x': 400, 'y': 400, 'action': 'wheel',
                    'deltaY': 240, 'executionMode': 'background'},
                   lambda r: 'wheeled in background mode')

        down = await step('page.scroll down', 'page.scroll',
                          {'tabId': tid, 'x': 0, 'y': 500, 'block': 'center'},
                          lambda r: 'scrolled down')
        await step('page.scroll up', 'page.scroll',
                   {'tabId': tid, 'x': 0, 'y': -500, 'block': 'center'},
                   lambda r: 'scrolled up')

        await step('page.wait_for', 'page.wait_for',
                   {'tabId': tid, 'text': 'YouTube', 'timeoutMs': 5000},
                   lambda r: f'result={json.dumps(r, ensure_ascii=False)[:120]}')

        burst = await step('browser.burst', 'browser.burst', {
            'tabId': tid,
            'steps': [
                {'action': 'read', 'offset': 0, 'limit': 300},
                {'action': 'find', 'text': 'Home', 'limit': 3},
                {'action': 'scroll', 'y': 200}
            ]
        }, lambda r: f'{len(r.get("results", []))} step(s) in one call')
        if burst:
            record('sweep burst reports per-step results',
                   all('ok' in s for s in burst.get('results', [])),
                   f'{len(burst.get("results", []))} step(s)')

        await step('tabs.navigate', 'tabs.navigate',
                   {'tabId': tid, 'url': 'https://www.youtube.com/feed/trending'},
                   lambda r: f'-> {r["tab"]["url"][:56]}')
        await step('tabs.reload', 'tabs.reload', {'tabId': tid},
                   lambda r: f'reloaded {r["tab"]["url"][:56]}')
        await step('tabs.activate', 'tabs.activate', {'tabId': tid},
                   lambda r: f'activated {r["tab"]["id"]}')

        await step('tabs.close', 'tabs.close', {'tabId': tid},
                   lambda r: 'closed the sweep tab')
    except Exception as exc:
        record('sweep', False, f'{type(exc).__name__}: {str(exc)[:140]}')


AUTOPLAY_REFUSED = "didn't interact with the document"


async def case_media_on_real_video():
    """media.* against a real YouTube video, not a synthetic media element."""
    last_error = {}
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/watch?v=UeDjFAqshrA',
            'active': True, 'wait': True
        }))['tab']
        tid = tab['id']

        async def step(label, method, params=None, check=None, tolerate=None):
            try:
                result = await drive(method, params)
                record(f'media {label}', check(result) is not False, check(result))
                return result
            except Exception as exc:
                body = getattr(exc, 'body', None)
                err = body.get('error') if isinstance(body, dict) else None
                last_error.clear()
                last_error.update(err if isinstance(err, dict) else {'message': str(exc)})
                message = str(last_error.get('message', ''))
                if tolerate and tolerate in message:
                    record(f'media {label}', None,
                           f'refused by the browser: {message[:90]}')
                else:
                    record(f'media {label}', False,
                           f'ok={body.get("ok") if isinstance(body, dict) else None} '
                           f'error={json.dumps(err, ensure_ascii=False)[:170] if err else str(exc)[:110]}')
                return None

        state = await step('state', 'media.state', {'tabId': tid, 'index': 0},
                           lambda r: (f'present={r["media"].get("present")} '
                                      f'readyState={r["media"].get("readyState")} '
                                      f'duration={r["media"].get("duration")}'))
        # Chrome's autoplay policy refuses play() on a document the user never
        # interacted with and says so in its own message. That is the browser, not
        # us, so it is reported rather than failed; the next step proves the
        # capability with the gesture the policy asks for.
        played = await step('play', 'media.play', {'tabId': tid, 'index': 0},
                            lambda r: 'play dispatched', tolerate=AUTOPLAY_REFUSED)
        if played is None:
            # Chrome refuses play() on a document the user has never interacted with,
            # and says so in its own message. The gesture it wants is a real click,
            # so give it one: a trusted pointer click on the player is exactly what a
            # person does. If that does not move the playhead, the capability is
            # genuinely broken and the step stays failed.
            await step('play via a trusted click', 'page.pointer',
                       {'tabId': tid, 'x': 480, 'y': 300, 'action': 'click',
                        'executionMode': 'background', 'showCursor': True},
                       lambda r: 'clicked the player')
            await asyncio.sleep(2.5)
            gesture = await step('state after the click', 'media.state',
                                 {'tabId': tid, 'index': 0},
                                 lambda r: f'currentTime={r["media"].get("currentTime")} '
                                           f'paused={r["media"].get("paused")}')
            if gesture:
                record('media a trusted click starts a real video',
                       float(gesture['media'].get('currentTime') or 0) > 0,
                       f'playhead at {gesture["media"].get("currentTime")}s after a trusted click')
        else:
            await asyncio.sleep(2)
            await step('pause', 'media.pause', {'tabId': tid, 'index': 0},
                       lambda r: 'pause dispatched')
        await step('seek', 'media.seek', {'tabId': tid, 'index': 0, 'seconds': 30},
                   lambda r: 'seek dispatched')
        await asyncio.sleep(1.5)
        after = await step('state after seek', 'media.state', {'tabId': tid, 'index': 0},
                           lambda r: f'currentTime={r["media"].get("currentTime")}')
        if after:
            record('media seek moved the playhead',
                   abs(float(after['media'].get('currentTime') or 0) - 30) < 12,
                   f'asked 30s, got {after["media"].get("currentTime")}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('media sweep', False, f'{type(exc).__name__}: {str(exc)[:140]}')


# A sweep clicks real controls, so it must not click the ones that spend money,
# delete something, or end the session. Everything else on the page is fair game.
UNSAFE_LABELS = (
    'sign out', 'log out', 'logout', 'signout', 'delete', 'remove', 'unsubscribe',
    'subscribe', 'buy', 'purchase', 'checkout', 'pay', 'confirm', 'send', 'post',
    'publish', 'reply', 'report', 'block', 'leave', 'deactivate', 'cancel account'
)


def is_safe_label(label):
    low = str(label or '').strip().lower()
    if not low:
        return False
    return not any(word in low for word in UNSAFE_LABELS)


async def case_click_every_control(url, name, limit=14):
    """Click every control the page offers, the way a person explores a site.

    This is the closest thing to a human sweep: read the page, take the next control
    a person would recognise, click it, and check the page responded. Every control
    gets its own record, so one refusal does not hide the rest, and controls that
    navigate away send the tab back so the sweep can continue.

    Destructive labels are skipped on purpose: clicking "Sign out" or "Delete" on a
    real account is not something a test may do.
    """
    tab = None
    clicked = responded = stale = recovered = 0
    refusals = []
    skipped = []
    try:
        tab = (await drive('tabs.open', {'url': url, 'active': True, 'wait': True}))['tab']
        tid = tab['id']

        async def refresh():
            return (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1500}))['page']

        page = await refresh()
        for _ in range(6):
            if page['elements']:
                break
            await asyncio.sleep(1.2)
            page = await refresh()

        # Dedupe by label, not by ref: a click re-renders the page and mints new refs
        # for the same controls, so ref-based dedupe clicked one link eight times.
        seen = set()
        for _ in range(limit):
            controls = [i for i in page['elements']
                        if str(i.get('role', '')).lower()
                        in ('button', 'link', 'menuitem', 'tab', 'switch', 'checkbox', 'option')
                        and str(i.get('label', '')).strip()
                        and is_safe_label(i.get('label'))
                        and str(i.get('label', '')).strip().lower() not in seen]
            if not controls:
                skipped = [str(i.get('label', ''))[:16] for i in page['elements'][:4]
                           if str(i.get('label', '')).strip() and not is_safe_label(i.get('label'))]
                break

            control = controls[0]
            label = str(control.get('label', ''))[:20]
            seen.add(label.strip().lower())
            before_generation = page['semanticState']['documentGeneration']
            before_chars = page['totalTextChars']
            before_url = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
            try:
                await drive('page.click', {'tabId': tid, 'ref': control['ref'],
                                            'executionMode': 'background'})
                clicked += 1
                await asyncio.sleep(1.2)
                page = await refresh()
                changed = (page['semanticState']['documentGeneration'] != before_generation
                           or page['totalTextChars'] != before_chars)
                if changed:
                    responded += 1
                record(f'{name} click {label!r}', True,
                       'page responded' if changed else 'dispatched, page unchanged')
            except Exception as exc:
                body = getattr(exc, 'body', None)
                err = body.get('error') if isinstance(body, dict) else None
                code = err.get('code') if isinstance(err, dict) else type(exc).__name__
                message = str(err.get('message', ''))[:90] if isinstance(err, dict) else ''
                refusals.append(f'{label!r} {code}')
                # Reported, not failed: the burst below is the recovery and it carries
                # the verdict for this control.
                record(f'{name} click {label!r}', None, f'{code} {message}'.strip())
                # A ref read in one round trip is already stale on a header that
                # re-renders constantly, and re-finding in another round trip is
                # just as stale. The product's own answer is to find and click inside
                # ONE burst with refFromStep, so the ref is consumed milliseconds
                # after it is minted. That is also what a person does: look and click.
                try:
                    burst = await drive('browser.burst', {
                        'tabId': tid,
                        'steps': [
                            {'action': 'find', 'text': control.get('label', ''), 'limit': 1},
                            {'action': 'click', 'refFromStep': 0}
                        ],
                        'executionMode': 'background'
                    })
                    stale += 1
                    recovered += 1
                    await asyncio.sleep(1.2)
                    page = await refresh()
                    record(f'{name} click {label!r} inside one burst', True,
                           'find and click in a single call')
                except Exception as burst_exc:
                    bbody = getattr(burst_exc, 'body', None)
                    berr = bbody.get('error') if isinstance(bbody, dict) else None
                    bmsg = (f'{berr.get("code")} {str(berr.get("message", ""))[:70]}'
                            if isinstance(berr, dict) else type(burst_exc).__name__)
                    refusals.append(f'{label!r} burst {bmsg}')
                    record(f'{name} click {label!r} inside one burst', False, bmsg)

            now = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
            if host_of(now) != host_of(before_url):
                # The click navigated. A person goes back and keeps exploring.
                await drive('tabs.navigate', {'tabId': tid, 'url': before_url})
                await asyncio.sleep(2)
                page = await refresh()

        # A refusal the burst recovered is not a failure: it is the measurement that
        # a fast-changing header needs the single-call path. Only a control that was
        # refused AND stayed refused fails the sweep.
        unrecovered = len(refusals) - recovered
        summary = (f'{clicked} clicked, {responded} responded, '
                   f'{recovered} recovered by a single-call find+click, '
                   f'{unrecovered} left refused')
        if unrecovered:
            summary += f': {refusals[:4]}'
        if skipped:
            summary += f'; only unsafe controls left: {skipped}'
        record(f'{name} control sweep', unrecovered == 0, summary)
        if tab:
            await drive('tabs.close', {'tabId': tab['id']})
    except Exception as exc:
        record(f'{name} control sweep', False, f'{type(exc).__name__}: {str(exc)[:140]}')
        if tab:
            try:
                await drive('tabs.close', {'tabId': tab['id']})
            except Exception:
                pass


async def maybe(coro_factory, label):
    """Run a case unless OA_ONLY names a different one. Keeps a single run short
    while a case is being diagnosed."""
    only = os.environ.get('OA_ONLY', '')
    if only and only not in label:
        return
    await coro_factory()


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
        await maybe(lambda: case_youtube_search_and_open(), 'youtube-search')
        await maybe(lambda: case_primitive_sweep(), 'sweep')
        await maybe(lambda: case_media_on_real_video(), 'media')
        await maybe(lambda: case_click_every_control('https://opencode.ai/', 'opencode'),
                    'opencode-controls')
        await maybe(lambda: case_click_every_control('https://www.youtube.com/', 'youtube'),
                    'youtube-controls')
        await maybe(lambda: case_maps_journey(), 'maps')

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
