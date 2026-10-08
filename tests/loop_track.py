# Loop track proof: deterministic front-edge tracking on a local fixture.
# A dark bar crosses a clean zone at constant speed; the track sensor must
# fire with sane time-to-impact values. No vision, no tokens, no throttle
# risk: any failure here is engine, not environment. Run by hand with:
#   py tests/loop_track.py

import asyncio
import ctypes
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_extension_test as H
from playwright.async_api import async_playwright

GAME = """<!doctype html><html><head><title>Loop track fixture</title></head>
<body style="margin:0">
<canvas id="game" width="400" height="300"></canvas>
<div id="passes">0</div>
<div id="frames">0</div>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ox = 380, passes = 0, frames = 0;
function draw() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = 'dimgray';
  ctx.fillRect(ox, 100, 30, 60);
  document.getElementById('passes').textContent = String(passes);
  document.getElementById('frames').textContent = String(frames);
}
draw();
function countFrame() { frames += 1; requestAnimationFrame(countFrame); }
requestAnimationFrame(countFrame);
setInterval(() => {
  ox -= 5;
  if (ox < -30) { ox = 380; passes += 1; }
  draw();
}, 50);
</script>
</body></html>"""


class TrackHandler(BaseHTTPRequestHandler):

    def log_message(self, *_):
        pass

    def do_GET(self):
        payload = GAME.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


async def drive(port, profile, gameport):
    async with async_playwright() as p:
        launch_kwargs = {}
        executable = os.environ.get('OA_BROWSER_EXECUTABLE', '')
        if executable:
            launch_kwargs['executable_path'] = executable
        elif os.path.exists('/usr/bin/chromium'):
            launch_kwargs['executable_path'] = '/usr/bin/chromium'
        context = await p.chromium.launch_persistent_context(
            str(profile),
            headless=False,
            ignore_default_args=['--disable-extensions'],
            **launch_kwargs,
            args=[
                f'--disable-extensions-except={H.EXT}',
                f'--load-extension={H.EXT}',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--autoplay-policy=no-user-gesture-required',
            ],
        )
        worker = await H.wait_worker(context)
        popup = await context.new_page()
        ext_id = worker.url.split('/')[2]
        await popup.goto(f'chrome-extension://{ext_id}/popup.html')
        await popup.evaluate(f"chrome.storage.local.set({{bridgeUrl:'http://{H.HOST}:{port}/bridge'}})")
        await popup.reload()
        await popup.fill('#pairCode', H.PAIR_CODE)
        await popup.click('#pairButton')
        await popup.locator('#pairedSection').wait_for(state='visible', timeout=10000)

        async def cmd(method, params, timeout=40):
            cid = H.STATE.push(method, params)
            return await asyncio.to_thread(H.STATE.wait, cid, timeout)

        opened = await cmd('tabs.open', {'url': f'http://{H.HOST}:{gameport}/game', 'active': False, 'wait': True})
        tab_id = H.assert_completed_ok(opened)['tab']['id']

        # A throttled renderer reads as sensor blindness, so the game window
        # is kept in the foreground for the whole run.
        user32 = ctypes.windll.user32
        front_stop = [False]

        async def keep_front():
            while not front_stop[0]:
                try:
                    found = []

                    def enum_cb(hwnd, _):
                        if user32.IsWindowVisible(hwnd):
                            buf = ctypes.create_unicode_buffer(512)
                            user32.GetWindowTextW(hwnd, buf, 512)
                            if buf.value and 'chromium' in buf.value.lower():
                                found.append(hwnd)
                        return True

                    cb = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)(enum_cb)
                    user32.EnumWindows(cb, 0)
                    for hwnd in found:
                        user32.SetForegroundWindow(hwnd)
                except Exception:
                    pass
                await asyncio.sleep(5)

        front_task = asyncio.create_task(keep_front())

        # The bar crosses 400px at 100px/s (4s per pass). The zone sees the
        # front from x=350; impact at pad 20 needs (350-20)/100 = 3.3s of
        # tracking, firing once time-to-impact drops under 400ms.
        started = await cmd('loop.start', {'tabId': tab_id, 'program': {
            'tickMs': 100, 'maxTicks': 120, 'maxDurationMs': 20000,
            'sensors': [
                {'id': 'front', 'kind': 'track', 'region': {'x': 50, 'y': 90, 'width': 300, 'height': 80}, 'threshold': 0.5, 'leadMs': 400, 'pad': 20},
            ],
            'rules': [{'when': {'sensor': 'front'}, 'do': {'action': 'key', 'key': 'ArrowRight'}}],
        }})
        loop_id = H.assert_completed_ok(started)['loopId']
        final = None
        for _ in range(60):
            await asyncio.sleep(0.5)
            body = await cmd('loop.read', {'loopId': loop_id})
            final = H.assert_completed_ok(body)
            if not final['running']:
                break
        assert final is not None and not final['running'], final
        print('ticks:', final['tick'], 'fired:', final['firedTotal'], 'stop:', final.get('stopReason'))
        ttis = [e['values']['front'] for e in final['trace'] if isinstance(e.get('values', {}).get('front'), (int, float))]
        print('tti samples:', ttis[:12])
        assert final['firedTotal'] >= 6, final
        assert all(0 <= t <= 400 for t in ttis), ttis
        assert len(ttis) >= 6, ttis
        await cmd('tabs.close', {'tabId': tab_id})
        front_stop[0] = True
        print('TRACK PROOF GREEN')


def main():
    server = ThreadingHTTPServer((H.HOST, 0), TrackHandler)
    gameport = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-track-')
    try:
        time.sleep(0.2)
        asyncio.run(drive(port, Path(profile.name), gameport))
    finally:
        server.shutdown()
        server.server_close()
        bridge.shutdown()
        bridge.server_close()
        profile.cleanup()


if __name__ == '__main__':
    main()
