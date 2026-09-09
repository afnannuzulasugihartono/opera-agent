import asyncio
import json
import queue
import tempfile
import threading
import time
import uuid
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

LONG_TEXT = 'BEGIN ' + ('civil-engineering-semantic-reader ' * 700) + ' END'
EXTRA_CONTROLS = ''.join(f'<button aria-label="Synthetic action {index}"></button>' for index in range(100))
PAGE = f'''<!doctype html><html><head><title>Opera Agent Test Page</title></head>
<body>
<h1>Opera Agent Browser Test</h1>
<p id="long">{LONG_TEXT}</p>
<button id="toggle" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed')==='true'?'false':'true')">Toggle</button>
<input id="safe" aria-label="Normal field" value="" />
<input id="secret" type="password" aria-label="Password" value="" />
<input id="file" type="file" aria-label="Upload file" />
<div id="surface" aria-label="Pointer test surface" style="width:240px;height:120px;background:#ddd" onmousemove="if(event.buttons)this.textContent='dragged'" onwheel="this.textContent='wheel'">surface</div>
<a href="/page?next=1">Next internal</a>
<a href="https://example.com/">External</a>
{EXTRA_CONTROLS}
</body></html>'''

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
        if self.path.startswith('/page'):
            payload = PAGE.encode()
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
        assert result['version'] == '1.1.1'
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

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 10000, 'maxElements': 50}, benchmark='page.read.semantic')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        page = result['page']
        assert page['textChars'] > 2400, page['textChars']
        assert page['totalTextChars'] > 2400
        assert page['text'].startswith('Opera Agent Browser Test')

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

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle', 'index': 0, 'limit': 5})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['item']['ariaPressed'] == 'true'
        toggle = result['item']

        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'click', 'x': toggle['rect']['centerX'], 'y': toggle['rect']['centerY']})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['action'] == 'click'
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle'})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['ariaPressed'] == 'false'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#surface'})
        surface = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        sx, sy = surface['rect']['centerX'], surface['rect']['centerY']
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'drag', 'x': sx - 30, 'y': sy, 'endX': sx + 30, 'endY': sy})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#surface'})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['text'] == 'dragged'
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'wheel', 'x': sx, 'y': sy, 'deltaY': 120})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#surface'})
        assert assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']['text'] == 'wheel'

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

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#secret'})
        secret = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.pointer', {'tabId': tab_id, 'action': 'click', 'x': secret['rect']['centerX'], 'y': secret['rect']['centerY']})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'Pointer blocked on sensitive target' in failed['error']['message']
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': secret['ref'], 'value': 'should-not-enter'})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'Sensitive field blocked' in failed['error']['message']

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#file'})
        file_el = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': file_el['ref'], 'trusted': False})
        failed = await asyncio.to_thread(STATE.wait, cid)
        assert failed['ok'] is False
        assert 'File upload' in failed['error']['message']

        cid = STATE.push('page.collect_links', {'tabId': tab_id, 'sameOrigin': True, 'limit': 20})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['count'] == 1
        assert result['links'][0]['url'].startswith(f'http://{HOST}:{port}/page')

        STATE.fail_pull_until = time.time() + 1.2
        await asyncio.sleep(1.5)
        cid = STATE.push('browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid, 15))
        assert result['version'] == '1.1.1'

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
            'semanticReadChars': page['textChars'],
            'textOnlyReadChars': text_only['textChars'] + final_chunk['textChars'],
            'textOnlyElementsOmitted': True,
            'semanticPayloadBytes': semantic_payload_bytes,
            'textOnlyPayloadBytes': text_only_payload_bytes,
            'payloadReductionBytes': semantic_payload_bytes - text_only_payload_bytes,
            'navigationFastPath': True,
            'trustedClick': True,
            'genericPointer': True,
            'sensitiveFillBlocked': True,
            'fileUploadBlocked': True,
            'networkReconnect': True,
            'browserRestartReconnect': True,
            'benchmarks': STATE.metrics
        }, indent=2))

if __name__ == '__main__':
    asyncio.run(run())
