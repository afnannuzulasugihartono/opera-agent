import asyncio
import io
import json
import queue
import tempfile
import threading
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
HOST = '127.0.0.1'
PAIR_CODE = 'TEST-PAIR-1234'
EXPECTED_EXTENSION_ID = 'ohbbpamcljckmjhcpkcmefdobkoeaick'

class BridgeState:
    def __init__(self):
        self.commands = queue.Queue()
        self.completed = {}
        self.started = {}
        self.metrics = []
        self.cv = threading.Condition()
        self.paired = False
        self.fail_pull_until = 0.0

    def push(self, method, params=None, timeout=12000, benchmark=None):
        cid = str(uuid.uuid4())
        command = {'id': cid, 'method': method, 'params': params or {}, 'timeoutMs': timeout}
        self.started[cid] = {
            'name': benchmark or method,
            'method': method,
            'started': time.perf_counter(),
            'requestBytes': len(json.dumps(command).encode())
        }
        self.commands.put(command)
        return cid

    def complete(self, cid, body):
        with self.cv:
            self.completed[cid] = body
            started = self.started.pop(cid, None)
            if started:
                self.metrics.append({
                    'name': started['name'],
                    'method': started['method'],
                    'latencyMs': round((time.perf_counter() - started['started']) * 1000, 2),
                    'requestBytes': started['requestBytes'],
                    'responseBytes': len(json.dumps(body).encode()),
                    'ok': body.get('ok') is True
                })
            self.cv.notify_all()

    def wait(self, cid, timeout=20):
        deadline = time.time() + timeout
        with self.cv:
            while cid not in self.completed and time.time() < deadline:
                self.cv.wait(timeout=0.1)
            if cid not in self.completed:
                raise TimeoutError(f'command {cid} not completed')
            return self.completed[cid]

STATE = BridgeState()

LONG_TEXT = 'BEGIN ' + ('civil-engineering-semantic-reader ' * 695) + ' END'
EXTRA_CONTROLS = ''.join(f'<button aria-label="Synthetic action {index}"></button>' for index in range(100))
PAGE = f'''<!doctype html><html><head><title>Opera Agent Test Page</title></head>
<body>
<h1>Opera Agent Browser Test</h1>
<p id="long">{LONG_TEXT}</p>
<button id="toggle" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed')==='true'?'false':'true')">Toggle</button>
<button id="rerender" onclick="this.replaceWith(this.cloneNode(true))">Rerender target</button>
<button id="spa-route" onclick="history.pushState({{}},'',location.pathname+'?semantic-route=2')">Change SPA route</button>
<button>Ambiguous duplicate</button><button>Ambiguous duplicate</button>
<input id="safe" aria-label="Normal field" value="" />
<input id="secret" type="password" aria-label="Password" value="" />
<input id="file" type="file" aria-label="Upload file" />
<div id="editor" contenteditable="true" aria-label="Document editor">draft</div>
<canvas id="canvas" aria-label="Canvas interaction surface" width="240" height="120" style="background:#cbd5e1"></canvas>
<div id="canvas-status">canvas-idle</div>
  <div id="surface" aria-label="Pointer test surface" style="width:240px;height:120px;background:#ddd" onmousemove="if(event.buttons)this.textContent='dragged'" onwheel="this.textContent='wheel'">surface</div>
  <div id="scrollbox" role="feed" aria-label="Lazy result list" style="position:fixed;right:16px;top:16px;z-index:10;width:320px;height:140px;overflow-y:auto;overflow-anchor:none;border:1px solid #333;background:white">
    <button id="first-result">First result</button>
    <div style="height:600px">Scrollable results</div>
    <button id="last-result">Last initial result</button>
  </div>
<a href="/page?next=1">Next internal</a>
<a href="https://example.com/">External</a>
{EXTRA_CONTROLS}
<script>
document.getElementById('canvas').addEventListener('click', () => {{
  const status = document.getElementById('canvas-status');
  const count = Number(status.dataset.count || 0) + 1;
  status.dataset.count = String(count);
  status.textContent = `canvas-clicked-${{count}}`;
}});
document.getElementById('scrollbox').addEventListener('scroll', (event) => {{
  const list = event.currentTarget;
  if (!list.dataset.loaded && list.scrollTop + list.clientHeight >= list.scrollHeight - 300) {{
    list.dataset.loaded = 'true';
    const more = document.createElement('div');
    more.id = 'lazy-results';
    more.style.height = '240px';
    more.innerHTML = '<button id="lazy-result-a">Lazy result A</button><button id="lazy-result-b">Lazy result B</button>';
    list.append(more);
  }}
}});
</script>
</body></html>'''

VISUAL_PAGE = '''<!doctype html><html><head><title>Opera Agent Visual Test</title></head>
<body style="margin:0;background:#eef2ff;color:#172554;font-family:sans-serif">
<main style="padding:32px"><h1>Adaptive screenshot</h1><canvas id="visual" width="640" height="320"></canvas></main>
<script>
const canvas = document.getElementById('visual');
const ctx = canvas.getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 640, 320);
gradient.addColorStop(0, '#2563eb'); gradient.addColorStop(1, '#7c3aed');
ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 320);
ctx.fillStyle = 'white'; ctx.font = 'bold 38px sans-serif'; ctx.fillText('Opera Agent Vision', 110, 175);
</script></body></html>'''

BLANK_PAGE = '''<!doctype html><html><head><title>Opera Agent Blank Test</title>
<style>html,body{margin:0;width:100%;height:100%;background:#fff}</style></head><body></body></html>'''

IFRAME_PAGE = '''<!doctype html><html><head><title>Opera Agent Iframe Privacy Test</title></head>
<body><h1>Safe-looking parent</h1><iframe src="/page?embedded-sensitive=1" width="500" height="300"></iframe></body></html>'''

R0_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r0.html').read_text(encoding='utf-8')
R1_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r1.html').read_text(encoding='utf-8')
R2_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r2.html').read_text(encoding='utf-8')
R3_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r3.html').read_text(encoding='utf-8')
R4_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r4.html').read_text(encoding='utf-8')
R5_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-r5.html').read_text(encoding='utf-8')
UI_IDENTITY_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-ui-identity.html').read_text(encoding='utf-8')
AX_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-ax.html').read_text(encoding='utf-8')
UV_PAGE = (ROOT / 'tests' / 'fixtures' / 'pre-8e-usability-uv.html').read_text(encoding='utf-8')

def build_r5_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1)
        wav.setframerate(8000)
        wav.writeframes(bytes([128]) * 16000)
    return buffer.getvalue()

R5_WAV = build_r5_wav()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionError, OSError):
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/pre8e-r5.wav'):
            payload = R5_WAV
            start = 0
            end = len(payload) - 1
            status = 200
            range_header = self.headers.get('Range', '').strip()
            if range_header:
                if not range_header.startswith('bytes=') or ',' in range_header:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{len(payload)}')
                    self.end_headers()
                    return
                start_text, end_text = range_header[6:].split('-', 1)
                try:
                    if start_text:
                        start = int(start_text)
                        end = int(end_text) if end_text else end
                    else:
                        suffix_length = int(end_text)
                        if suffix_length <= 0:
                            raise ValueError('invalid suffix range')
                        start = max(0, len(payload) - suffix_length)
                except ValueError:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{len(payload)}')
                    self.end_headers()
                    return
                if start < 0 or end < start or start >= len(payload):
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{len(payload)}')
                    self.end_headers()
                    return
                end = min(end, len(payload) - 1)
                status = 206

            response_payload = payload[start:end + 1]
            self.send_response(status)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(payload)}')
            self.send_header('Content-Length', str(len(response_payload)))
            self.end_headers()
            try:
                self.wfile.write(response_payload)
            except (BrokenPipeError, ConnectionError, OSError):
                pass
            return

        if self.path.startswith('/page') or self.path.startswith('/visual') or self.path.startswith('/blank') or self.path.startswith('/iframe') or self.path.startswith('/pre8e-r0') or self.path.startswith('/pre8e-r1') or self.path.startswith('/pre8e-r2') or self.path.startswith('/pre8e-r3') or self.path.startswith('/pre8e-r4') or self.path.startswith('/pre8e-r5') or self.path.startswith('/pre8e-uv') or self.path.startswith('/pre8e-ui-identity') or self.path.startswith('/pre8e-ax'):
            if self.path.startswith('/pre8e-uv'):
                document = UV_PAGE
            elif self.path.startswith('/pre8e-ax'):
                document = AX_PAGE
            elif self.path.startswith('/pre8e-r5'):
                document = R5_PAGE
            elif self.path.startswith('/pre8e-r4'):
                document = R4_PAGE
            elif self.path.startswith('/pre8e-r3'):
                document = R3_PAGE
            elif self.path.startswith('/pre8e-r2'):
                document = R2_PAGE
            elif self.path.startswith('/pre8e-ui-identity'):
                document = UI_IDENTITY_PAGE
            elif self.path.startswith('/pre8e-r1'):
                document = R1_PAGE
            elif self.path.startswith('/pre8e-r0'):
                document = R0_PAGE
            elif self.path.startswith('/visual'):
                document = VISUAL_PAGE
            elif self.path.startswith('/blank'):
                document = BLANK_PAGE
            elif self.path.startswith('/iframe'):
                document = IFRAME_PAGE
            else:
                document = PAGE
            payload = document.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionError, OSError):
                pass
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != '/bridge':
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get('content-length', '0'))
        body = json.loads(self.rfile.read(length) or b'{}')
        action = body.get('action')
        if action == 'pair':
            if body.get('code') != PAIR_CODE:
                return self._send_json({'ok': False, 'error': 'bad code'}, 401)
            STATE.paired = True
            return self._send_json({'ok': True, 'deviceId': 'mock-device', 'deviceName': body.get('deviceName', 'opera'), 'protocolVersion': 1})
        if action == 'pull':
            if time.time() < STATE.fail_pull_until:
                return self._send_json({'ok': False, 'error': 'temporary network failure'}, 503)
            try:
                cmd = STATE.commands.get(timeout=0.25)
            except queue.Empty:
                cmd = None
            return self._send_json({'ok': True, 'command': cmd})
        if action == 'complete':
            STATE.complete(body.get('commandId'), body)
            return self._send_json({'ok': True, 'status': 'completed' if body.get('ok') else 'failed'})
        if action == 'heartbeat':
            return self._send_json({'ok': True, 'serverTime': time.time()})
        return self._send_json({'ok': False, 'error': 'unknown action'}, 400)


def assert_completed_ok(body):
    assert body['ok'] is True, body
    assert body.get('result') is not None, body
    return body['result']

async def browser_focus_state(worker):
    return await worker.evaluate('''async () => {
        const windows = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
        const focusedWindow = windows.find((item) => item.focused) || null;
        const activeTab = focusedWindow
            ? (focusedWindow.tabs || []).find((item) => item.active) || null
            : null;
        return {
            focusedWindowId: focusedWindow ? focusedWindow.id : null,
            activeTabId: activeTab ? activeTab.id : null,
            activeUrl: activeTab ? activeTab.url : null
        };
    }''')

async def audited_background_command(worker, audit, method, params=None, timeout=20, command_timeout=12000):
    command_params = params or {}
    before = await browser_focus_state(worker)
    cid = STATE.push(method, command_params, timeout=command_timeout)
    body = await asyncio.to_thread(STATE.wait, cid, timeout)
    after = await browser_focus_state(worker)
    preserved = (
        before['focusedWindowId'] == after['focusedWindowId']
        and before['activeTabId'] == after['activeTabId']
    )
    audit.append({
        'method': method,
        'targetTabId': command_params.get('tabId'),
        'commandOk': body.get('ok') is True,
        'before': before,
        'after': after,
        'focusPreserved': preserved
    })
    assert preserved, f'{method} stole browser focus: before={before}, after={after}'
    return body

async def wait_worker(context, timeout_ms=10000):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        workers = context.service_workers
        if workers:
            return workers[0]
        await asyncio.sleep(0.1)
    raise RuntimeError('extension service worker did not start')

def managed_browser_resources(func):
    async def wrapped():
        server = ThreadingHTTPServer((HOST, 0), Handler)
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        profile_dir = tempfile.TemporaryDirectory(prefix='opera-agent-browser-')
        try:
            await asyncio.sleep(0.2)
            return await func(port, Path(profile_dir.name))
        finally:
            server.shutdown()
            server.server_close()
            profile_dir.cleanup()
    return wrapped


