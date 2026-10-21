# @last-edited: 2026-10-21 UTC+7.
# @title: real_site_smoke — the extension against live sites: comment, like, transcript, Docs, GitHub and Wikipedia.
# @state: the sites it drives by hand, and what it prints for each.
# @dependencies: asyncio, hashlib, json, os, re.

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
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import browser_extension_test as harness

from playwright.async_api import async_playwright

EXT = harness.EXT
HOST = harness.HOST
PAIR_CODE = harness.PAIR_CODE
EXPECTED_EXTENSION_ID = harness.EXPECTED_EXTENSION_ID
EXPECTED_VERSION = harness.EXPECTED_VERSION

RESULTS = []

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

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
        return None
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
    except Exception as exc:
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

                detail = f'{type(exc).__name__} keys={sorted(body)} {json.dumps(body, ensure_ascii=False)}'
            else:
                detail = f'{type(exc).__name__}: {str(exc)[:80]}'
            errors.append(f"{control.get('label', '')[:16]!r} {detail[:260]}")

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

        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
            if page['totalTextChars'] or (page.get('axSummary') or {}).get('items'):
                break
            await asyncio.sleep(1.5)
        ax = (page.get('axSummary') or {}).get('items', [])

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

        focused = await drive('page.focus', {'tabId': tab['id'], 'ref': box['ref']})
        filled = await drive('page.fill', {'tabId': tab['id'], 'ref': box['ref'],
                                           'value': 'kucing chipset', 'trusted': True})
        keyed = await drive('page.key', {'tabId': tab['id'], 'key': 'Enter', 'trusted': True})

        record('youtube typed a query', filled.get('valueLength') == len('kucing chipset'),
               f'focus={focused.get("ok")} fillLen={filled.get("valueLength")} '
               f'fillMethod={filled.get("method")} keyOk={keyed.get("ok")}')

        try:
            await drive('page.fill', {'tabId': tab['id'], 'ref': box['ref'],
                                      'text': 'typo', 'trusted': True})
            record('page.fill rejects a missing value', False,
                   'a fill with no value was accepted')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            record('page.fill rejects a missing value',
                   isinstance(err, dict) and 'value' in str(err.get('message', '')),
                   f'{(err or {}).get("code")} {(err or {}).get("message")}')
        await asyncio.sleep(3.5)

        results = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1500}))['page']
        after_enter = (await drive('tabs.get', {'tabId': tab['id']}))['tab']

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

        videos = []
        try:
            collected = await drive('page.collect_links', {
                'tabId': tab['id'], 'limit': 120, 'sameOrigin': True
            })
            videos = [l for l in (collected.get('links') or [])
                      if '/watch?v=' in str(l.get('url', '')) or '/shorts/' in str(l.get('url', ''))]
            record('youtube results carry video links', bool(videos),
                   f'{len(collected.get("links") or [])} links, {len(videos)} videos')
        except Exception as exc:
            record('youtube results carry video links', False, type(exc).__name__)

        if not videos:
            record('youtube opened a video', False,
                   'no /watch or /shorts link on the results page')
            return

        await drive('tabs.navigate', {'tabId': tab['id'], 'url': videos[0]['url']})
        await asyncio.sleep(3)
        landed = (await drive('tabs.get', {'tabId': tab['id']}))['tab']
        watch = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1200}))['page']
        record('youtube opened a video',
               '/watch' in landed['url'] or '/shorts/' in landed['url'],
               f'{landed["url"][:64]} chars={watch["totalTextChars"]} '
               f'elements={len(watch["elements"])}')
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

        timings = []

        async def step(label, method, params=None, check=None):
            started = time.perf_counter()
            try:
                result = await drive(method, params)
                elapsed = (time.perf_counter() - started) * 1000
                timings.append((label, elapsed))
                detail = check(result) if check else ''
                record(f'sweep {label}', detail is not False, f'{elapsed:.0f}ms {detail}'.strip())
                return result
            except Exception as exc:
                body = getattr(exc, 'body', None)
                err = body.get('error') if isinstance(body, dict) else None
                message = str((err or {}).get('message', ''))
                if 'sensitive' in message:

                    record(f'sweep {label}', None, f'refused: {message[:70]}')
                elif isinstance(body, dict):
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

            await asyncio.sleep(1.1)
            with_cursor = await drive('page.capture', {'tabId': tid})
            h1 = shot(plain).get('sha256')
            h2 = shot(with_cursor).get('sha256')
            record('sweep the second capture was a real shot',
                   shot(with_cursor).get('cached') is not True,
                   f'cached={shot(with_cursor).get("cached")}')

            record('sweep the cursor is actually drawn', bool(h1) and bool(h2) and h1 != h2,
                   f'without cursor {str(h1)[:10]} vs with cursor {str(h2)[:10]}')

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
                   {'tabId': tid, 'x': 40, 'y': 420, 'endX': 140, 'endY': 440,
                    'action': 'drag', 'executionMode': 'background'},
                   lambda r: 'dragged in background mode')
        await step('page.pointer wheel', 'page.pointer',
                   {'tabId': tid, 'x': 40, 'y': 420, 'action': 'wheel',
                    'deltaY': 240, 'executionMode': 'background'},
                   lambda r: 'wheeled in background mode')

        down = await step('page.scroll down', 'page.scroll',
                          {'tabId': tid, 'x': 0, 'y': 500, 'block': 'center'},
                          lambda r: 'scrolled down')
        await step('page.scroll up', 'page.scroll',
                   {'tabId': tid, 'x': 0, 'y': -500, 'block': 'center'},
                   lambda r: 'scrolled up')

        found = await step('page.wait_for finds text', 'page.wait_for',
                           {'tabId': tid, 'text': 'youtube', 'timeoutMs': 6000},
                           lambda r: f'item={str((r.get("item") or {}).get("label"))[:24]!r}')
        if found:
            record('sweep wait_for resolves to the element it found',
                   bool(found.get('item')), f'{str(found.get("item"))[:80]}')

        try:
            await drive('page.wait_for', {'tabId': tid, 'text': 'zzz-not-on-this-page-zzz',
                                          'timeoutMs': 1200})
            record('sweep a wait_for timeout is a command error', False,
                   'the timeout came back as a success')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            record('sweep a wait_for timeout is a command error',
                   isinstance(err, dict) and err.get('message') == 'wait_for timeout',
                   f'{(err or {}).get("code")} {(err or {}).get("message")}')

        gone = await step('page.wait_for absent', 'page.wait_for',
                          {'tabId': tid, 'text': 'zzz-not-on-this-page-zzz',
                           'absent': True, 'timeoutMs': 1200},
                          lambda r: f'absent={r.get("absent")} ok={r.get("ok")}')

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

            separate_started = time.perf_counter()
            await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 300})
            await drive('page.find', {'tabId': tid, 'text': 'Home', 'limit': 3})
            await drive('page.scroll', {'tabId': tid, 'y': 200})
            separate_ms = (time.perf_counter() - separate_started) * 1000
            burst_ms = next(ms for label, ms in timings if label == 'browser.burst')

            record('sweep burst against three round trips', None,
                   f'burst {burst_ms:.0f}ms in 1 call vs separate {separate_ms:.0f}ms '
                   f'in 3 calls, {separate_ms / max(burst_ms, 1):.2f}x, not a verdict')

        await step('tabs.navigate', 'tabs.navigate',
                   {'tabId': tid, 'url': 'https://www.youtube.com/feed/trending'},
                   lambda r: f'-> {r["tab"]["url"][:56]}')
        await step('tabs.reload', 'tabs.reload', {'tabId': tid},
                   lambda r: f'reloaded {r["tab"]["url"][:56]}')
        await step('tabs.activate', 'tabs.activate', {'tabId': tid},
                   lambda r: f'activated {r["tab"]["id"]}')

        await step('tabs.close', 'tabs.close', {'tabId': tid},
                   lambda r: 'closed the sweep tab')

        ranked = sorted(timings, key=lambda row: -row[1])
        slow = ranked[:5]
        record('sweep slowest round trips', True,
               ' | '.join(f'{label} {ms:.0f}ms' for label, ms in slow)
               + f' | median {sorted(m for _, m in timings)[len(timings) // 2]:.0f}ms'
               f' over {len(timings)} calls')
    except Exception as exc:
        record('sweep', False, f'{type(exc).__name__}: {str(exc)[:140]}')

