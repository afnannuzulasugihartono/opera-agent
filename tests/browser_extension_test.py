import asyncio
import json
import queue
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
HOST = '127.0.0.1'
PORT = 8765
PAIR_CODE = 'TEST-PAIR-1234'

class BridgeState:
    def __init__(self):
        self.commands = queue.Queue()
        self.completed = {}
        self.cv = threading.Condition()
        self.paired = False
        self.fail_pull_until = 0.0

    def push(self, method, params=None, timeout=12000):
        cid = str(uuid.uuid4())
        self.commands.put({'id': cid, 'method': method, 'params': params or {}, 'timeoutMs': timeout})
        return cid

    def complete(self, cid, body):
        with self.cv:
            self.completed[cid] = body
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

LONG_TEXT = 'BEGIN ' + ('civil-engineering-semantic-reader ' * 220) + ' END'
PAGE = f'''<!doctype html><html><head><title>Opera Agent Test Page</title></head>
<body>
<h1>Opera Agent Browser Test</h1>
<p id="long">{LONG_TEXT}</p>
<button id="toggle" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed')==='true'?'false':'true')">Toggle</button>
<input id="safe" aria-label="Normal field" value="" />
<input id="secret" type="password" aria-label="Password" value="" />
<input id="file" type="file" aria-label="Upload file" />
<a href="/page?next=1">Next internal</a>
<a href="https://example.com/">External</a>
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
        except BrokenPipeError:
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
            except BrokenPipeError:
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


def server_thread():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


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

async def run():
    threading.Thread(target=server_thread, daemon=True).start()
    await asyncio.sleep(0.2)
    profile = ROOT / '.tmp-browser-profile'
    if profile.exists():
        import shutil; shutil.rmtree(profile)

    async with async_playwright() as p:
        import os
        launch_kwargs = {}
        if os.path.exists('/usr/bin/chromium'):
            launch_kwargs['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile),
            headless=True,
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
        popup = await context.new_page()
        await popup.goto(f'chrome-extension://{ext_id}/popup.html')
        await popup.evaluate(f"chrome.storage.local.set({{bridgeUrl:'http://{HOST}:{PORT}/bridge'}})")
        await popup.reload()
        await popup.fill('#pairCode', PAIR_CODE)
        await popup.click('#pairButton')
        await popup.locator('#pairedSection').wait_for(state='visible', timeout=10000)
        assert STATE.paired

        cid = STATE.push('browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['version'] == '1.0.1'
        assert result['protocolVersion'] == 1

        cid = STATE.push('tabs.open', {'url': f'http://{HOST}:{PORT}/page', 'active': True, 'wait': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        tab_id = result['tab']['id']
        assert result['tab']['title'] == 'Opera Agent Test Page'

        cid = STATE.push('page.read', {'tabId': tab_id, 'offset': 0, 'limit': 10000, 'maxElements': 50})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        page = result['page']
        assert page['textChars'] > 2400, page['textChars']
        assert page['totalTextChars'] > 2400
        assert page['text'].startswith('Opera Agent Browser Test')

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle', 'index': 0, 'limit': 5})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        toggle = result['item']
        assert toggle['ariaPressed'] == 'false'
        toggle_ref = toggle['ref']

        cid = STATE.push('page.click', {'tabId': tab_id, 'ref': toggle_ref, 'trusted': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['method'] == 'debugger'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#toggle', 'index': 0, 'limit': 5})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['item']['ariaPressed'] == 'true'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        safe_ref = result['item']['ref']
        cid = STATE.push('page.fill', {'tabId': tab_id, 'ref': safe_ref, 'value': 'hello opera agent'})
        assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#safe', 'includeValue': True})
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))
        assert result['item']['value'] == 'hello opera agent'

        cid = STATE.push('page.query', {'tabId': tab_id, 'selector': '#secret'})
        secret = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid))['item']
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
        assert result['links'][0]['url'].startswith(f'http://{HOST}:{PORT}/page')

        STATE.fail_pull_until = time.time() + 1.2
        await asyncio.sleep(1.5)
        cid = STATE.push('browser.ping')
        result = assert_completed_ok(await asyncio.to_thread(STATE.wait, cid, 15))
        assert result['version'] == '1.0.1'

        await context.close()
        import os
        launch_kwargs = {}
        if os.path.exists('/usr/bin/chromium'):
            launch_kwargs['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile),
            headless=True,
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
            'trustedClick': True,
            'sensitiveFillBlocked': True,
            'fileUploadBlocked': True,
            'networkReconnect': True,
            'browserRestartReconnect': True
        }, indent=2))

if __name__ == '__main__':
    asyncio.run(run())