@managed_browser_resources
async def run(port, profile):
    async with async_playwright() as p:
        import os
        default_headless = '0' if os.name == 'nt' else '1'
        headless = os.environ.get('OA_BROWSER_HEADLESS', default_headless) != '0'
        launch_kwargs = {}
        browser_executable = os.environ.get('OA_BROWSER_EXECUTABLE', '')
        if browser_executable:
            launch_kwargs['executable_path'] = browser_executable
        elif os.path.exists('/usr/bin/chromium'):
            launch_kwargs['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile),
            headless=headless,
            ignore_default_args=['--disable-extensions'],
            **launch_kwargs,
            args=[
                f'--disable-extensions-except={EXT}',
                f'--load-extension={EXT}',
                '--no-sandbox',
                '--disable-dev-shm-usage'
            ]
        )
        worker = await wait_worker(context)
        ext_id = worker.url.split('/')[2]
        assert ext_id == EXPECTED_EXTENSION_ID, ext_id
        popup = await context.new_page()
        await popup.goto(f'chrome-extension://{ext_id}/popup.html')
        await popup.evaluate(f"chrome.storage.local.set({{bridgeUrl:'http://{HOST}:{port}/bridge'}})")
        await popup.reload()
        await popup.fill('#pairCode', PAIR_CODE)
        await popup.click('#pairButton')
        await popup.locator('#pairedSection').wait_for(state='visible', timeout=10000)
        assert STATE.paired

        cid = STATE.push('browser.ping', benchmark='browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['version'] == '1.6.12'
        assert result['protocolVersion'] == 1

        cid = STATE.push('tabs.find', {'urlContains': 'definitely-not-open.invalid'}, benchmark='tabs.find')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['count'] == 0

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/page', 'active': True, 'wait': True}, benchmark='tabs.open+complete')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        tab_id = result['tab']['id']
        assert result['tab']['title'] == 'Opera Agent Test Page'

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 1}, benchmark='page.read.small')
        small_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert small_page['textChars'] == 300
        assert len(small_page['elements']) == 1
        assert small_page['viewport']['width'] > 0
        # U-P1: text-rich pages keep the unchanged fast path — no CDP
        # accessibility snapshot is attached.
        assert 'axSummary' not in small_page, small_page.keys()
        assert small_page['viewport']['height'] > 0
        assert small_page['viewport']['zoomFactor'] > 0
        assert isinstance(small_page['mutationVersion'], int)
        assert small_page['elements'][0]['stableKey'].startswith('oa_')
        assert isinstance(small_page['elements'][0]['inViewport'], bool)

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 10000, 'maxElements': 50}, benchmark='page.read.semantic')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        page = result['page']
        assert page['textChars'] > 2400, page['textChars']
        assert page['totalTextChars'] > 2400
        assert page['text'].startswith('Opera Agent Browser Test')
        assert page['semanticState']['schemaVersion'] == 1
        assert page['semanticState']['documentGeneration'] == 1
        assert page['semanticState']['ambiguityCount'] >= 2
        # R1 ranks non-sensitive usable controls before the bounded element cap.
        # This page has >50 non-sensitive controls, so sensitive fields should no
        # longer consume the first 50 model-facing observation slots.
        assert page['semanticState']['excludedSensitiveCount'] == 0
        assert all(item['sensitive'] is False for item in page['elements'])
        identified = page['elements']
        assert all(item['logicalId'].startswith('se_') for item in identified)

        # R1 actionability ranking is viewport-sensitive. Settle the viewport on
        # the rerender target before taking the identity baseline so this legacy
        # rerender test measures DOM replacement continuity, not bounded-window
        # membership changes caused by clickSynthetic scrolling the target.
        rerender_pre_scroll = next(item for item in page['elements'] if item['label'] == 'Rerender target')
        cid = STATE.push('page.scroll', {
            'tabId': tab_id,
            'ref': rerender_pre_scroll['ref'],
            'block': 'center',
            'behavior': 'instant'
        }, benchmark='r1.semantic.rerender.settle-viewport')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        settled_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']

        # Semantic identity intentionally uses removalGraceObservations=1. After
        # the viewport-sensitive R1 ranking changes bounded top-50 membership,
        # one additional observation may emit ABSENT_AFTER_GRACE removals for
        # entities that left the observation window. Drain that grace transition
        # before asserting a stable no-change baseline.
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        grace_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        grace_by_stable_key = {
            item['stableKey']: item for item in grace_page['elements']
            if not item['sensitive'] and not item.get('identityAmbiguous', False)
        }

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        repeated_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        repeated_by_stable_key = {
            item['stableKey']: item for item in repeated_page['elements']
            if not item['sensitive'] and not item.get('identityAmbiguous', False)
        }
        assert all(
            repeated_by_stable_key[key]['logicalId'] == item['logicalId']
            for key, item in grace_by_stable_key.items()
        )
        assert repeated_page['semanticDelta']['classification'] == 'NO_RELEVANT_CHANGE', repeated_page['semanticDelta']

        rerender_before = next(item for item in repeated_page['elements'] if item['label'] == 'Rerender target')
        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': rerender_before['ref']})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        rerendered_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        rerender_after = next(item for item in rerendered_page['elements'] if item['label'] == 'Rerender target')
        assert rerender_after['logicalId'] == rerender_before['logicalId']
        assert rerender_after['ref'] != rerender_before['ref']
        rerender_change_types = {change['type'] for change in rerendered_page['semanticDelta']['changes']}
        assert 'INSERT' not in rerender_change_types and 'REMOVE' not in rerender_change_types, rerendered_page['semanticDelta']
        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': rerender_before['ref']})
        revalidated = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert revalidated['ref'] == rerender_before['ref'], revalidated

        # Reuse the R0 fixture as a cross-check that the R1 actionability repair
        # ranks the on-screen Skip ahead of the CSS-visible offscreen navigation
        # target and the R2 same-document revalidation repair recovers its stale
        # pre-rerender ref without changing the frozen historical R0 evidence file.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r0',
            'active': False,
            'wait': True
        }, benchmark='r0.tabs.open')
        r0_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.find', {
            'tabId': r0_tab_id,
            'text': 'Skip',
            'limit': 5
        }, benchmark='r0.page.find.skip')
        r0_skip_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r0_skip_find['count'] >= 2, r0_skip_find
        r0_skip_items = r0_skip_find['items']
        r0_real_skip = next(item for item in r0_skip_items if item['label'] == 'Skip')
        r0_skip_navigation = next(item for item in r0_skip_items if item['label'] == 'Skip navigation')
        assert r0_real_skip['visible'] is True, r0_real_skip
        assert r0_real_skip['inViewport'] is True, r0_real_skip
        assert r0_real_skip['actionable'] is True, r0_real_skip
        assert r0_skip_navigation['visible'] is True, r0_skip_navigation
        assert r0_skip_navigation['inViewport'] is False, r0_skip_navigation
        assert r0_skip_navigation['actionable'] is False, r0_skip_navigation
        assert r0_skip_items.index(r0_real_skip) < r0_skip_items.index(r0_skip_navigation), r0_skip_items

        r0_old_skip_ref = r0_real_skip['ref']
        cid = STATE.push('page.query', {
            'tabId': r0_tab_id,
            'selector': '#rerender-skip'
        })
        r0_rerender = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {
            'tabId': r0_tab_id,
            'ref': r0_rerender['ref'],
            'trusted': False
        })
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {
            'tabId': r0_tab_id,
            'selector': '#ad-skip'
        })
        r0_fresh_skip = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        assert r0_fresh_skip['ref'] != r0_old_skip_ref
        cid = STATE.push('page.click', {
            'tabId': r0_tab_id,
            'ref': r0_old_skip_ref,
            'trusted': False
        }, benchmark='r0.page.click.revalidate')
        r0_revalidated_click = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r0_revalidated_click['ref'] == r0_old_skip_ref, r0_revalidated_click
        cid = STATE.push('page.query', {
            'tabId': r0_tab_id,
            'selector': '#ad-skip'
        })
        r0_rebound_skip = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        assert r0_rebound_skip['ref'] == r0_old_skip_ref, r0_rebound_skip

        cid = STATE.push('page.read', {
            'tabId': r0_tab_id,
            'offset': 0,
            'limit': 12000,
            'maxElements': 200
        }, benchmark='r0.page.read.legacy')
        r0_page_before = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        r0_payload_bytes = len(json.dumps(r0_page_before).encode())
        cid = STATE.push('page.query', {
            'tabId': r0_tab_id,
            'selector': '#noise-tick'
        })
        r0_noise_tick = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {
            'tabId': r0_tab_id,
            'ref': r0_noise_tick['ref'],
            'trusted': False
        })
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {
            'tabId': r0_tab_id,
            'offset': 0,
            'limit': 12000,
            'maxElements': 200
        })
        r0_page_after_noise = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert r0_page_after_noise['mutationVersion'] > r0_page_before['mutationVersion']

        cid = STATE.push('media.state', {
            'tabId': r0_tab_id,
            'index': 0
        }, benchmark='r0.media.state')
        r0_media = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['media']
        assert r0_media['present'] is True, r0_media
        assert r0_media['count'] == 1, r0_media
        assert r0_media['tag'] == 'video', r0_media

        cid = STATE.push('tabs.close', {'tabId': r0_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))


        # R1 acceptance: generic actionability ranking must hold before
        # bounded model-facing truncation.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r1',
            'active': False,
            'wait': True
        }, benchmark='r1.tabs.open')
        r1_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Skip',
            'limit': 6
        }, benchmark='r1.page.find.skip')
        r1_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        r1_items = r1_find['items']
        assert r1_items[0]['label'] == 'Skip', r1_items
        assert r1_items[0]['visible'] is True, r1_items[0]
        assert r1_items[0]['inViewport'] is True, r1_items[0]
        assert r1_items[0]['sensitive'] is False, r1_items[0]
        assert r1_items[0]['disabled'] is False, r1_items[0]
        assert r1_items[0]['actionable'] is True, r1_items[0]

        r1_offscreen = next(item for item in r1_items if item['label'] == 'Skip navigation')
        assert r1_offscreen['visible'] is True, r1_offscreen
        assert r1_offscreen['inViewport'] is False, r1_offscreen
        assert r1_offscreen['actionable'] is False, r1_offscreen

        r1_disabled = next(item for item in r1_items if item['label'] == 'Skip disabled')
        assert r1_disabled['disabled'] is True, r1_disabled
        assert r1_disabled['inViewport'] is True, r1_disabled
        assert r1_disabled['actionable'] is False, r1_disabled

        r1_sensitive = next(item for item in r1_items if item['label'] == 'Skip credential')
        assert r1_sensitive['sensitive'] is True, r1_sensitive
        assert r1_sensitive['inViewport'] is True, r1_sensitive
        assert r1_sensitive['actionable'] is False, r1_sensitive
        assert all(item['label'] != 'Skip hidden' for item in r1_items), r1_items

        # R8 acceptance: the normal omitted-limit find path projects a unique
        # exact actionable match without hiding genuine actionable ambiguity.
        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Skip'
        }, benchmark='r8.page.find.skip.default')
        r8_default_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_default_find['count'] >= 4, r8_default_find
        assert len(r8_default_find['items']) == 1, r8_default_find
        assert r8_default_find['item'] == r8_default_find['items'][0], r8_default_find
        assert r8_default_find['item']['label'] == 'Skip', r8_default_find
        assert r8_default_find['item']['actionable'] is True, r8_default_find
        assert r8_default_find['item']['sensitive'] is False, r8_default_find

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Skip',
            'exact': True
        }, benchmark='r8.page.find.skip.exact')
        r8_exact_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_exact_find['count'] == 1, r8_exact_find
        assert r8_exact_find['item']['label'] == 'Skip', r8_exact_find

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Choose'
        }, benchmark='r8.page.find.choose.ambiguous')
        r8_ambiguous_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_ambiguous_find['count'] == 2, r8_ambiguous_find
        assert len(r8_ambiguous_find['items']) == 2, r8_ambiguous_find
        assert all(item['actionable'] is True for item in r8_ambiguous_find['items']), r8_ambiguous_find

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Choose',
            'limit': 20
        }, benchmark='r8.page.find.choose.explicit-limit-ambiguous')
        r8_explicit_ambiguous = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_explicit_ambiguous['count'] == 2, r8_explicit_ambiguous
        assert len(r8_explicit_ambiguous['items']) == 2, r8_explicit_ambiguous
        assert all(item['actionable'] is True for item in r8_explicit_ambiguous['items']), r8_explicit_ambiguous

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Alpha Beta',
            'limit': 6
        }, benchmark='r8.page.find.combined-fields')
        r8_combined_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_combined_find['count'] == 1, r8_combined_find
        assert r8_combined_find['item']['label'] == 'Alpha', r8_combined_find

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Alpha Beta',
            'exact': True,
            'limit': 6
        }, benchmark='r8.page.find.combined-fields.exact')
        r8_combined_exact = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_combined_exact['count'] == 1, r8_combined_exact
        assert r8_combined_exact['item']['label'] == 'Alpha', r8_combined_exact

        # R8 repair: callers may request a diagnostic list explicitly. Keep the
        # list intact, but expose the one exact actionable match as `item`.
        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Launch',
            'limit': 20
        }, benchmark='r8.page.find.explicit-limit-dominant')
        r8_explicit_limit = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_explicit_limit['count'] == 2, r8_explicit_limit
        assert len(r8_explicit_limit['items']) == 2, r8_explicit_limit
        assert r8_explicit_limit['items'][0]['label'] == 'Launch options', r8_explicit_limit
        assert r8_explicit_limit['item']['label'] == 'Launch', r8_explicit_limit
        assert r8_explicit_limit['item']['actionable'] is True, r8_explicit_limit

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Launch',
            'limit': 20,
            'index': 0
        }, benchmark='r8.page.find.explicit-index-wins')
        r8_explicit_index = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_explicit_index['item']['label'] == 'Launch options', r8_explicit_index

        # CSS overflow does not clip an absolutely positioned descendant when
        # the clipping node lies between it and its containing block. Browser
        # hit-testing is the authority for this reachable viewport target.
        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Viewport escape',
            'exact': True,
            'limit': 20
        }, benchmark='r8.page.find.containing-block-escape')
        r8_containing_block_escape = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_containing_block_escape['count'] == 1, r8_containing_block_escape
        assert r8_containing_block_escape['item']['visible'] is True, r8_containing_block_escape
        assert r8_containing_block_escape['item']['inViewport'] is True, r8_containing_block_escape
        assert r8_containing_block_escape['item']['viewportClipped'] is False, r8_containing_block_escape
        assert r8_containing_block_escape['item']['actionable'] is True, r8_containing_block_escape

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Genuine clipped',
            'exact': True,
            'limit': 20
        }, benchmark='r8.page.find.genuine-clipping')
        r8_genuine_clipping = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert r8_genuine_clipping['count'] == 1, r8_genuine_clipping
        assert r8_genuine_clipping['item']['visible'] is True, r8_genuine_clipping
        assert r8_genuine_clipping['item']['inViewport'] is False, r8_genuine_clipping
        assert r8_genuine_clipping['item']['viewportClipped'] is True, r8_genuine_clipping
        assert r8_genuine_clipping['item']['actionable'] is False, r8_genuine_clipping

        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Skip',
            'limit': 1
        }, benchmark='r1.page.find.skip.limit1')
        r1_capped_find = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert len(r1_capped_find['items']) == 1, r1_capped_find
        assert r1_capped_find['items'][0]['label'] == 'Skip', r1_capped_find

        cid = STATE.push('page.read', {
            'tabId': r1_tab_id,
            'offset': 0,
            'limit': 1200,
            'maxElements': 1
        }, benchmark='r1.page.read.max1')
        r1_read = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert len(r1_read['elements']) == 1, r1_read['elements']
        assert r1_read['elements'][0]['label'] == 'Skip', r1_read['elements']
        assert r1_read['elements'][0]['actionable'] is True, r1_read['elements'][0]

        # U-I: ranked candidates expose disambiguation hints (I2).
        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'Choose',
            'limit': 20,
            'index': 1
        }, benchmark='ui.page.find.ambiguity-hints')
        ui_hints = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert len(ui_hints['items']) == 2, ui_hints
        assert ui_hints['items'][0]['candidateRank'] == 1, ui_hints
        assert ui_hints['items'][1]['candidateRank'] == 2, ui_hints
        assert 'chose:1' in ui_hints['items'][0]['hint'], ui_hints
        assert 'chose:2' in ui_hints['items'][1]['hint'], ui_hints

        # U-I: when no exact-field match exists, one bounded fuzzy projection
        # is returned with an explicit hint instead of a bare zero (I2).
        cid = STATE.push('page.find', {
            'tabId': r1_tab_id,
            'text': 'nav',
            'exact': True,
            'limit': 20
        }, benchmark='ui.page.find.fuzzy-projection')
        ui_fuzzy = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert ui_fuzzy['count'] == 0, ui_fuzzy
        assert ui_fuzzy['items'] == [], ui_fuzzy
        assert ui_fuzzy['fuzzy'] is True, ui_fuzzy
        assert ui_fuzzy['item']['label'] == 'Skip navigation', ui_fuzzy
        assert ui_fuzzy['item']['actionable'] is False, ui_fuzzy
        assert 'exact-match' in ui_fuzzy['hint'], ui_fuzzy

        # U-I: a ref minted before a geometric relocation refuses rebind and
        # names the plausible current candidate with fresh geometry (I1).
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-ui-identity',
            'active': False,
            'wait': True
        }, benchmark='ui.tabs.open')
        ui_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.find', {
            'tabId': ui_tab_id,
            'text': 'Zoom in',
            'exact': True,
            'limit': 20,
            'index': 0
        }, benchmark='ui.page.find.mint-zoom')
        ui_zoom = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        ui_zoom_ref = ui_zoom['item']['ref']
        ui_zoom_x = ui_zoom['item']['rect']['x']
        assert ui_zoom['item']['actionable'] is True, ui_zoom

        cid = STATE.push('page.find', {
            'tabId': ui_tab_id,
            'text': 'Relocate control',
            'exact': True
        }, benchmark='ui.page.find.trigger')
        ui_trigger_ref = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['ref']

        cid = STATE.push('page.click', {'tabId': ui_tab_id, 'ref': ui_trigger_ref}, benchmark='ui.page.click.trigger')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.click', {'tabId': ui_tab_id, 'ref': ui_zoom_ref}, benchmark='ui.page.click.geometry-reject')
        ui_reject = await asyncio.to_thread(STATE.wait, cid)
        ui_reject_msg = ui_reject['error']['message'] if isinstance(ui_reject.get('error'), dict) else str(ui_reject.get('error'))
        assert ui_reject['ok'] is False, ui_reject
        assert 'moved beyond the geometry tolerance' in ui_reject_msg, ui_reject
        assert 'Zoom in' in ui_reject_msg, ui_reject
        assert str(int(ui_zoom_x) + 600) in ui_reject_msg, ui_reject

        # U-I: visible text without an interactive element surfaces a nearby
        # actionable candidate in one round trip (I3).
        cid = STATE.push('page.find', {
            'tabId': ui_tab_id,
            'text': 'Quarterly document',
            'limit': 20
        }, benchmark='ui.page.find.visible-text-fallback')
        ui_fallback = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert ui_fallback['count'] == 0, ui_fallback
        assert ui_fallback['fuzzy'] is True, ui_fallback
        assert ui_fallback['item']['label'] == 'Save', ui_fallback
        assert ui_fallback['item']['ref'] is not None, ui_fallback

        # U-I (I4): a keyed ref survives a same-place successor recreated
        # WITHOUT its id (YouTube-style control re-render) via the unique
        # intrinsic-signature rebind fallback.
        cid = STATE.push('page.find', {
            'tabId': ui_tab_id,
            'text': 'Skip',
            'exact': True,
            'limit': 20,
            'index': 0
        }, benchmark='ui.page.find.mint-skip')
        ui_skip = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        ui_skip_ref = ui_skip['item']['ref']
        assert ui_skip['count'] == 1, ui_skip
        assert ui_skip['item']['label'] == 'Skip', ui_skip
        assert ui_skip['item']['actionable'] is True, ui_skip

        cid = STATE.push('page.find', {
            'tabId': ui_tab_id,
            'text': 'Re-render control',
            'exact': True
        }, benchmark='ui.page.find.rerender-trigger')
        ui_rerender_ref = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['ref']

        cid = STATE.push('page.click', {'tabId': ui_tab_id, 'ref': ui_rerender_ref}, benchmark='ui.page.click.rerender-trigger')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.click', {'tabId': ui_tab_id, 'ref': ui_skip_ref}, benchmark='ui.page.click.signature-rebind')
        ui_rebind = await asyncio.to_thread(STATE.wait, cid)
        if ui_rebind.get('ok') is not True:
            raise AssertionError({
                'benchmark': 'ui.page.click.signature-rebind',
                'recentMetrics': STATE.metrics[-8:],
                'body': ui_rebind
            })

        cid = STATE.push('page.read', {'tabId': ui_tab_id, 'offset': 0, 'limit': 1200, 'includeElements': False})
        ui_after_skip = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert 'Skipped' in (ui_after_skip.get('text') or ''), ui_after_skip

        # U-P1 Layer A (research P1): controls inside open shadow roots join
        # the model-facing observation. Flat document scans never saw them;
        # the fixture hosts a shadow button that must be findable and
        # clickable through its normal ref.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-ax',
            'active': False,
            'wait': True
        }, benchmark='up1.tabs.open')
        ax_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.find', {
            'tabId': ax_tab_id,
            'text': 'Shadow save control',
            'exact': True,
            'limit': 20
        }, benchmark='up1.page.find.shadow-control')
        ax_shadow = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert ax_shadow['count'] == 1, ax_shadow
        assert ax_shadow['item']['actionable'] is True, ax_shadow
        ax_shadow_ref = ax_shadow['item']['ref']

        cid = STATE.push('page.click', {'tabId': ax_tab_id, 'ref': ax_shadow_ref}, benchmark='up1.page.click.shadow-control')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.read', {'tabId': ax_tab_id, 'offset': 0, 'limit': 300, 'includeElements': False}, benchmark='up1.page.read.after-shadow-click')
        ax_after = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert 'SavedByShadow' in (ax_after.get('text') or ''), ax_after

        # U-P1 Layer A: icon-only controls match through the computed
        # accessible name (field data: Maps transport buttons read as glyph
        # labels like " 3 min" while their icon vocabulary is an img alt).
        cid = STATE.push('page.find', {
            'tabId': ax_tab_id,
            'text': 'Motorcycle',
            'limit': 20
        }, benchmark='up1.page.find.accessible-name')
        ax_icon = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert ax_icon['count'] == 1, ax_icon
        assert ax_icon['item']['accessibleName'] == 'Motorcycle, 3 minutes', ax_icon

        # U-P1 Layer B (research P1): the text-poor canvas-class fixture
        # attaches a read-only CDP accessibility snapshot so the model can
        # read canvas-app state. Editable field values must never surface
        # anywhere in the result.
        cid = STATE.push('page.read', {
            'tabId': ax_tab_id,
            'offset': 0,
            'limit': 300,
            'maxElements': 5
        }, benchmark='up1.page.read.ax-summary')
        ax_read = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert 'axSummary' in ax_read, ax_read.keys()
        ax_summary = ax_read['axSummary']
        assert ax_summary['source'] == 'cdp-ax', ax_summary
        ax_items = {(item.get('role'), item.get('name')) for item in ax_summary['items']}
        assert ('StaticText', 'Canvas layer Cat uploaded') in ax_items, ax_items
        assert ('button', 'Shadow save control') in ax_items, ax_items
        assert ('application', 'Design board') in ax_items, ax_items
        ax_serialized = json.dumps(ax_read)
        assert 'typed secret text' not in ax_serialized, 'field values must never surface through axSummary'
        assert 'hunter2' not in ax_serialized, 'password content must never surface'

        # U-P3 (research P3): dismissed panels go stale in the model-facing
        # view and drop out of compact observations, so dismissed FAQ/cookie
        # controls stop reaching the model. Canonical state keeps them.
        cid = STATE.push('page.find', {'tabId': ax_tab_id, 'text': 'Dismiss panel', 'exact': True, 'limit': 10}, benchmark='up3.page.find.dismiss')
        dismiss = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert dismiss['count'] == 1, dismiss
        cid = STATE.push('page.click', {'tabId': ax_tab_id, 'ref': dismiss['item']['ref']}, benchmark='up3.page.click.dismiss')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.read', {'tabId': ax_tab_id, 'offset': 0, 'limit': 300, 'maxElements': 40}, benchmark='up3.page.read.stale-first')
        stale_first = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        first_panel = [item for item in stale_first['elements'] if item.get('label') == 'Dismiss panel']
        assert len(first_panel) == 1, first_panel
        assert first_panel[0]['visible'] is False, first_panel[0]
        assert first_panel[0].get('stale') is not True, first_panel[0]

        cid = STATE.push('page.read', {'tabId': ax_tab_id, 'offset': 0, 'limit': 300, 'maxElements': 40}, benchmark='up3.page.read.stale-marked')
        stale_marked = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        marked_panel = [item for item in stale_marked['elements'] if item.get('label') == 'Dismiss panel']
        assert len(marked_panel) == 1, marked_panel
        assert marked_panel[0]['stale'] is True, marked_panel[0]
        assert marked_panel[0]['visible'] is False, marked_panel[0]

        cid = STATE.push('page.read', {'tabId': ax_tab_id, 'offset': 0, 'limit': 300, 'view': 'compact'}, benchmark='up3.page.read.stale-dropped')
        stale_dropped = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        dropped_panel = [item for item in stale_dropped['elements'] if item.get('label') == 'Dismiss panel']
        assert len(dropped_panel) == 0, dropped_panel

        # U-S (P1): burst ref passthrough — find and click in ONE command so the
        # ref is minted and consumed within milliseconds, immune to the model
        # round-trip staleness observed live (find 15:29:36.329Z -> click
        # 15:29:50.434Z on YouTube). find result feeds click via refFromStep,
        # and a trailing wait acts as the in-burst post-condition check.
        # Reuses the already-verified U-I fixture tab.
        us_tab_id = ui_tab_id

        cid = STATE.push('browser.burst', {
            'tabId': us_tab_id,
            'steps': [
                {'action': 'find', 'text': 'Save', 'exact': True, 'limit': 20},
                {'action': 'click', 'refFromStep': 0, 'refIndex': 0},
                {'action': 'wait', 'selector': '#docs-result', 'timeoutMs': 2000}
            ]
        }, benchmark='us.burst.find-click-wait')
        us_burst = await asyncio.to_thread(STATE.wait, cid)
        if us_burst.get('ok') is not True:
            raise AssertionError({
                'benchmark': 'us.burst.find-click-wait',
                'recentMetrics': STATE.metrics[-8:],
                'body': us_burst
            })
        us_steps = (us_burst.get('result') or {}).get('results') or []
        assert len(us_steps) == 3, us_burst
        us_found = (us_steps[0].get('result') or {}).get('item') or {}
        assert us_found.get('label') == 'Save', us_burst
        us_clicked = us_steps[1].get('result') or {}
        assert us_clicked.get('resolvedFrom') == 'step:0', us_burst
        assert (us_steps[2].get('result') or {}).get('ok') is True, us_burst

        # U-S negative: a burst click may only reference an EARLIER step.
        cid = STATE.push('browser.burst', {
            'tabId': us_tab_id,
            'steps': [{'action': 'click', 'refFromStep': 3, 'refIndex': 0}]
        }, benchmark='us.burst.forward-ref.rejected')
        us_forward = await asyncio.to_thread(STATE.wait, cid)
        assert us_forward.get('ok') is False, us_forward
        assert 'refFromStep' in str(us_forward.get('error')), us_forward

        # U-S control: the same find-then-click split across two model round
        # trips (the shape that went stale live) still resolves on this fixture
        # through the established rebind path, because the Save control is
        # never destroyed here — the contrast is timing, not selection.
        cid = STATE.push('page.find', {
            'tabId': us_tab_id,
            'text': 'Save',
            'exact': True,
            'limit': 20
        }, benchmark='us.page.find.save')
        us_save_ref = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['ref']

        cid = STATE.push('page.click', {'tabId': us_tab_id, 'ref': us_save_ref}, benchmark='us.page.click.separate-roundtrip')
        us_separate = await asyncio.to_thread(STATE.wait, cid)
        if us_separate.get('ok') is not True:
            raise AssertionError({
                'benchmark': 'us.page.click.separate-roundtrip',
                'recentMetrics': STATE.metrics[-8:],
                'body': us_separate
            })

        # U-T (ETW): a device-local watcher must click a control that appears
        # AFTER arming, with zero model round trips between trigger and action.
        cid = STATE.push('watch.start', {
            'tabId': us_tab_id,
            'rule': {
                'trigger': {'kind': 'selectorPresence', 'selector': '#etw-late-save'},
                'action': {'type': 'click', 'trusted': False},
                'mode': 'once',
                'deadlineMs': 15000
            }
        }, benchmark='ut.watch.start')
        us_watch = await asyncio.to_thread(STATE.wait, cid)
        if us_watch.get('ok') is not True:
            raise AssertionError({
                'benchmark': 'ut.watch.start',
                'recentMetrics': STATE.metrics[-8:],
                'body': us_watch
            })

        # Wait past the 1.2s fixture delay, then inspect the debug markers.
        etw_verified = False
        us_watch_debug = None
        for attempt in range(20):
            await asyncio.sleep(0.7)
            cid = STATE.push('page.read', {'tabId': us_tab_id, 'limit': 600}, benchmark='ut.watch.verify')
            us_watch_read = await asyncio.to_thread(STATE.wait, cid)
            body = str(us_watch_read)
            if 'SavedByWatcher' in body:
                etw_verified = True
                break
            m = __import__('re').search(r"watch-(?:action|sent|err)[^\\]*", body)
            if m:
                us_watch_debug = m.group(0)[:220]
        assert etw_verified, {
            'benchmark': 'ut.watch.local-action',
            'recentMetrics': STATE.metrics[-8:],
            'watchStartBody': us_watch,
            'watchDebug': us_watch_debug,
            'note': 'watcher did not click the late control locally'
        }

        cid = STATE.push('watch.list', {'tabId': us_tab_id}, benchmark='ut.watch.list')
        us_watch_list = await asyncio.to_thread(STATE.wait, cid)
        assert us_watch_list.get('ok') is True, us_watch_list

        # U-V (action pipeline): instant-by-default actions. One command waits
        # out a late-actionable target, heals a stale ref via the U-I rebind
        # machinery, verifies via the expect machinery, and reports a final
        # structured outcome for a never-ready target.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-uv',
            'active': False,
            'wait': True
        }, benchmark='uv.tabs.open')
        uv_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        def uv_push(method, params, benchmark=None):
            return asyncio.to_thread(STATE.push, method, params, 12000, benchmark)

        async def uv_wait(cid_, benchmark):
            body = await asyncio.to_thread(STATE.wait, cid_)
            return body

        # Arm the fixture clock, then find the still-disabled Late button.
        cid = await uv_push('page.query', {'tabId': uv_tab_id, 'selector': '#uv-arm'})
        uv_arm_ref = assert_completed_ok(await uv_wait(cid, 'uv.arm.query'))['item']['ref']
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_arm_ref, 'trusted': False})
        assert_completed_ok(await uv_wait(cid, 'uv.arm.click'))
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Late', 'exact': True, 'limit': 5}, benchmark='uv.page.find.late')
        uv_late_ref = assert_completed_ok(await uv_wait(cid, 'uv.page.find.late'))['item']['ref']

        # (a) The target becomes actionable at t0+1.5s; ONE trusted command
        # must wait it out (waitedMs >= ~1400) and land the click.
        t0 = time.perf_counter()
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_late_ref, 'trusted': True}, benchmark='uv.page.click.late')
        uv_late_click = assert_completed_ok(await uv_wait(cid, 'uv.page.click.late'))
        uv_waited = uv_late_click['resolved']['waitedMs']
        uv_wall = (time.perf_counter() - t0) * 1000
        assert uv_waited >= 1200, uv_late_click
        assert uv_late_click['resolved']['attempts'] >= 2, uv_late_click
        assert uv_waited <= uv_wall + 100, (uv_waited, uv_wall)
        assert uv_late_click['resolved']['healed'] is False, uv_late_click
        cid = await uv_push('page.query', {'tabId': uv_tab_id, 'selector': '#uv-late-result'})
        assert assert_completed_ok(await uv_wait(cid, 'uv.late.effect'))['item'], 'late click did not land'

        # (b) Same-place successor: destroy the ref, then ONE trusted click on
        # the stale ref must heal (rebind) and land on the successor.
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Victim', 'exact': True, 'limit': 5}, benchmark='uv.page.find.victim')
        uv_victim_ref = assert_completed_ok(await uv_wait(cid, 'uv.page.find.victim'))['item']['ref']
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Kill', 'exact': True, 'limit': 5}, benchmark='uv.page.find.kill')
        uv_kill_ref = assert_completed_ok(await uv_wait(cid, 'uv.page.find.kill'))['item']['ref']
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_kill_ref, 'trusted': False})
        assert_completed_ok(await uv_wait(cid, 'uv.kill.click'))
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_victim_ref, 'trusted': True}, benchmark='uv.page.click.heal')
        uv_heal_click = assert_completed_ok(await uv_wait(cid, 'uv.page.click.heal'))
        assert uv_heal_click['resolved']['healed'] is True, uv_heal_click
        cid = await uv_push('page.query', {'tabId': uv_tab_id, 'selector': '#uv-victim-result'})
        assert assert_completed_ok(await uv_wait(cid, 'uv.heal.effect'))['item'], 'healed click did not land on successor'

        # (c) Verify path: click with an expect spec must surface the real
        # post-action verification as resolved.verified.
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Toggle', 'exact': True, 'limit': 5}, benchmark='uv.page.find.tog')
        uv_tog_ref = assert_completed_ok(await uv_wait(cid, 'uv.page.find.tog'))['item']['ref']
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_tog_ref, 'trusted': True, 'expect': {'selectorAppears': '#uv-tog-result'}}, benchmark='uv.page.click.verify')
        uv_tog_click = assert_completed_ok(await uv_wait(cid, 'uv.page.click.verify'))
        assert uv_tog_click['resolved'].get('verified') is True, uv_tog_click

        # (d) Never-ready target: one command returns the structured final
        # outcome after waiting out the deadline (single command, no retry).
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Gone', 'exact': True, 'limit': 5}, benchmark='uv.page.find.gone')
        uv_gone_find = assert_completed_ok(await uv_wait(cid, 'uv.page.find.gone'))
        uv_gone_ref = next(i['ref'] for i in uv_gone_find['items'] if i['label'] == 'Gone')
        cid = await uv_push('page.find', {'tabId': uv_tab_id, 'text': 'Goner', 'exact': True, 'limit': 5}, benchmark='uv.page.find.goner')
        uv_goner_ref = assert_completed_ok(await uv_wait(cid, 'uv.page.find.goner'))['item']['ref']
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_goner_ref, 'trusted': False})
        assert_completed_ok(await uv_wait(cid, 'uv.goner.click'))
        cid = await uv_push('page.click', {'tabId': uv_tab_id, 'ref': uv_gone_ref, 'trusted': True, 'expect': {'selectorGone': '#uv-late-result'}}, benchmark='uv.page.click.not-ready')
        uv_nr = await asyncio.to_thread(STATE.wait, cid)
        assert uv_nr.get('ok') is False and uv_nr.get('error', {}).get('code') == 'TARGET_NOT_READY', uv_nr
        assert uv_nr['error']['reason'] == 'not-found', uv_nr
        assert uv_nr['error']['waitedMs'] >= 3000, uv_nr

        cid = STATE.push('tabs.close', {'tabId': us_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # R2 tests-first acceptance. Current R1 runtime is expected to fail the
        # unique same-document recovery assertion until bounded revalidation is
        # implemented. The negative cases must already remain fail-closed.

        # Unique same-document replacement: old ref should recover exactly one
        # equivalent current target and click that replacement.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r2?case=unique',
            'active': False,
            'wait': True
        }, benchmark='r2.tabs.open.unique')
        r2_unique_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': r2_unique_tab, 'selector': '#r2-unique'})
        r2_unique_before = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.query', {'tabId': r2_unique_tab, 'selector': '#rerender-unique'})
        r2_unique_trigger = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r2_unique_tab, 'ref': r2_unique_trigger['ref'], 'trusted': False})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.click', {'tabId': r2_unique_tab, 'ref': r2_unique_before['ref'], 'trusted': False}, benchmark='r2.unique.revalidate')
        r2_unique_click = await asyncio.to_thread(STATE.wait, cid)
        cid = STATE.push('page.read', {'tabId': r2_unique_tab, 'offset': 0, 'limit': 1200, 'includeElements': False})
        r2_unique_after = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        cid = STATE.push('tabs.close', {'tabId': r2_unique_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # Ambiguous replacement: two equally plausible current targets must never
        # be selected, even when callers supply observational logicalId/coordinates.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r2?case=ambiguous',
            'active': False,
            'wait': True
        }, benchmark='r2.tabs.open.ambiguous')
        r2_ambiguous_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.read', {'tabId': r2_ambiguous_tab, 'offset': 0, 'limit': 1200, 'maxElements': 40})
        r2_ambiguous_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        r2_ambiguous_before = next(item for item in r2_ambiguous_page['elements'] if item['label'] == 'R2 ambiguous target')
        cid = STATE.push('page.query', {'tabId': r2_ambiguous_tab, 'selector': '#make-ambiguous'})
        r2_ambiguous_trigger = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r2_ambiguous_tab, 'ref': r2_ambiguous_trigger['ref'], 'trusted': False})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.click', {
            'tabId': r2_ambiguous_tab,
            'ref': r2_ambiguous_before['ref'],
            'trusted': False,
            'logicalId': r2_ambiguous_before['logicalId'],
            'x': r2_ambiguous_before['rect']['centerX'],
            'y': r2_ambiguous_before['rect']['centerY']
        }, benchmark='r2.ambiguous.fail-closed')
        r2_ambiguous_click = await asyncio.to_thread(STATE.wait, cid)
        cid = STATE.push('page.read', {'tabId': r2_ambiguous_tab, 'offset': 0, 'limit': 1200, 'includeElements': False})
        r2_ambiguous_after = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        cid = STATE.push('tabs.close', {'tabId': r2_ambiguous_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # Route discontinuity: a same-tab SPA route change invalidates the old
        # action authority even if an element with the same id is recreated.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r2?case=route',
            'active': False,
            'wait': True
        }, benchmark='r2.tabs.open.route')
        r2_route_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': r2_route_tab, 'selector': '#r2-route'})
        r2_route_before = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.query', {'tabId': r2_route_tab, 'selector': '#route-reset'})
        r2_route_trigger = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r2_route_tab, 'ref': r2_route_trigger['ref'], 'trusted': False})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': r2_route_tab, 'selector': '#r2-route'})
        r2_route_fresh = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        assert r2_route_fresh['ref'] != r2_route_before['ref'], (r2_route_before, r2_route_fresh)
        cid = STATE.push('page.click', {'tabId': r2_route_tab, 'ref': r2_route_before['ref'], 'trusted': False}, benchmark='r2.route.fail-closed')
        r2_route_click = await asyncio.to_thread(STATE.wait, cid)
        cid = STATE.push('tabs.close', {'tabId': r2_route_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # Sensitivity change: stable id alone cannot recover a target that has
        # become credential/security-code shaped.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r2?case=sensitive',
            'active': False,
            'wait': True
        }, benchmark='r2.tabs.open.sensitive')
        r2_sensitive_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': r2_sensitive_tab, 'selector': '#r2-sensitive'})
        r2_sensitive_before = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.query', {'tabId': r2_sensitive_tab, 'selector': '#make-sensitive'})
        r2_sensitive_trigger = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r2_sensitive_tab, 'ref': r2_sensitive_trigger['ref'], 'trusted': False})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.click', {'tabId': r2_sensitive_tab, 'ref': r2_sensitive_before['ref'], 'trusted': False}, benchmark='r2.sensitive.fail-closed')
        r2_sensitive_click = await asyncio.to_thread(STATE.wait, cid)
        cid = STATE.push('page.read', {'tabId': r2_sensitive_tab, 'offset': 0, 'limit': 1200, 'includeElements': False})
        r2_sensitive_after = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        cid = STATE.push('tabs.close', {'tabId': r2_sensitive_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # Disappearing target: zero current equivalents must remain stale.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r2?case=disappear',
            'active': False,
            'wait': True
        }, benchmark='r2.tabs.open.disappear')
        r2_disappear_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': r2_disappear_tab, 'selector': '#r2-disappear'})
        r2_disappear_before = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.query', {'tabId': r2_disappear_tab, 'selector': '#remove-target'})
        r2_disappear_trigger = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r2_disappear_tab, 'ref': r2_disappear_trigger['ref'], 'trusted': False})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.click', {'tabId': r2_disappear_tab, 'ref': r2_disappear_before['ref'], 'trusted': False}, benchmark='r2.disappear.fail-closed')
        r2_disappear_click = await asyncio.to_thread(STATE.wait, cid)
        cid = STATE.push('tabs.close', {'tabId': r2_disappear_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        r2_acceptance = {
            'uniqueRecovered': r2_unique_click['ok'] is True and 'unique-clicked:1' in r2_unique_after['text'],
            'ambiguousRejected': r2_ambiguous_click['ok'] is False and 'ambiguous-clicked:0' in r2_ambiguous_after['text'],
            'routeRejected': r2_route_click['ok'] is False,
            'sensitiveRejected': r2_sensitive_click['ok'] is False and 'sensitive-clicked:0' in r2_sensitive_after['text'],
            'disappearingRejected': r2_disappear_click['ok'] is False
        }
        assert all(r2_acceptance.values()), r2_acceptance

        # R3 tests-first acceptance: page.click must return fresh bounded
        # post-action evidence directly, without a mandatory model-mediated
        # page.read. Current R2 runtime is expected to fail because page.click
        # still returns only action acknowledgement.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r3',
            'active': False,
            'wait': True
        }, benchmark='r3.tabs.open')
        r3_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.query', {'tabId': r3_tab_id, 'selector': '#r3-change'})
        r3_change_target = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {
            'tabId': r3_tab_id,
            'ref': r3_change_target['ref'],
            'trusted': False
        }, benchmark='r3.synthetic.post-action')
        r3_synthetic_click = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('page.query', {'tabId': r3_tab_id, 'selector': '#r3-remove'})
        r3_remove_target = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {
            'tabId': r3_tab_id,
            'ref': r3_remove_target['ref'],
            'trusted': True,
            'executionMode': 'background'
        }, benchmark='r3.trusted.post-action')
        r3_trusted_click = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        def assert_r3_post_action(result, expected_ref, expected_present):
            evidence = result['postAction']
            assert evidence['schemaVersion'] == 1, evidence
            assert isinstance(evidence['documentId'], str) and evidence['documentId'], evidence
            assert evidence['beforeMutationVersion'] >= 0, evidence
            assert evidence['mutationVersion'] >= evidence['beforeMutationVersion'], evidence
            assert evidence['settled'] is True, evidence
            assert evidence['completionClaim'] is False, evidence
            semantic = evidence['semantic']
            assert semantic['schemaVersion'] == 1, semantic
            assert semantic['resultingRevision'] >= semantic['sourceRevision'], semantic
            assert semantic['classification'] in {
                'NO_RELEVANT_CHANGE', 'UPDATE', 'INSERT', 'REMOVE', 'MOVE', 'MIXED', 'RESET'
            }, semantic
            assert len(semantic.get('changeTypes', [])) <= 8, semantic
            assert len(semantic.get('changedEntityIds', [])) <= 20, semantic
            target = evidence['target']
            assert target['ref'] == expected_ref, target
            assert target['present'] is expected_present, target
            encoded = json.dumps(evidence).lower()
            assert 'goalcomplete' not in encoded, evidence
            assert '"complete":true' not in encoded, evidence
            assert len(json.dumps(evidence).encode()) <= 8192, evidence

        assert_r3_post_action(r3_synthetic_click, r3_change_target['ref'], True)
        assert_r3_post_action(r3_trusted_click, r3_remove_target['ref'], False)

        # No page.read occurs between either click and these assertions. The
        # direct click result itself is the bounded verification evidence.
        r3_acceptance = {
            'syntheticPostAction': 'postAction' in r3_synthetic_click,
            'trustedPostAction': 'postAction' in r3_trusted_click,
            'changedTargetStillPresent': r3_synthetic_click['postAction']['target']['present'] is True,
            'removedTargetAbsent': r3_trusted_click['postAction']['target']['present'] is False,
            'noCompletionClaim': (
                r3_synthetic_click['postAction']['completionClaim'] is False
                and r3_trusted_click['postAction']['completionClaim'] is False
            )
        }

        cid = STATE.push('tabs.close', {'tabId': r3_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # --- Pre-8E R4: compact model-facing observation (tests-first) ---
        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/pre8e-r4', 'active': False, 'wait': True})
        r4_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']

        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 600, 'maxElements': 120}, benchmark='r4.page.read.legacy')
        r4_legacy_result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        r4_legacy = r4_legacy_result['page']
        assert 'semanticState' in r4_legacy, 'legacy default read must stay element-rich (compat)'
        assert 'semanticViews' in r4_legacy
        assert 'semanticDelta' in r4_legacy
        r4_legacy_size = len(json.dumps(r4_legacy_result))

        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 600, 'maxElements': 120, 'view': 'compact'}, benchmark='r4.page.read.compact')
        r4_compact_result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        r4_compact = r4_compact_result['page']
        assert r4_compact.get('compactView') is True, 'compact read must be marked compactView'
        assert 'semanticState' not in r4_compact, 'compact read must not project internal canonical state'
        assert 'semanticViews' not in r4_compact, 'compact read must not project semantic views'
        assert 'semanticDelta' in r4_compact, 'compact read must retain bounded change evidence'
        r4_compact_size = len(json.dumps(r4_compact_result))
        assert r4_compact_size <= 0.30 * r4_legacy_size, (
            'compact read must reduce model-facing payload by >=70% '
            f'(legacy={r4_legacy_size}, compact={r4_compact_size})'
        )

        def r4_noise_free(page):
            banned = ('hidden-dialog', 'offscreen-link', 'recommendation-link')
            return all(
                not any(token in str(item.get('name', '')) or token in str(item.get('text', '')) for token in banned)
                for item in page['elements']
            )

        assert r4_noise_free(r4_compact), 'hidden/offscreen/below-viewport noise must not dominate the compact view'
        r4_skip = next((item for item in r4_compact['elements'] if item.get('text') == 'Skip ad'), None)
        assert r4_skip is not None, 'compact view must retain the on-screen actionable target'
        assert r4_skip['actionable'] is True and r4_skip['inViewport'] is True
        r4_input = next((item for item in r4_compact['elements'] if item.get('tag') == 'input'), None)
        assert r4_input is not None and r4_input.get('placeholder') == 'Search query', 'input placeholder must survive the compact projection'

        cid = STATE.push('page.click', {'tabId': r4_tab_id, 'ref': r4_skip['ref']})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 600, 'maxElements': 120, 'view': 'compact'})
        r4_after_click = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        r4_toggle = next(item for item in r4_after_click['elements'] if item.get('text', '').startswith('R4 toggle'))
        cid = STATE.push('page.click', {'tabId': r4_tab_id, 'ref': r4_toggle['ref']})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 600, 'maxElements': 120, 'view': 'compact'})
        r4_after_toggle = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        r4_changes = r4_after_toggle['semanticDelta']['changes']
        assert r4_changes, 'compact read must expose the fresh change after an action'
        assert any(change.get('logicalId') == r4_toggle.get('logicalId') or change.get('logicalId') == r4_toggle.get('stableKey') for change in r4_changes), (
            'the changed target must be identifiable in the compact change evidence'
        )
        r4_toggle_fresh = next((item for item in r4_after_toggle['elements'] if item.get('text') == 'R4 toggle target pressed'), None)
        assert r4_toggle_fresh is not None, 'the changed target must survive the compact projection with fresh state'

        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 300, 'maxElements': 40, 'view': 'full'})
        r4_full_escape = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert 'semanticState' in r4_full_escape and 'semanticViews' in r4_full_escape, 'view=full must keep the trusted full observation escape hatch'

        cid = STATE.push('page.query', {'tabId': r4_tab_id, 'selector': '#r4-route'})
        r4_route_target = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': r4_tab_id, 'ref': r4_route_target['ref']})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {'tabId': r4_tab_id, 'offset': 0, 'limit': 600, 'maxElements': 120, 'view': 'compact'})
        r4_after_route = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert r4_after_route['semanticDelta']['classification'] == 'RESET'
        assert r4_after_route['semanticDelta']['resetReason'] == 'SPA_ROUTE'
        assert r4_after_route['semanticDelta']['completeSnapshotRequired'] is True, 'compact must surface trusted reset recovery, not hide it'

        r4_acceptance = {
            'compactViewProjected': r4_compact.get('compactView') is True,
            'payloadReductionPercent': round(100 * (1 - r4_compact_size / r4_legacy_size), 2),
            'onScreenTargetRetained': r4_skip is not None,
            'noiseExcluded': r4_noise_free(r4_compact),
            'changeEvidenceRetained': bool(r4_changes),
            'resetRecoverySurfaced': r4_after_route['semanticDelta']['classification'] == 'RESET'
        }
        print(json.dumps({'r4CompactAcceptance': r4_acceptance}, indent=2))

        cid = STATE.push('tabs.close', {'tabId': r4_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        # --- U-V1 quick-win: self-verifying actions, absent wait, burst timeout partials ---
        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/pre8e-r3', 'active': False, 'wait': True})
        uv1_r3_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': uv1_r3_tab, 'selector': '#r3-change'})
        uv1_change = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': uv1_r3_tab, 'ref': uv1_change['ref'], 'expect': {'textGone': 'change-state:before'}}, benchmark='uv1.expect.pass')
        uv1_pass = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert uv1_pass['postAction'].get('verified') is True
        assert any(item['key'] == 'textGone' and item['pass'] for item in uv1_pass['postAction']['expectations'])
        cid = STATE.push('page.click', {'tabId': uv1_r3_tab, 'ref': uv1_change['ref'], 'expect': {'urlContains': 'never-matches-xyz'}}, benchmark='uv1.expect.fail')
        uv1_fail = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert uv1_fail['postAction'].get('verified') is False
        assert any(item['key'] == 'urlContains' and not item['pass'] for item in uv1_fail['postAction']['expectations'])
        cid = STATE.push('page.query', {'tabId': uv1_r3_tab, 'selector': '#r3-remove'})
        uv1_remove = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': uv1_r3_tab, 'ref': uv1_remove['ref']})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.wait_for', {'tabId': uv1_r3_tab, 'selector': '#r3-remove', 'absent': True, 'timeoutMs': 2000}, benchmark='uv1.absent')
        uv1_absent = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert uv1_absent.get('absent') is True

        # Burst partial results: a failing wait step preserves the successful
        # prefix instead of discarding completed steps (read prefix keeps the
        # scenario independent of window focus).
        uv1_burst_steps = [
            {'action': 'read', 'limit': 200},
            {'action': 'wait', 'selector': '#r3-never-appears', 'timeoutMs': 3000},
            {'action': 'read', 'limit': 200}
        ]
        cid = STATE.push('browser.burst', {'tabId': uv1_r3_tab, 'steps': uv1_burst_steps}, benchmark='uv1.burst.partial')
        uv1_burst = await asyncio.to_thread(STATE.wait, cid)
        uv1_partial = (uv1_burst.get('result') or {})
        assert uv1_partial.get('ok') is False, f"uv1_burst={json.dumps(uv1_burst)[:600]}"
        assert uv1_partial.get('completedSteps') == 1, f"uv1_burst={json.dumps(uv1_burst)[:600]}"
        assert uv1_partial.get('failedAt') == 1, f"uv1_burst={json.dumps(uv1_burst)[:600]}"
        assert uv1_partial.get('failedAction') == 'wait', f"uv1_burst={json.dumps(uv1_burst)[:600]}"
        assert uv1_partial['results'][0]['action'] == 'read', f"uv1_burst={json.dumps(uv1_burst)[:600]}"
        assert uv1_partial['results'][0]['result']['page']['documentId'], f"uv1_burst={json.dumps(uv1_burst)[:600]}"

        cid = STATE.push('tabs.close', {'tabId': uv1_r3_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/pre8e-r4', 'active': False, 'wait': True})
        uv1_r4_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.query', {'tabId': uv1_r4_tab, 'selector': '#r4-anchor'})
        uv1_anchor = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': uv1_r4_tab, 'ref': uv1_anchor['ref'], 'expect': {'urlContains': 'r4-anchor-target'}}, benchmark='uv1.anchor.pass')
        uv1_anchor_pass = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert uv1_anchor_pass['postAction'].get('verified') is True
        cid = STATE.push('page.click', {'tabId': uv1_r4_tab, 'ref': uv1_anchor['ref'], 'expect': {'urlContains': 'nowhere-xyz'}}, benchmark='uv1.anchor.fallback')
        uv1_anchor_fail = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert uv1_anchor_fail['postAction'].get('verified') is False
        assert uv1_anchor_fail['postAction'].get('fallbackHref', '').endswith('#r4-anchor-target')
        cid = STATE.push('tabs.close', {'tabId': uv1_r4_tab})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        uv1_acceptance = {
            'expectPass': uv1_pass['postAction']['verified'] is True,
            'expectFailKnown': uv1_fail['postAction']['verified'] is False,
            'absentWait': uv1_absent.get('absent') is True,
            'anchorFallbackHref': bool(uv1_anchor_fail['postAction'].get('fallbackHref')),
            'burstPartialPrefix': (uv1_burst.get('result') or {}).get('results', [{}])[0].get('action') == 'read'
        }
        print(json.dumps({'uv1Acceptance': uv1_acceptance}, indent=2))

        # --- Pre-8E R5: ready-media local seek benchmark ---
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/pre8e-r5',
            'active': False,
            'wait': True
        }, benchmark='r5.tabs.open.ready-media')
        r5_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        r5_focus_audit = []
        r5_focus_baseline = await browser_focus_state(worker)
        assert r5_focus_baseline['activeTabId'] != r5_tab_id, r5_focus_baseline

        r5_media = None
        r5_ready_deadline = time.time() + 5.0
        while time.time() < r5_ready_deadline:
            cid = STATE.push('media.state', {'tabId': r5_tab_id, 'index': 0})
            r5_media = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['media']
            if (
                r5_media.get('present') is True
                and isinstance(r5_media.get('duration'), (int, float))
                and r5_media['duration'] >= 1.5
                and r5_media.get('readyState', 0) >= 2
            ):
                break
            await asyncio.sleep(0.05)
        assert r5_media is not None, 'R5 media state was never observed'
        assert r5_media['present'] is True, r5_media
        assert r5_media['duration'] >= 1.5, r5_media
        assert r5_media['readyState'] >= 2, r5_media

        # Keep the controlled media paused so each measured seek is independent
        # of playback progress. The production workflow preserves prior playback
        # state around this same media.seek primitive.
        cid = STATE.push('media.pause', {'tabId': r5_tab_id, 'index': 0})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        r5_metric_start = len(STATE.metrics)
        r5_seek_targets = [0.10, 0.25, 0.40, 0.55, 0.70, 0.85, 1.00, 1.20, 1.40]
        r5_seek_results = []
        for seconds in r5_seek_targets:
            body = await audited_background_command(worker, r5_focus_audit, 'media.seek', {
                'tabId': r5_tab_id,
                'index': 0,
                'seconds': seconds
            })
            media = assert_completed_ok(body)['media']
            assert media['present'] is True, media
            assert abs(media['currentTime'] - seconds) <= 0.05, {
                'targetSeconds': seconds,
                'media': media
            }
            r5_seek_results.append(media['currentTime'])

        r5_seek_metrics = [
            item for item in STATE.metrics[r5_metric_start:]
            if item['method'] == 'media.seek'
        ]
        assert len(r5_seek_metrics) == len(r5_seek_targets), r5_seek_metrics
        r5_seek_latencies = sorted(item['latencyMs'] for item in r5_seek_metrics)
        r5_seek_p50_ms = r5_seek_latencies[len(r5_seek_latencies) // 2]
        assert r5_seek_p50_ms <= 1000, {
            'p50Ms': r5_seek_p50_ms,
            'latenciesMs': r5_seek_latencies
        }
        r5_measured_methods = [item['method'] for item in STATE.metrics[r5_metric_start:]]
        assert 'tabs.navigate' not in r5_measured_methods
        assert 'tabs.reload' not in r5_measured_methods

        r5_acceptance = {
            'readyMedia': r5_media['readyState'] >= 2 and r5_media['duration'] >= 1.5,
            'seekRuns': len(r5_seek_latencies),
            'seekP50Ms': r5_seek_p50_ms,
            'seekLatenciesMs': r5_seek_latencies,
            'seekPositionsVerified': len(r5_seek_results) == len(r5_seek_targets),
            'navigationOrReloadUsed': (
                'tabs.navigate' in r5_measured_methods or 'tabs.reload' in r5_measured_methods
            ),
            'backgroundFocusPreserved': (
                len(r5_focus_audit) == len(r5_seek_targets)
                and all(
                    item['focusPreserved']
                    and item['before']['activeTabId'] != r5_tab_id
                    and item['after']['activeTabId'] != r5_tab_id
                    for item in r5_focus_audit
                )
            )
        }
        assert r5_acceptance['backgroundFocusPreserved'], r5_focus_audit
        print(json.dumps({'r5MediaSeekAcceptance': r5_acceptance}, indent=2))

        cid = STATE.push('tabs.close', {'tabId': r5_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        spa_route = next(item for item in rerendered_page['elements'] if item['label'] == 'Change SPA route')
        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': spa_route['ref']})
        spa_click = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert spa_click['postAction']['continuity'] == 'RESET_OR_ROUTE_CHANGE'
        assert spa_click['postAction']['semantic']['classification'] == 'RESET'
        assert spa_click['postAction']['semantic']['completeSnapshotRequired'] is True
        assert spa_click['postAction']['semantic']['resetReason'] == 'SPA_ROUTE'
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        spa_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert spa_page['semanticState']['documentGeneration'] == 2
        assert spa_page['semanticState']['resetReason'] == 'SPA_ROUTE'
        assert spa_page['semanticDelta']['classification'] == 'RESET'
        assert spa_page['semanticDelta']['completeSnapshotRequired'] is True
        cid = STATE.push('tabs.navigate', {'tabId': tab_id, 'url': f'http://{HOST}:{port}/page', 'wait': True})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        navigation_snapshot = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert navigation_snapshot['semanticDelta']['classification'] == 'RESET'
        toggle_logical_id = next(item['logicalId'] for item in navigation_snapshot['elements'] if item['label'] == 'Toggle')

        cid = STATE.push('page.capture', {'tabId': tab_id})
        blocked_capture = await asyncio.to_thread(STATE.wait, cid)
        assert blocked_capture['ok'] is False
        assert blocked_capture['error']['code'] == 'CAPTURE_BLOCKED'

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/visual', 'active': False, 'wait': True})
        visual_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        focus_before_capture = await browser_focus_state(worker)
        cid = STATE.push('page.capture', {'tabId': visual_tab_id, 'quality': 60, 'maxWidth': 800, 'maxHeight': 600}, benchmark='page.capture.viewport')
        capture = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        focus_after_capture = await browser_focus_state(worker)
        assert focus_before_capture == focus_after_capture
        screenshot = capture['screenshot']
        assert screenshot['mimeType'] == 'image/jpeg'
        assert screenshot['data'].startswith('/9j/')
        assert len(screenshot['sha256']) == 64
        assert screenshot['encodedBytes'] <= 220 * 1024
        assert screenshot['width'] <= 800 and screenshot['height'] <= 600
        assert screenshot['unchanged'] is False and screenshot['cached'] is False

        cid = STATE.push('page.capture', {'tabId': visual_tab_id, 'quality': 60, 'maxWidth': 800, 'maxHeight': 600, 'previousHash': screenshot['sha256']})
        unchanged = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['screenshot']
        assert unchanged['unchanged'] is True and unchanged['cached'] is True
        assert 'data' not in unchanged

        await worker.evaluate('(tabId) => chrome.storage.local.set({privateTabIds:[tabId]})', visual_tab_id)
        cid = STATE.push('page.capture', {'tabId': visual_tab_id})
        private_capture = await asyncio.to_thread(STATE.wait, cid)
        assert private_capture['ok'] is False
        assert private_capture['error']['code'] == 'CAPTURE_BLOCKED'
        assert private_capture['error']['details']['reason'] == 'USER_PRIVATE'
        await worker.evaluate('chrome.storage.local.set({privateTabIds:[]})')

        cid = STATE.push('page.capture', {'tabId': visual_tab_id, 'crop': {'x': 0, 'y': 0, 'width': 320, 'height': 240}})
        cropped = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['screenshot']
        assert cropped['sourceWidth'] == 320 and cropped['sourceHeight'] == 240
        cid = STATE.push('tabs.close', {'tabId': visual_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/blank', 'active': False, 'wait': True})
        blank_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.capture', {'tabId': blank_tab_id})
        blank_capture = await asyncio.to_thread(STATE.wait, cid)
        assert blank_capture['ok'] is False
        assert blank_capture['error']['code'] == 'BLANK_SCREENSHOT', blank_capture
        cid = STATE.push('tabs.close', {'tabId': blank_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{port}/iframe', 'active': False, 'wait': True})
        iframe_tab_id = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']['id']
        cid = STATE.push('page.capture', {'tabId': iframe_tab_id})
        iframe_capture = await asyncio.to_thread(STATE.wait, cid)
        assert iframe_capture['ok'] is False
        assert iframe_capture['error']['code'] == 'CAPTURE_BLOCKED', iframe_capture
        assert iframe_capture['error']['details']['reason'] == 'SENSITIVE_FRAME', iframe_capture
        cid = STATE.push('tabs.close', {'tabId': iframe_tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))

        semantic_payload_bytes = len(json.dumps(page).encode())
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 12000, 'includeElements': False}, benchmark='page.read.text-only.chunk-1')
        text_only = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        text_only_payload_bytes = len(json.dumps(text_only).encode())
        assert text_only['textChars'] == 12000
        assert text_only['hasMore'] is True
        assert 'elements' not in text_only
        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': text_only['nextOffset'], 'limit': 12000, 'includeElements': False}, benchmark='page.read.text-only.chunk-2')
        final_chunk = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        assert final_chunk['hasMore'] is False
        assert final_chunk['nextOffset'] is None
        assert 'elements' not in final_chunk

        cid = STATE.push('tabs.activate', {'tabId': tab_id, 'focusWindow': False})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['reused'] is True

        cid = STATE.push('tabs.navigate', {'tabId': tab_id, 'url': f'http://{HOST}:{port}/page', 'wait': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['reused'] is True

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle', 'index': 0, 'limit': 5}, benchmark='query+click.query')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        toggle = result['item']
        assert toggle['ariaPressed'] == 'false'
        toggle_ref = toggle['ref']

        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': toggle_ref, 'trusted': True}, benchmark='query+click.click')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['method'] == 'debugger'

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 50})
        toggle_updated_page = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['page']
        semantic_updates = [change for change in toggle_updated_page['semanticDelta']['changes'] if change['type'] == 'UPDATE']
        assert len(semantic_updates) == 1, toggle_updated_page['semanticDelta']
        assert semantic_updates[0]['logicalId'] == toggle_logical_id
        semantic_delta_bytes = len(json.dumps(toggle_updated_page['semanticDelta']).encode())
        assert semantic_delta_bytes / semantic_payload_bytes <= 0.5

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle', 'index': 0, 'limit': 5})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['item']['ariaPressed'] == 'true'
        toggle = result['item']

        # Windows blocks background processes from stealing OS focus, so a
        # headless-adjacent CI run can start with the browser window
        # unfocused; foreground pointer actions require focus (FOREGROUND_REQUIRED).
        # Prime it through the extension's own activation path.
        cid = STATE.push('tabs.activate', {'tabId': tab_id})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'click', 'x': toggle['rect']['centerX'], 'y': toggle['rect']['centerY'], 'executionMode': 'foreground'})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['action'] == 'click'
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle'})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['ariaPressed'] == 'false'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#surface'})
        surface = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        sx, sy = surface['rect']['centerX'], surface['rect']['centerY']
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'drag', 'x': sx - 30, 'y': sy, 'endX': sx + 30, 'endY': sy, 'executionMode': 'foreground'})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#surface'})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['text'] == 'dragged'
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'wheel', 'x': sx, 'y': sy, 'deltaY': 120, 'executionMode': 'foreground'})
        wheel = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert wheel['action'] == 'wheel'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        safe_ref = result['item']['ref']
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': safe_ref, 'value': 'hello opera agent'}, benchmark='fill+enter.fill')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.key', {'tabId': tab_id, 'key': 'Enter', 'trusted': False}, benchmark='fill+enter.enter')
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['item']['value'] == 'hello opera agent'

        burst_steps = [
            {'action': 'fill', 'ref': safe_ref, 'value': 'fast burst'},
            {'action': 'key', 'key': 'Tab'},
            {'action': 'pointer', 'pointerAction': 'click', 'x': toggle['rect']['centerX'], 'y': toggle['rect']['centerY']},
            {'action': 'wait', 'selector': '#toggle', 'timeoutMs': 1000},
            {'action': 'read', 'offset': 0, 'limit': 300, 'includeElements': False}
        ]
        cid = STATE.push('browser.burst', {'tabId': tab_id, 'steps': burst_steps, 'executionMode': 'foreground'}, benchmark='browser.burst.fill+key+pointer+wait+read')
        burst = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert burst['ok'] is True, burst
        assert burst['completedSteps'] == len(burst_steps)
        assert [step['action'] for step in burst['results']] == ['fill', 'key', 'pointer', 'wait', 'read']
        assert burst['results'][1]['result']['method'] == 'debugger'
        assert burst['results'][2]['result']['method'] == 'debugger'
        assert 'elements' not in burst['results'][4]['result']['page']

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['value'] == 'fast burst'

        for index in range(20):
            cid = STATE.push('browser.burst', {
                'tabId': tab_id,
                'steps': [
                    {'action': 'find', 'text': 'Toggle', 'limit': 3},
                    {'action': 'read', 'offset': 0, 'limit': 300, 'includeElements': False}
                ]
            }, benchmark=f'browser.burst.stability.{index + 1}')
            stable_burst = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
            assert stable_burst['ok'] is True, stable_burst
            assert stable_burst['completedSteps'] == 2

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#secret'})
        secret = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'click', 'x': secret['rect']['centerX'], 'y': secret['rect']['centerY'], 'executionMode': 'foreground'})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'Pointer blocked on sensitive target' in failed['error']['message']
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': secret['ref'], 'value': 'should-not-enter'})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False, failed
        assert 'Sensitive field blocked' in failed['error']['message'], failed
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': secret['ref'], 'value': 'should-not-enter', 'trusted': True})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False, failed
        assert 'Sensitive field blocked' in failed['error']['message'], failed

        cid = STATE.push('browser.burst', {
            'tabId': tab_id,
            'executionMode': 'foreground',
            'steps': [
                {'action': 'pointer', 'pointerAction': 'click', 'x': secret['rect']['centerX'], 'y': secret['rect']['centerY']},
                {'action': 'fill', 'ref': safe_ref, 'value': 'must-not-run'}
            ]
        })
        stopped = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert stopped['ok'] is False
        assert stopped['completedSteps'] == 0
        assert stopped['failedAt'] == 0
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['value'] == 'fast burst'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#file'})
        file_el = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': file_el['ref'], 'trusted': False})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'File upload' in failed['error']['message']
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': file_el['ref'], 'value': 'blocked', 'trusted': True})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'file' in failed['error']['message'].lower()

        cid = STATE.push('page.collect_links', {'tabId': tab_id, 'sameOrigin': True, 'limit': 20})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['count'] == 1
        assert result['links'][0]['url'].startswith(f'http://{HOST}:{port}/page')

        # Checkpoint 2A: keep a user tab active while every background-capable
        # primitive targets the original, now-inactive automation tab.
        cid = STATE.push('tabs.open', {
            'url': f'http://{HOST}:{port}/page?user-active=1',
            'active': True,
            'wait': True
        })
        user_tab = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['tab']
        focus_audit = []
        baseline = await browser_focus_state(worker)
        assert baseline['activeTabId'] == user_tab['id'], baseline
        assert baseline['activeTabId'] != tab_id, baseline
        assert baseline['focusedWindowId'] is not None, baseline

        body = await audited_background_command(worker, focus_audit, 'tabs.list', {
            'currentWindow': True
        })
        assert len(assert_completed_ok(body)['tabs']) >= 2
        body = await audited_background_command(worker, focus_audit, 'tabs.get', {
            'tabId': tab_id
        })
        assert assert_completed_ok(body)['tab']['id'] == tab_id
        body = await audited_background_command(worker, focus_audit, 'tabs.find', {
            'urlContains': f'{HOST}:{port}/page', 'limit': 20
        })
        assert assert_completed_ok(body)['count'] >= 2
        body = await audited_background_command(worker, focus_audit, 'tabs.open', {
            'url': f'http://{HOST}:{port}/page?background-aux=1',
            'active': False,
            'wait': True
        })
        background_aux_tab_id = assert_completed_ok(body)['tab']['id']
        body = await audited_background_command(worker, focus_audit, 'tabs.close', {
            'tabId': background_aux_tab_id
        })
        assert assert_completed_ok(body)['tabId'] == background_aux_tab_id

        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'includeElements': False
        })
        assert assert_completed_ok(body)['page']['textChars'] == 300

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#safe', 'includeValue': True
        })
        background_safe_ref = assert_completed_ok(body)['item']['ref']
        body = await audited_background_command(worker, focus_audit, 'page.fill', {
            'tabId': tab_id, 'ref': background_safe_ref, 'value': 'background fill'
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.fill', {
            'tabId': tab_id, 'ref': background_safe_ref, 'value': 'background CDP fill', 'trusted': True
        })
        background_fill = assert_completed_ok(body)
        assert background_fill['method'] == 'debugger'
        assert background_fill['focusEmulated'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#safe', 'includeValue': True
        })
        assert assert_completed_ok(body)['item']['value'] == 'background CDP fill'

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#editor', 'includeValue': True
        })
        background_editor_ref = assert_completed_ok(body)['item']['ref']
        body = await audited_background_command(worker, focus_audit, 'page.fill', {
            'tabId': tab_id, 'ref': background_editor_ref, 'value': 'edited through Input.insertText', 'trusted': True
        })
        background_editor_fill = assert_completed_ok(body)
        assert background_editor_fill['method'] == 'debugger'
        assert background_editor_fill['focusEmulated'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#editor', 'includeValue': True
        })
        assert assert_completed_ok(body)['item']['value'] == 'edited through Input.insertText'

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#secret'
        })
        background_secret = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.fill', {
            'tabId': tab_id, 'ref': background_secret['ref'], 'value': 'blocked', 'trusted': True
        })
        assert body['ok'] is False, body
        assert 'Sensitive field blocked' in body['error']['message']
        body = await audited_background_command(worker, focus_audit, 'page.scroll', {
            'tabId': tab_id, 'ref': background_secret['ref']
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#secret'
        })
        background_secret = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.pointer', {
            'tabId': tab_id,
            'action': 'click',
            'x': background_secret['rect']['centerX'],
            'y': background_secret['rect']['centerY']
        })
        assert body['ok'] is False, body
        assert 'Pointer blocked on sensitive target' in body['error']['message']

        body = await audited_background_command(worker, focus_audit, 'page.focus', {
            'tabId': tab_id, 'ref': background_safe_ref
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.key', {
            'tabId': tab_id, 'key': 'End', 'trusted': False
        })
        assert assert_completed_ok(body)['key'] == 'End'
        body = await audited_background_command(worker, focus_audit, 'page.key', {
            'tabId': tab_id, 'key': 'Tab', 'trusted': True
        })
        background_key = assert_completed_ok(body)
        assert background_key['method'] == 'debugger'
        assert background_key['focusEmulated'] is True

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#toggle'
        })
        background_toggle_ref = assert_completed_ok(body)['item']['ref']
        body = await audited_background_command(worker, focus_audit, 'page.click', {
            'tabId': tab_id, 'ref': background_toggle_ref, 'trusted': False
        })
        assert assert_completed_ok(body)['method'] == 'synthetic'
        body = await audited_background_command(worker, focus_audit, 'page.click', {
            'tabId': tab_id, 'ref': background_toggle_ref, 'trusted': True
        })
        background_click = assert_completed_ok(body)
        assert background_click['method'] == 'debugger'
        assert background_click['focusEmulated'] is True

        body = await audited_background_command(worker, focus_audit, 'page.find', {
            'tabId': tab_id, 'text': 'Toggle', 'limit': 3
        })
        assert assert_completed_ok(body)['count'] >= 1
        body = await audited_background_command(worker, focus_audit, 'page.collect_links', {
            'tabId': tab_id, 'sameOrigin': True, 'limit': 20
        })
        assert assert_completed_ok(body)['count'] == 1
        body = await audited_background_command(worker, focus_audit, 'page.wait_for', {
            'tabId': tab_id, 'selector': '#toggle', 'timeoutMs': 1000
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.scroll', {
            'tabId': tab_id, 'y': 120
        })
        assert_completed_ok(body)

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#canvas'
        })
        background_canvas = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.scroll', {
            'tabId': tab_id, 'ref': background_canvas['ref']
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#canvas'
        })
        background_canvas = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.pointer', {
            'tabId': tab_id,
            'action': 'click',
            'x': background_canvas['rect']['centerX'],
            'y': background_canvas['rect']['centerY']
        })
        background_pointer = assert_completed_ok(body)
        assert background_pointer['executionMode'] == 'background'
        assert background_pointer['visiblePointer'] is False
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#canvas-status'
        })
        assert assert_completed_ok(body)['item']['text'] == 'canvas-clicked-1'

        background_input_burst_steps = [
            {'action': 'fill', 'ref': background_editor_ref, 'value': 'background burst editor'},
            {'action': 'key', 'key': 'End'},
            {
                'action': 'pointer',
                'pointerAction': 'click',
                'x': background_canvas['rect']['centerX'],
                'y': background_canvas['rect']['centerY']
            },
            {'action': 'read', 'offset': 0, 'limit': 300, 'includeElements': False}
        ]
        body = await audited_background_command(worker, focus_audit, 'browser.burst', {
            'tabId': tab_id, 'steps': background_input_burst_steps
        })
        background_input_burst = assert_completed_ok(body)
        assert background_input_burst['ok'] is True, background_input_burst
        assert background_input_burst['executionMode'] == 'background'
        assert background_input_burst['results'][0]['result']['method'] == 'debugger'
        assert background_input_burst['results'][0]['result']['focusEmulated'] is True
        assert background_input_burst['results'][2]['result']['visiblePointer'] is False
        assert background_input_burst['results'][2]['result']['focusEmulated'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#canvas-status'
        })
        assert assert_completed_ok(body)['item']['text'] == 'canvas-clicked-2', body

        # Generic scroll observability identifies the wheel container, waits for
        # lazy DOM changes to settle, and reports whether another pass is needed.
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#scrollbox'
        })
        scrollbox = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.scroll', {
            'tabId': tab_id, 'ref': scrollbox['ref']
        })
        scroll_into_view = assert_completed_ok(body)
        assert scroll_into_view['after']['kind'] == 'document'
        assert scroll_into_view['settled'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#last-result'
        })
        last_result_before = assert_completed_ok(body)['item']
        assert last_result_before['visible'] is True
        assert last_result_before['inViewport'] is False
        assert last_result_before['stableKeySource'] == 'id'
        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 200
        })
        semantic_views_before = assert_completed_ok(body)['page']['semanticViews']
        feed_before = next(view for view in semantic_views_before['regions'] if view['role'] == 'feed')
        assert feed_before['loadedEntityCount'] == 2, feed_before
        assert feed_before['exhaustion']['status'] == 'PARTIAL', feed_before

        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#scrollbox'
        })
        scrollbox = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.pointer', {
            'tabId': tab_id,
            'action': 'wheel',
            'x': scrollbox['rect']['centerX'],
            'y': scrollbox['rect']['centerY'],
            # Trigger loading well before the old boundary so scroll anchoring
            # cannot nondeterministically jump to the newly expanded boundary.
            'deltaY': 350
        })
        lazy_wheel = assert_completed_ok(body)
        assert lazy_wheel['scroll']['before']['kind'] == 'element'
        assert lazy_wheel['scroll']['before']['ref'] == scrollbox['ref']
        assert lazy_wheel['scroll']['moved'] is True, lazy_wheel
        assert lazy_wheel['scroll']['contentChanged'] is True, lazy_wheel
        assert lazy_wheel['scroll']['reachedBoundary'] is False, lazy_wheel
        assert lazy_wheel['scroll']['settled'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#last-result'
        })
        last_result_loaded = assert_completed_ok(body)['item']
        assert last_result_loaded['stableKey'] == last_result_before['stableKey']
        assert last_result_loaded['inViewport'] is False
        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 200
        })
        semantic_views_loaded = assert_completed_ok(body)['page']['semanticViews']
        feed_loaded = next(view for view in semantic_views_loaded['regions'] if view['regionId'] == feed_before['regionId'])
        assert feed_loaded['loadedEntityCount'] == 4, feed_loaded
        assert feed_loaded['viewRevision'] == feed_before['viewRevision'] + 1, feed_loaded

        final_wheel = None
        for _ in range(3):
            body = await audited_background_command(worker, focus_audit, 'page.pointer', {
                'tabId': tab_id,
                'action': 'wheel',
                'x': scrollbox['rect']['centerX'],
                'y': scrollbox['rect']['centerY'],
                'deltaY': 1200
            })
            final_wheel = assert_completed_ok(body)
            if final_wheel['scroll']['after']['reachedBottom']:
                break
        assert final_wheel is not None
        assert final_wheel['scroll']['after']['reachedBottom'] is True
        assert final_wheel['scroll']['reachedBoundary'] is True
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#last-result'
        })
        last_result_after = assert_completed_ok(body)['item']
        assert last_result_after['stableKey'] == last_result_before['stableKey']
        assert last_result_after['inViewport'] is False
        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 200
        })
        boundary_first = assert_completed_ok(body)['page']['semanticViews']
        feed_boundary_first = next(view for view in boundary_first['regions'] if view['regionId'] == feed_before['regionId'])
        assert feed_boundary_first['exhaustion']['status'] == 'PARTIAL', feed_boundary_first
        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 200
        })
        boundary_stable = assert_completed_ok(body)['page']['semanticViews']
        feed_boundary_stable = next(view for view in boundary_stable['regions'] if view['regionId'] == feed_before['regionId'])
        assert feed_boundary_stable['exhaustion']['status'] == 'BOUNDED_COMPLETE', feed_boundary_stable

        # A mutation outside the feed must not invalidate the feed view.
        body = await audited_background_command(worker, focus_audit, 'page.query', {
            'tabId': tab_id, 'selector': '#toggle'
        })
        unrelated_toggle = assert_completed_ok(body)['item']
        body = await audited_background_command(worker, focus_audit, 'page.click', {
            'tabId': tab_id, 'ref': unrelated_toggle['ref'], 'trusted': False
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'page.read', {
            'tabId': tab_id, 'offset': 0, 'limit': 300, 'maxElements': 200
        })
        unrelated_read = assert_completed_ok(body)['page']['semanticViews']
        feed_after_unrelated = next(view for view in unrelated_read['regions'] if view['regionId'] == feed_before['regionId'])
        assert feed_after_unrelated['viewRevision'] == feed_boundary_stable['viewRevision'], feed_after_unrelated
        assert feed_after_unrelated['completion']['status'] == 'BOUNDED_COMPLETE', feed_after_unrelated
        assert feed_after_unrelated['completion']['scope'], feed_after_unrelated
        assert feed_after_unrelated['completion']['evidence'], feed_after_unrelated
        assert feed_after_unrelated['completion']['limits'], feed_after_unrelated
        assert feed_before['regionId'] not in {
            entry['regionId'] for entry in unrelated_read['viewDelta']['invalidatedViews']
        }, unrelated_read['viewDelta']
        assert unrelated_read['provenance']['category'] == 'DIRECT_OBSERVATION'
        assert unrelated_read['provenance']['sensor'] == 'DOM_ACCESSIBILITY'
        assert unrelated_read['provenance']['sourceRevision'] > 0

        # A visible pointer remains an explicit foreground diagnostic. It must
        # refuse an inactive tab rather than activating it as a fallback.
        body = await audited_background_command(worker, focus_audit, 'page.pointer', {
            'tabId': tab_id,
            'action': 'move',
            'x': background_canvas['rect']['centerX'],
            'y': background_canvas['rect']['centerY'],
            'executionMode': 'foreground'
        })
        assert body['ok'] is False, body
        assert body['error']['code'] == 'FOREGROUND_REQUIRED', body
        assert body['error']['details']['targetTabId'] == tab_id, body

        body = await audited_background_command(worker, focus_audit, 'tabs.navigate', {
            'tabId': tab_id,
            'url': f'http://{HOST}:{port}/page?background-target=1',
            'wait': True
        })
        assert_completed_ok(body)
        body = await audited_background_command(worker, focus_audit, 'tabs.reload', {
            'tabId': tab_id, 'wait': True
        })
        assert_completed_ok(body)

        background_burst_steps = [
            {'action': 'find', 'text': 'Toggle', 'limit': 3},
            {'action': 'wait', 'selector': '#toggle', 'timeoutMs': 1000},
            {'action': 'scroll', 'y': 80},
            {'action': 'read', 'offset': 0, 'limit': 300, 'includeElements': False}
        ]
        body = await audited_background_command(worker, focus_audit, 'browser.burst', {
            'tabId': tab_id, 'steps': background_burst_steps
        })
        background_burst = assert_completed_ok(body)
        assert background_burst['ok'] is True, background_burst
        assert background_burst['completedSteps'] == len(background_burst_steps)

        live_google_maps = False
        if os.environ.get('OA_LIVE_SITE_TESTS', '0') == '1':
            body = await audited_background_command(worker, focus_audit, 'tabs.navigate', {
                'tabId': tab_id,
                'url': 'https://www.google.com/maps',
                'wait': True,
                'waitTimeoutMs': 30000
            }, timeout=40, command_timeout=30000)
            assert_completed_ok(body)
            body = await audited_background_command(worker, focus_audit, 'page.read', {
                'tabId': tab_id, 'offset': 0, 'limit': 3000, 'includeElements': True, 'maxElements': 80
            })
            maps_initial_page = assert_completed_ok(body)['page']
            body = await audited_background_command(worker, focus_audit, 'page.wait_for', {
                'tabId': tab_id, 'selector': 'input[role="combobox"][name="q"]', 'timeoutMs': 15000
            }, timeout=20, command_timeout=18000)
            assert body['ok'] is True, {'wait': body, 'page': maps_initial_page}
            assert body['result']['ok'] is True, body
            body = await audited_background_command(worker, focus_audit, 'page.query', {
                'tabId': tab_id, 'selector': 'input[role="combobox"][name="q"]', 'includeValue': True
            })
            maps_search = assert_completed_ok(body)['item']
            body = await audited_background_command(worker, focus_audit, 'page.fill', {
                'tabId': tab_id,
                'ref': maps_search['ref'],
                'value': 'restoran terbaik di sekitar Monas Jakarta',
                'trusted': True
            })
            assert assert_completed_ok(body)['method'] == 'debugger'
            body = await audited_background_command(worker, focus_audit, 'page.query', {
                'tabId': tab_id, 'selector': 'button[aria-label="Telusuri"], button[aria-label="Search"]'
            })
            maps_search_button = assert_completed_ok(body)['item']
            body = await audited_background_command(worker, focus_audit, 'page.pointer', {
                'tabId': tab_id,
                'action': 'click',
                'x': maps_search_button['rect']['centerX'],
                'y': maps_search_button['rect']['centerY']
            })
            maps_pointer = assert_completed_ok(body)
            assert maps_pointer['executionMode'] == 'background'
            assert maps_pointer['visiblePointer'] is False
            assert maps_pointer['focusEmulated'] is True
            body = await audited_background_command(worker, focus_audit, 'page.wait_for', {
                'tabId': tab_id, 'selector': 'div[role="feed"]', 'timeoutMs': 15000
            }, timeout=20, command_timeout=18000)
            assert assert_completed_ok(body)['ok'] is True, body
            body = await audited_background_command(worker, focus_audit, 'page.read', {
                'tabId': tab_id, 'offset': 0, 'limit': 3000, 'includeElements': False
            })
            maps_page = assert_completed_ok(body)['page']
            assert 'restoran' in maps_page['text'].lower(), maps_page['text']
            live_google_maps = True

        assert all(item['focusPreserved'] for item in focus_audit), focus_audit

        STATE.fail_pull_until = time.time() + 1.2
        await asyncio.sleep(1.5)
        cid = STATE.push('browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid, 15))
        assert result['version'] == '1.6.12'

        await context.close()
        import os
        launch_kwargs = {}
        browser_executable = os.environ.get('OA_BROWSER_EXECUTABLE', '')
        if browser_executable:
            launch_kwargs['executable_path'] = browser_executable
        elif os.path.exists('/usr/bin/chromium'):
            launch_kwargs['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile),
            headless=headless,
            ignore_default_args=['--disable-extensions'],
            **launch_kwargs,
            args=[
                f'--disable-extensions-except={EXT}',
                f'--load-extension={EXT}',
                '--no-sandbox',
                '--disable-dev-shm-usage'
            ]
        )
        worker2 = await wait_worker(context, 15000)
        assert worker2.url.split('/')[2] == ext_id
        await asyncio.sleep(0.8)
        cid = STATE.push('browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid, 20))
        assert result['protocolVersion'] == 1

        await context.close()
        print(json.dumps({
            'ok': True,
            'extensionId': ext_id,
            'r0UsabilityFixture': True,
            'r1ActionabilityFirstSkip': r0_real_skip['label'] == 'Skip' and r0_real_skip['actionable'] is True,
            'r1AdversarialSkipOrdering': r1_items[0]['label'] == 'Skip',
            'r0OnscreenSkipObserved': r0_real_skip['inViewport'] is True,
            'r0StaleRefRecovered': r0_revalidated_click['ref'] == r0_old_skip_ref,
            'r0IrrelevantMutationObserved': r0_page_after_noise['mutationVersion'] > r0_page_before['mutationVersion'],
            'r0LegacyReadPayloadBytes': r0_payload_bytes,
            'r0LegacyReadTextChars': r0_page_before['textChars'],
            'r0MediaStatePresent': r0_media['present'] is True,
            'semanticReadChars': page['textChars'],
            'textOnlyReadChars': text_only['textChars'] + final_chunk['textChars'],
            'textOnlyElementsOmitted': True,
            'semanticPayloadBytes': semantic_payload_bytes,
            'semanticIdentity': True,
            'semanticIdentityRerenderStable': rerender_after['logicalId'] == rerender_before['logicalId'],
            'semanticIdentityStaleRefRecovered': revalidated['ref'] == rerender_before['ref'],
            'r2FreshTargetRevalidation': all(r2_acceptance.values()),
            'r3PostActionEvidence': all(r3_acceptance.values()),
            'r5ReadyMediaSeek': True,
            'r5ReadyMediaSeekRuns': len(r5_seek_latencies),
            'r5ReadyMediaSeekP50Ms': r5_seek_p50_ms,
            'r5ReadyMediaSeekNoNavigationReload': not r5_acceptance['navigationOrReloadUsed'],
            'semanticIdentitySpaReset': spa_page['semanticState']['resetReason'] == 'SPA_ROUTE',
            'semanticDelta': True,
            'semanticDeltaSingleUpdate': len(semantic_updates) == 1,
            'semanticDeltaBytes': semantic_delta_bytes,
            'semanticDeltaToSnapshotRatio': round(semantic_delta_bytes / semantic_payload_bytes, 4),
            'semanticViews': True,
            'semanticViewLazyGrowth': feed_loaded['loadedEntityCount'] - feed_before['loadedEntityCount'] == 2,
            'semanticViewBoundedComplete': feed_boundary_stable['exhaustion']['status'] == 'BOUNDED_COMPLETE',
            'semanticViewUnrelatedStable': feed_after_unrelated['viewRevision'] == feed_boundary_stable['viewRevision'],
            'semanticCausalProof': feed_after_unrelated['completion']['status'] == 'BOUNDED_COMPLETE',
            'textOnlyPayloadBytes': text_only_payload_bytes,
            'payloadReductionBytes': semantic_payload_bytes - text_only_payload_bytes,
            'navigationFastPath': True,
            'trustedClick': True,
            'genericPointer': True,
            'boundedBurst': True,
            'boundedBurstStabilityRuns': 20,
            'backgroundFocusAudit': focus_audit,
            'backgroundFocusAuditCommands': len(focus_audit),
            'backgroundFocusPreserved': all(item['focusPreserved'] for item in focus_audit),
            'backgroundCoordinateInput': True,
            'adaptiveScreenshot': True,
            'backgroundScreenshotFocusPreserved': focus_before_capture == focus_after_capture,
            'screenshotEncodedBytes': screenshot['encodedBytes'],
            'screenshotHashReuse': unchanged['unchanged'] is True and 'data' not in unchanged,
            'screenshotCrop': cropped['crop'],
            'blankScreenshotBlocked': True,
            'embeddedSensitiveScreenshotBlocked': True,
            'sensitiveScreenshotBlocked': True,
            'privateTabScreenshotBlocked': True,
            'foregroundPointerRejectedOnBackgroundTab': True,
            'liveGoogleMapsBackgroundInput': live_google_maps,
            'sensitiveFillBlocked': True,
            'fileUploadBlocked': True,
            'networkReconnect': True,
            'browserRestartReconnect': True,
            'benchmarks': STATE.metrics
        }, indent=2))

if __name__ == '__main__':
    asyncio.run(run())