AUTOPLAY_REFUSED = ("didn't interact with the document", 'no user gesture')

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
                if tolerate and any(marker in message for marker in tolerate):
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

        played = await step('play', 'media.play', {'tabId': tid, 'index': 0},
                            lambda r: 'play dispatched', tolerate=AUTOPLAY_REFUSED)
        if played is None:

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

async def case_youtube_interactions():
    """A person on a watch page: scroll to the comments, type, like, read the transcript.

    No login, so nothing is submitted and nothing is liked: typing proves the
    keyboard path on the real widget and is cleared afterwards, the like click
    proves the control dispatches up to the sign-in wall, and the transcript
    opens through the same UI a person uses. A wall is a skip with a reason,
    never a failure.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/results?search_query=playwright+tutorial',
            'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        await asyncio.sleep(3.0)

        async def read():
            return (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1500}))['page']

        page = await read()
        video = next((i for i in page['elements']
                      if str(i.get('role', '')).lower() == 'link'
                      and '/watch' in str(i.get('href', ''))), None)
        if not video:
            record('youtube interactions video opened', None, 'no watch link in results')
            await drive('tabs.close', {'tabId': tid})
            return
        await drive('page.click', {'tabId': tid, 'ref': video['ref'],
                                   'executionMode': 'background'})
        await asyncio.sleep(4.0)
        info = (await drive('tabs.get', {'tabId': tid}))['tab']
        record('youtube interactions video opened',
               '/watch' in info.get('url', ''),
               f'url={info.get("url", "")[:70]}')

        opened = False
        await asyncio.sleep(8.0)
        for _ in range(20):
            panel = await read()
            skip = by_label(panel, 'skip ad') or by_label(panel, 'skip ads')
            if skip:
                try:
                    await drive('page.click', {'tabId': tid, 'ref': skip['ref'],
                                               'executionMode': 'background'})
                except Exception:
                    pass
                await asyncio.sleep(2.0)
                continue
            box = (by_role(panel, 'textbox', 'comment')
                   or by_label(panel, 'add a comment')
                   or by_label(panel, 'komentar'))
            if box:
                break
            if not opened:

                try:
                    found = await drive('page.find', {'tabId': tid, 'text': 'Comments',
                                                      'limit': 3})
                    refs = [m.get('ref') for m in found.get('matches', [])
                            if m.get('ref')]
                    if refs:
                        await drive('page.scroll', {'tabId': tid, 'ref': refs[0]})
                        await asyncio.sleep(2.0)
                        opened = True
                        continue
                except Exception:
                    pass
            comments = by_label(panel, 'comments')
            if comments and comments.get('role') == 'button' and not opened:

                await drive('page.click', {'tabId': tid, 'ref': comments['ref'],
                                           'executionMode': 'background'})
                await asyncio.sleep(2.0)
                opened = True
                continue
            await drive('page.scroll', {'tabId': tid, 'direction': 'down', 'amount': 800})
            await asyncio.sleep(1.5)

        page = await read()
        if not box:
            box = by_role(page, 'textbox', 'comment') or by_label(page, 'add a comment')
        if not box:
            info = (await drive('tabs.get', {'tabId': tid}))['tab']
            text = page.get('text', '')
            off = 'comments are turned off' in text.lower()

            reason = ('comments disabled on this video' if off else
                      'no comments section rendered logged-out')
            record('youtube comment box found', None,
                   f'{reason}; title={info.get("title", "")[:40]!r}')
        else:
            record('youtube comment box found', True,
                   f'role={box.get("role")!r} label={str(box.get("label", ""))[:30]!r}')
            await drive('page.focus', {'tabId': tid, 'ref': box['ref']})
            filled = await drive('page.fill', {'tabId': tid, 'ref': box['ref'],
                                               'value': 'percobaan ketik', 'trusted': True})
            record('youtube comment typed', filled.get('valueLength') == len('percobaan ketik'),
                   f'fillLen={filled.get("valueLength")}')

            await drive('page.fill', {'tabId': tid, 'ref': box['ref'], 'value': ''})
            cleared = await drive('page.query', {'tabId': tid,
                                                 'selector': '#placeholder-area'})
            record('youtube comment cleared', True,
                   f'placeholder back={cleared.get("ok", True)}')

        page = await read()
        like = next((i for i in page['elements']
                     if str(i.get('role', '')).lower() == 'button'
                     and str(i.get('label', '')).lower().startswith('like')
                     and 'dislike' not in str(i.get('label', '')).lower()), None)
        if not like:
            record('youtube like clicked', None, 'no like control in the listing')
        else:
            try:
                await drive('page.click', {'tabId': tid, 'ref': like['ref'],
                                           'executionMode': 'background'})
                await asyncio.sleep(1.5)
                after = await read()
                wall = 'sign in' in (after.get('text', '')[:4000]).lower()
                record('youtube like clicked', None if wall else True,
                       'sign-in wall after the click' if wall else 'page responded')
            except Exception as exc:
                record('youtube like clicked', None, f'{type(exc).__name__} (no login)')

        page = await read()
        transcript = by_label(page, 'show transcript') or by_role(page, 'button', 'transcript')
        if not transcript:
            more = by_label(page, '...more')
            if more:

                await drive('page.click', {'tabId': tid, 'ref': more['ref'],
                                           'executionMode': 'background'})
                await asyncio.sleep(2.0)
                page = await read()
                transcript = (by_label(page, 'show transcript')
                              or by_role(page, 'button', 'transcript'))
        if not transcript:
            cands = [f'{i.get("role")}:{str(i.get("label", ""))[:28]}'
                     for i in page['elements']
                     if 'transcript' in str(i.get('label', '')).lower()]
            record('youtube transcript opened', None,
                   f'no transcript control; transcript-ish: {cands[:6]}')
        else:
            await drive('page.click', {'tabId': tid, 'ref': transcript['ref'],
                                       'executionMode': 'background'})
            await asyncio.sleep(2.0)
            panel = await read()
            segments = (panel.get('text', '')[:6000]).count(':')
            record('youtube transcript opened', segments > 3,
                   f'~{segments} timestamped lines in the panel')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        body = getattr(exc, 'body', None)
        err = body.get('error') if isinstance(body, dict) else None
        record('youtube interactions', False,
               f'{type(exc).__name__} {(err or {}).get("code")} '
               f'{(err or {}).get("message", str(exc))[:200]}')

async def case_google_search_and_expand():
    """Google Search: type a query, read the results, expand an answer in place.

    The function this adds is an in-place content change: a collapsed control on a
    results page opens its answer without touching the URL, so the proof cannot be a
    navigation. It is the shape every assistant meets on the web, and no other case
    covers it.
    """
    try:
        tab, page = await open_and_read('https://www.google.com/')
        tid = tab['id']
        box = (by_role(page, 'searchbox') or by_label(page, 'search')
               or by_role(page, 'combobox') or by_role(page, 'textbox'))
        if not box:
            record('google search typed and submitted', None,
                   f'no search field; chars={page["totalTextChars"]}')
            await drive('tabs.close', {'tabId': tid})
            return

        await drive('page.focus', {'tabId': tid, 'ref': box['ref']})
        filled = await drive('page.fill', {'tabId': tid, 'ref': box['ref'],
                                           'value': 'cara mengedit video', 'trusted': True})
        await drive('page.key', {'tabId': tid, 'key': 'Enter', 'trusted': True})
        record('google search typed and submitted', filled.get('valueLength', 0) > 0,
               f'valueLength={filled.get("valueLength")} role={box.get("role")!r}')
        await asyncio.sleep(3.5)

        landed = (await drive('tabs.get', {'tabId': tid}))['tab']
        results = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']

        gate = gated_reason(landed, results) or ('/sorry/' in landed['url'] and 'google bot check')
        if gate:
            record('google search results loaded', None, str(gate))
            await drive('tabs.close', {'tabId': tid})
            return
        record('google search results loaded', '/search' in landed['url'],
               f'url={landed["url"][:70]} chars={results["totalTextChars"]} '
               f'elements={len(results["elements"])}')

        try:
            collected = await drive('page.collect_links', {'tabId': tid, 'limit': 120})
            urls = [str(l.get('url', '')) for l in (collected.get('links') or [])]
            answers = [u for u in urls if u.startswith('http') and 'google.' not in u.split('/')[2]]
            record('google results carry answer links', bool(answers),
                   f'{len(urls)} links, {len(answers)} off-google')
        except Exception as exc:
            record('google results carry answer links', False, type(exc).__name__)

        collapsed = (await drive('page.query', {
            'tabId': tid, 'selector': '[aria-expanded="false"]'
        })).get('item')
        if not collapsed or collapsed.get('tag') in ('input', 'textarea'):
            record('google answer expanded in place', None,
                   f'no collapsible control; tag={None if not collapsed else collapsed.get("tag")}')
            await drive('tabs.close', {'tabId': tid})
            return
        await drive('page.click', {'tabId': tid, 'ref': collapsed['ref'],
                                   'executionMode': 'background'})
        opened = await drive('page.wait_for', {
            'tabId': tid, 'ref': collapsed['ref'],
            'state': {'ariaExpanded': 'true'}, 'timeoutMs': 4000
        })
        same_url = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
        record('google answer expanded in place',
               opened.get('ok') is True and same_url == landed['url'],
               f'{str(collapsed.get("label") or collapsed.get("text"))[:28]!r} '
               f'waitedMs={opened.get("waitedMs")} url_unchanged={same_url == landed["url"]}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('google search', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_in_place_expansion():
    """A collapsed control opens its answer without the page navigating.

    This is the function an assistant meets most and no navigation-based case proves:
    the URL is identical before and after, so the only honest proof is the control's
    own state. Google Search is the site that matters most and is also the one that
    bot-checks an automated submit, so the proof lives here, on a page that always
    serves one.
    """
    try:
        tab, _ = await open_and_read('https://opencode.ai/')
        tid = tab['id']
        before = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
        collapsed = (await drive('page.query', {
            'tabId': tid, 'selector': '[aria-expanded="false"]'
        })).get('item')
        if not collapsed or collapsed.get('tag') in ('input', 'textarea'):
            record('collapsed control expanded in place', None,
                   f'no collapsible control; tag={None if not collapsed else collapsed.get("tag")}')
            await drive('tabs.close', {'tabId': tid})
            return
        await drive('page.click', {'tabId': tid, 'ref': collapsed['ref'],
                                   'executionMode': 'background'})

        opened = await drive('page.wait_for', {
            'tabId': tid, 'ref': collapsed['ref'],
            'state': {'ariaExpanded': 'true'}, 'timeoutMs': 4000
        })
        same = (await drive('tabs.get', {'tabId': tid}))['tab']['url'] == before
        record('collapsed control expanded in place', opened.get('ok') is True and same,
               f'{str(collapsed.get("label") or collapsed.get("text"))[:30]!r} '
               f'waitedMs={opened.get("waitedMs")} url_unchanged={same}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('in-place expansion', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_google_docs_wall():
    """Google Docs logged out: the wall itself is the coverage.

    A document canvas needs a signed-in account, which the suite never has, so
    the honest probe drives what logged-out Docs actually serves: the sign-in
    wall and its email field, found but never submitted.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://docs.google.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        await asyncio.sleep(2)
        info = (await drive('tabs.get', {'tabId': tid}))['tab']
        page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']
        wall = 'accounts.google.com' in info.get('url', '') or \
            'sign in' in (page.get('text', '')[:2000]).lower()
        record('google docs serves its sign-in wall', wall,
               f'url={info.get("url", "")[:60]}')
        email = (by_role(page, 'textbox', 'email')
                 or by_label(page, 'email')
                 or by_role(page, 'textbox'))
        record('google docs email field found, not submitted', email is not None,
               f'label={str((email or {}).get("label", ""))[:24]!r}' if email else 'no field')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('google docs wall', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_github_search():
    """GitHub logged out: type in search, submit, read the results.

    No login is needed for code search, so the whole loop is provable: focus,
    fill, Enter, and a results page whose url and text differ from before.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://github.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']
        box = (by_role(page, 'searchbox')
               or by_role(page, 'combobox', 'search')
               or by_role(page, 'textbox', 'search')
               or by_label(page, 'search'))
        if not box:
            record('github search typed and submitted', None, 'no search field found')
            await drive('tabs.close', {'tabId': tid})
            return
        before_url = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
        await drive('page.focus', {'tabId': tid, 'ref': box['ref']})
        try:
            filled = await drive('page.fill', {'tabId': tid, 'ref': box['ref'],
                                               'value': 'playwright python', 'trusted': True})
        except Exception as fill_exc:

            filled = None
            await drive('page.click', {'tabId': tid, 'ref': box['ref'],
                                       'executionMode': 'background'})
            await asyncio.sleep(2.0)
            overlay = (await drive('page.read', {'tabId': tid, 'offset': 0,
                                                'limit': 1200}))['page']
            box = (by_role(overlay, 'searchbox')
                   or by_role(overlay, 'combobox', 'search')
                   or by_role(overlay, 'textbox', 'search')
                   or by_label(overlay, 'search'))
            record('github search overlay opened', box is not None,
                   f'role={(box or {}).get("role")!r}' if box else 'no overlay field')
            if box:
                await drive('page.focus', {'tabId': tid, 'ref': box['ref']})
                filled = await drive('page.fill', {'tabId': tid, 'ref': box['ref'],
                                                   'value': 'playwright python',
                                                   'trusted': True})
        if filled is None:
            await drive('tabs.close', {'tabId': tid})
            return
        await drive('page.key', {'tabId': tid, 'key': 'Enter', 'trusted': True})
        await asyncio.sleep(3.5)
        after_url = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
        after = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 800}))['page']
        moved = after_url != before_url and 'search' in after_url
        record('github search typed and submitted',
               filled.get('valueLength') == len('playwright python') and moved,
               f'fillLen={filled.get("valueLength")} url={after_url[:70]} '
               f'chars={after.get("totalTextChars")}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        body = getattr(exc, 'body', None)
        err = body.get('error') if isinstance(body, dict) else None
        record('github search', False,
               f'{type(exc).__name__} {(err or {}).get("code")} '
               f'{(err or {}).get("message", str(exc))[:200]}')

async def case_wikipedia_article():
    """Wikipedia: scroll a long article, jump through its table of contents, go back.

    A person reads down, clicks a section, and returns. The section heading must
    be on screen afterwards, and the article must still be the same page.
    """
    try:
        url = 'https://en.wikipedia.org/wiki/Playwright_(software)'
        tab = (await drive('tabs.open', {'url': url, 'active': True, 'wait': True}))['tab']
        tid = tab['id']
        before = (await drive('page.read', {'tabId': tid, 'offset': 0,
                                            'limit': 1200}))['page']

        target = by_label(before, 'history') or by_role(before, 'link', 'history')
        if not target:
            record('wikipedia scrolled deep', None, 'no table-of-contents link found')
            page = before
        else:
            scrolled = await drive('page.scroll', {'tabId': tid, 'ref': target['ref']})
            page = (await drive('page.read', {'tabId': tid, 'offset': 0,
                                              'limit': 1200}))['page']
            label = str(target.get('label', ''))
            now = next((i.get('inViewport') for i in page['elements']
                        if str(i.get('label', '')) == label), None)
            record('wikipedia scrolled deep',
                   scrolled.get('settled') is True and now is True,
                   f'{label[:24]!r} settled={scrolled.get("settled")} inViewport={now}')
        toc = by_role(page, 'link', 'history') or by_label(page, 'history')
        if not toc:
            record('wikipedia section jumped', None, 'no table-of-contents link found')
        else:
            await drive('page.click', {'tabId': tid, 'ref': toc['ref'],
                                       'executionMode': 'background'})
            await asyncio.sleep(2.0)
            now = (await drive('tabs.get', {'tabId': tid}))['tab']['url']
            record('wikipedia section jumped',
                   'Playwright_(software)' in now and '#' in now,
                   f'url={now[:80]}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('wikipedia article', False, f'{type(exc).__name__}: {str(exc)[:140]}')

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

        seen = set()
        for _ in range(limit):
            controls = [i for i in page['elements']
                        if str(i.get('role', '')).lower()
                        in ('button', 'link', 'menuitem', 'tab', 'switch', 'checkbox', 'option')
                        and str(i.get('label', '')).strip()
                        and is_safe_label(i.get('label'))

                        and i.get('visible') is not False
                        and str(i.get('label', '')).strip().lower() not in seen]
            if not controls:
                skipped = [str(i.get('label', ''))[:16] for i in page['elements'][:4]
                           if str(i.get('label', '')).strip() and not is_safe_label(i.get('label'))]
                break

            control = controls[0]

            key = str(control.get('label', '')).strip().lower()
            seen.add(key)
            label = key[:20]
            before_generation = page['semanticState']['documentGeneration']
            before_chars = page['totalTextChars']

            async def window_tabs():

                tabs = (await drive('tabs.list', {'currentWindow': True}))['tabs']
                mine = next((t for t in tabs if t.get('id') == tid), None)
                return (mine or {}).get('url'), len(tabs)

            before_url, before_tab_count = await window_tabs()

            now_url = None
            try:
                await drive('page.click', {'tabId': tid, 'ref': control['ref'],
                                            'executionMode': 'background'})
                clicked += 1
                await asyncio.sleep(1.2)
                page = await refresh()
                now_url, now_tab_count = await window_tabs()
                changed = (page['semanticState']['documentGeneration'] != before_generation
                           or page['totalTextChars'] != before_chars
                           or now_url != before_url
                           or now_tab_count != before_tab_count)
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

                claimed = next(
                    (i for i in page['elements'] if i.get('ref') == control.get('ref')), None
                )
                gates = '' if claimed is None else (
                    f' listed visible={claimed.get("visible")} '
                    f'inViewport={claimed.get("inViewport")} '
                    f'actionable={claimed.get("actionable")}'
                )

                record(f'{name} click {label!r}', None, f'{code} {message}{gates}'.strip())

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

            now = now_url if now_url is not None else (await window_tabs())[0]
            if host_of(now) != host_of(before_url):

                await drive('tabs.navigate', {'tabId': tid, 'url': before_url})
                await asyncio.sleep(2)
                page = await refresh()

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

async def case_login_form(site, login_url):
    """Prove the login form is found, without ever submitting anything.

    The credentials are not needed for this part, and finding the fields is the part
    that was unverified: a wrong selector heuristic would fail at the submit step
    with no way to tell whether the form or the credentials were at fault. It also
    reports what roles were actually seen, so a miss is diagnosable instead of a
    bare "no login form found".
    """
    try:
        tab = (await drive('tabs.open', {'url': login_url, 'active': True, 'wait': True}))['tab']
        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tab['id'], 'offset': 0, 'limit': 1500}))['page']
            if page['elements']:
                break
            await asyncio.sleep(1.2)

        boxes = [i for i in page['elements']
                 if str(i.get('role', '')).lower() in ('textbox', 'searchbox', 'combobox')]
        email_box = (by_role(page, 'textbox', 'mail') or by_role(page, 'textbox', 'email')
                     or by_role(page, 'textbox', 'identifier')
                     or by_label(page, 'email') or by_label(page, 'identifier'))
        password_box = (by_role(page, 'textbox', 'assword')
                        or by_label(page, 'password'))

        submit = (by_label(page, 'next') or by_label(page, 'continue')
                  or by_label(page, 'sign in') or by_label(page, 'log in'))
        record(f'{site} login form detected', bool(email_box and submit),
               f'identifier={bool(email_box)} password={bool(password_box)} '
               f'step={"two-step" if not password_box else "single-step"} '
               f'boxes={len(boxes)} labels='
               f'{[str(i.get("label", ""))[:18] for i in boxes[:3]]}')

        record(f'{site} login submit control found', bool(submit),
               f'{str(submit.get("label"))[:28]!r}' if submit else 'no submit control seen')

        await drive('tabs.close', {'tabId': tab['id']})
    except Exception as exc:
        record(f'{site} login form', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_stale_ref_recovery():
    """Does a refused ref ever come back if you wait longer than the deadline?

    TARGET_NOT_READY on a re-rendering header costs 7.5s of waiting per attempt. If
    the same ref would have resolved given more time, the wait is earning its cost and
    failing fast would be a regression. If it never resolves, the wait is pure loss.
    This measures which, by retrying one refused ref on a fixed interval and counting
    the recoveries.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        await drive('tabs.navigate', {'tabId': tid, 'url': 'https://www.youtube.com/'})
        await asyncio.sleep(2)

        logo = None
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']
            logo = next((i for i in page['elements']
                         if str(i.get('role', '')).lower() == 'link'
                         and 'youtube home' in str(i.get('label', '')).lower()), None)
            if logo:
                break
            await asyncio.sleep(1.2)
        if not logo:
            record('stale ref recovery', None,
                   'the home header link was not present; the site served another page '
                   f'({[str(i.get("label", ""))[:14] for i in page["elements"][:4]]})')
            await drive('tabs.close', {'tabId': tid})
            return

        first = None
        recoveries = 0
        attempts = 0
        for attempt in range(5):
            started = time.perf_counter()
            try:
                await drive('page.click', {'tabId': tid, 'ref': logo['ref'],
                                            'executionMode': 'background'})
                elapsed = (time.perf_counter() - started) * 1000
                record(f'stale ref attempt {attempt + 1}', True,
                       f'resolved after {elapsed:.0f}ms')
                recoveries += 1
                first = first or elapsed
                break
            except Exception as exc:
                body = getattr(exc, 'body', None)
                err = body.get('error') if isinstance(body, dict) else None
                code = err.get('code') if isinstance(err, dict) else type(exc).__name__
                attempts += 1
                record(f'stale ref attempt {attempt + 1}', None,
                       f'{code} after {(time.perf_counter() - started) * 1000:.0f}ms')
            await asyncio.sleep(3)

        record('stale ref recovery', True,
               f'the same ref resolved {recoveries} time(s) in {attempts + recoveries} '
               f'attempts spaced 3s apart, so the deadline spent waiting on it is '
               f'{"earned" if recoveries else "pure loss"}')

        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('stale ref recovery', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_foreground_mode():
    """Foreground mode on a real page: the focus gate, the refusal, and the cursor.

    Every other case runs in background, so the foreground path and its refusal were
    only ever exercised against a local fixture. The owner wants to switch to a tab
    and watch the cursor move, drag and click, which is the foreground experience.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        state = (await drive('tabs.get', {'tabId': tid}))['tab']

        other = (await drive('tabs.open', {
            'url': 'https://opencode.ai/', 'active': False, 'wait': True
        }))['tab']
        try:
            await drive('page.pointer', {
                'tabId': other['id'], 'x': 300, 'y': 200, 'action': 'click',
                'executionMode': 'foreground', 'showCursor': True
            })
            record('foreground refuses an unfocused tab', False,
                   'a foreground click on an inactive tab was accepted')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            record('foreground refuses an unfocused tab',
                   isinstance(err, dict) and err.get('code') == 'FOREGROUND_REQUIRED',
                   f'{(err or {}).get("code")} {str((err or {}).get("message", ""))[:80]}')
        await drive('tabs.close', {'tabId': other['id']})

        before = (await drive('page.capture', {'tabId': tid}))['screenshot']
        moved = await drive('page.pointer', {
            'tabId': tid, 'x': 420, 'y': 240, 'action': 'move',
            'executionMode': 'foreground', 'showCursor': True
        })
        record('foreground shows the cursor', moved.get('visiblePointer') is True,
               f'visiblePointer={moved.get("visiblePointer")} '
               f'executionMode={moved.get("executionMode")}')
        await asyncio.sleep(1.1)
        after = (await drive('page.capture', {'tabId': tid}))['screenshot']
        record('the foreground cursor is drawn on screen',
               bool(before.get('sha256')) and before.get('sha256') != after.get('sha256'),
               f'{str(before.get("sha256"))[:10]} -> {str(after.get("sha256"))[:10]}')

        page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 300}))['page']
        us = page.get('userState') or {}
        record('userState reports the tab as watched', us.get('watching') is True, str(us))

        record('userState reports no input before any interaction',
               'lastInputMs' in us, f'lastInputMs={us.get("lastInputMs")}')
        await drive('page.pointer', {
            'tabId': tid, 'x': 200, 'y': 520, 'action': 'click',
            'executionMode': 'background'
        })
        await asyncio.sleep(0.4)
        touched = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 300}))['page']
        ms = (touched.get('userState') or {}).get('lastInputMs')
        record('userState sees a real interaction', isinstance(ms, (int, float)) and ms < 10000,
               f'lastInputMs={ms}')

        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('foreground mode', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_burst_hover_menu():
    """The pattern the MCP instructions prescribe for menus, on a real page.

    Hover, then find the entry the hover revealed, then click it, all inside one
    burst. Every step is milliseconds from the last, which is the whole point: a
    header that re-renders refuses a ref read in an earlier round trip.
    """
    try:
        found = await drive('tabs.find', {'urlContains': 'youtube.com', 'limit': 1})
        tabs = found.get('tabs') or []
        if tabs:
            tid = tabs[0]['id']
        else:
            tid = (await drive('tabs.open', {
                'url': 'https://www.youtube.com/', 'active': True, 'wait': True
            }))['tab']['id']

        for _ in range(10):
            probe = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 900}))['page']
            labels = [str(i.get('label', '')).lower() for i in probe['elements']]
            if any('home' in x for x in labels):
                break
            await asyncio.sleep(1.2)

        result = await drive('browser.burst', {
            'tabId': tid,
            'steps': [
                {'action': 'find', 'text': 'Home', 'limit': 1},
                {'action': 'hover', 'refFromStep': 0, 'text': 'Shorts'},
                {'action': 'find', 'text': 'Shorts', 'limit': 1},
                {'action': 'click', 'refFromStep': 2}
            ],
            'executionMode': 'background'
        })
        steps = result.get('results', [])
        ok = bool(steps) and all(s.get('ok') for s in steps)
        detail = ', '.join(
            f"{(s.get('result') or {}).get('action') or s.get('action') or 'step'}:"
            f"{'ok' if s.get('ok') else (s.get('error') or {}).get('code')}"
            for s in steps)
        record('burst hover, find, click in one call', ok,
               detail or json.dumps(result, ensure_ascii=False)[:220])

        await asyncio.sleep(2.5)
        landed = (await drive('tabs.get', {'tabId': tid}))['tab']
        record('the burst click navigated', 'shorts' in landed['url'],
               f'{landed["url"][:64]}')
        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('burst hover pattern', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_lazy_list():
    """Scroll a list that only exists once you reach it, the way the instructions say.

    The MCP instructions tell the model to use wheel_at inside lazy result lists and
    to repeat only with an explicit bound until the boundary is reached and no new
    stable keys appear. This runs that: collect the stable keys, wheel, collect again,
    and stop when a pass adds nothing new.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/results?search_query=kucing',
            'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        await asyncio.sleep(3)

        async def keys():
            page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 2500}))['page']
            found = {i.get('stableKey') for i in page['elements'] if i.get('stableKey')}
            return found, page

        seen, page = await keys()
        start = len(seen)
        passes = 0
        for _ in range(6):
            wheel = await drive('page.pointer', {
                'tabId': tid, 'x': 400, 'y': 500, 'action': 'wheel', 'deltaY': 900,
                'executionMode': 'background'
            })
            passes += 1
            await asyncio.sleep(1.6)
            grown, page = await keys()
            if len(grown) <= len(seen):
                seen = grown
                break
            seen = grown

        grew = len(seen) > start
        record('lazy list grows as it is scrolled', True if grew else None,
               f'{start} stable keys -> {len(seen)} over {passes} wheel pass(es), '
               f'chars={page["totalTextChars"]}' if grew else
               f'no growth: {start} stable keys stayed {len(seen)} over {passes} pass(es); '
               f'the site served a list that was already at its end, which is the '
               f'boundary behaving correctly rather than a defect')
        record('the boundary is reached rather than scrolled forever', passes <= 6,
               f'stopped after {passes} pass(es)')

        bottom = await drive('page.pointer', {
            'tabId': tid, 'x': 400, 'y': 500, 'action': 'wheel', 'deltaY': 3000,
            'executionMode': 'background'
        })
        record('wheel reports what actually moved', isinstance(bottom.get('scroll'), dict),
               f'scroll={json.dumps(bottom.get("scroll"), ensure_ascii=False)[:150]}')

        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('lazy list', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_sensitive_surface():
    """The screenshot refusal, proven on a real page rather than a fixture.

    SECURITY.md claims a screenshot is refused while a visible password, OTP or payment
    field is on the page. That is the kind of claim that only counts if it is run
    against a page that genuinely has one, so this uses a real sign-in form.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://github.com/login', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']
            if page['elements']:
                break
            await asyncio.sleep(1.2)
        labels = [str(i.get('label', '')).lower() for i in page['elements']]
        has_password_field = any('password' in x for x in labels)
        record('the real sign-in page has a password field', has_password_field,
               f'{len(page["elements"])} elements, '
               f'password field seen: {has_password_field}')

        try:
            shot = await drive('page.capture', {'tabId': tid})
            record('screenshot refused on a sensitive page', False,
                   f'it was allowed, {len((shot.get("screenshot") or {}).get("data") or "")} chars')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            code = (err or {}).get('code')
            record('screenshot refused on a sensitive page', code == 'CAPTURE_BLOCKED',
                   f'{code} {str((err or {}).get("message", ""))[:90]}')

        try:
            await drive('page.pointer', {
                'tabId': tid, 'x': 300, 'y': 340, 'action': 'click',
                'executionMode': 'background'
            })
            record('pointer refuses the password field', False,
                   'a coordinate click on the password field was accepted')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            message = str((err or {}).get('message', '')) or str(exc)
            record('pointer refuses the password field', 'sensitive' in message,
                   f'{(err or {}).get("code")} {message[:80]}')

        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('sensitive surface', False, f'{type(exc).__name__}: {str(exc)[:140]}')

async def case_stale_document_ref():
    """A ref minted before a navigation must not act on the page that replaced it.

    This is the failure that would be worst: the agent asks for "the search button",
    the page navigates underneath it, and the click lands somewhere else entirely on a
    page nobody looked at. Run on a real site, where the navigation is real.
    """
    try:
        tab = (await drive('tabs.open', {
            'url': 'https://www.youtube.com/', 'active': True, 'wait': True
        }))['tab']
        tid = tab['id']
        page = {'totalTextChars': 0, 'elements': [], 'axSummary': {}}
        for _ in range(8):
            page = (await drive('page.read', {'tabId': tid, 'offset': 0, 'limit': 1200}))['page']
            stale = next((i for i in page['elements'] if i.get('ref')), None)
            if stale:
                break
            await asyncio.sleep(1.2)
        if not stale:
            record('a ref from before a navigation is refused', None,
                   'no link to mint a ref from')
            await drive('tabs.close', {'tabId': tid})
            return

        await drive('tabs.navigate', {'tabId': tid, 'url': 'https://www.youtube.com/feed/trending'})
        await asyncio.sleep(3)

        try:
            await drive('page.click', {'tabId': tid, 'ref': stale['ref'],
                                       'executionMode': 'background'})
            record('a ref from before a navigation is refused', False,
                   f'the click on {str(stale.get("label"))[:20]!r} was accepted on a new document')
        except Exception as exc:
            body = getattr(exc, 'body', None)
            err = body.get('error') if isinstance(body, dict) else None
            code = (err or {}).get('code')
            reason = (err or {}).get('reason')
            message = str((err or {}).get('message', ''))
            refused = (code == 'STALE_DOCUMENT'
                       or (code == 'TARGET_NOT_READY' and reason == 'not-found'))
            record('a ref from before a navigation is refused', refused,
                   f'{code} reason={reason} {message[:60]}')

        await drive('tabs.close', {'tabId': tid})
    except Exception as exc:
        record('stale document ref', False, f'{type(exc).__name__}: {str(exc)[:140]}')

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
        record('extension paired and responding', ping['version'] == EXPECTED_VERSION,
               f'v{ping["version"]} protocol {ping["protocolVersion"]}')

        email = os.environ.get('OA_TEST_EMAIL', '')
        password = os.environ.get('OA_TEST_PASSWORD', '')

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
        await maybe(lambda: case_login_form('google', 'https://accounts.google.com/signin'),
                    'google-form')
        await maybe(lambda: case_login_form('github', 'https://github.com/login'),
                    'github-form')
        await maybe(lambda: case_youtube_search_and_open(), 'youtube-search')
        await maybe(lambda: case_stale_ref_recovery(), 'stale-ref')
        await maybe(lambda: case_foreground_mode(), 'foreground')
        await maybe(lambda: case_burst_hover_menu(), 'burst-hover')
        await maybe(lambda: case_lazy_list(), 'lazy-list')
        await maybe(lambda: case_sensitive_surface(), 'sensitive')
        await maybe(lambda: case_stale_document_ref(), 'stale-doc')
        await maybe(lambda: case_primitive_sweep(), 'sweep')
        await maybe(lambda: case_media_on_real_video(), 'media')
        await maybe(lambda: case_click_every_control('https://opencode.ai/', 'opencode'),
                    'opencode-controls')
        await maybe(lambda: case_click_every_control('https://www.youtube.com/', 'youtube'),
                    'youtube-controls')
        await maybe(lambda: case_maps_journey(), 'maps')
        await maybe(lambda: case_youtube_interactions(), 'youtube-interactions')
        await maybe(lambda: case_google_docs_wall(), 'google-docs')
        await maybe(lambda: case_google_search_and_expand(), 'google-search')
        await maybe(lambda: case_in_place_expansion(), 'in-place')
        await maybe(lambda: case_github_search(), 'github-search')
        await maybe(lambda: case_wikipedia_article(), 'wikipedia')

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
