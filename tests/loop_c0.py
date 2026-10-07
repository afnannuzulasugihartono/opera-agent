# Loop C0: deterministic calibration probing on a local fixture game.
# No vision needed: the layout is known from source, verification is DOM text
# plus pixel sensors. Run by hand with:
#   py tests/loop_c0.py

import asyncio
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

GAME = """<!doctype html><html><head><title>Loop C0 fixture</title></head>
<body style="margin:0">
<canvas id="game" width="400" height="300"></canvas>
<div id="pos">190,140</div>
<div id="moves">0</div>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let x = 190, y = 140, moves = 0;
function draw() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = 'red';
  ctx.fillRect(x, y, 20, 20);
  document.getElementById('pos').textContent = x + ',' + y;
  document.getElementById('moves').textContent = String(moves);
}
draw();
document.addEventListener('keydown', (event) => {
  const step = 10;
  if (event.key === 'ArrowLeft') x = Math.max(0, x - step);
  else if (event.key === 'ArrowRight') x = Math.min(380, x + step);
  else if (event.key === 'ArrowUp') y = Math.max(0, y - step);
  else if (event.key === 'ArrowDown') y = Math.min(280, y + step);
  else return;
  event.preventDefault();
  moves += 1;
  draw();
});
</script>
</body></html>"""


class C0Handler(BaseHTTPRequestHandler):

    def log_message(self, *_):
        pass

    def do_GET(self):
        payload = GAME.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


async def drive(port, profile):
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

        async def cmd(method, params, timeout=30):
            cid = H.STATE.push(method, params)
            return await asyncio.to_thread(H.STATE.wait, cid, timeout)

        async def run_loop(program, timeout=30):
            started = await cmd('loop.start', {'tabId': tab_id, 'program': program}, timeout)
            loop_id = H.assert_completed_ok(started)['loopId']
            final = None
            for _ in range(30):
                await asyncio.sleep(0.5)
                body = await cmd('loop.read', {'loopId': loop_id}, timeout)
                final = H.assert_completed_ok(body)
                if not final['running']:
                    break
            assert final is not None and not final['running'], final
            return final

        async def counters():
            read = await cmd('page.read', {'tabId': tab_id, 'limit': 500, 'includeElements': False})
            text = H.assert_completed_ok(read)['page']['text']
            moves = int([l for l in text.split() if l.isdigit()][0])
            pos = [l for l in text.split() if ',' in l][0]
            return moves, pos

        opened = await cmd('tabs.open', {'url': f'http://{H.HOST}:{c0port}/game', 'active': False, 'wait': True})
        tab_id = H.assert_completed_ok(opened)['tab']['id']
        assert await counters() == (0, '190,140')

        synth = await run_loop({
            'tickMs': 200, 'maxTicks': 5,
            'sensors': [{'id': 'beat', 'kind': 'timer', 'everyMs': 200}],
            'rules': [{'when': {'sensor': 'beat'}, 'do': {'action': 'key', 'key': 'ArrowRight'}}],
        })
        assert synth['firedTotal'] == 5, synth
        assert synth['trusted'] is False, synth
        assert await counters() == (5, '240,140')
        print('synthetic path: 5 verified moves')

        pixel = await run_loop({
            'tickMs': 200, 'maxTicks': 3,
            'sensors': [
                {'id': 'beat', 'kind': 'timer', 'everyMs': 200},
                {'id': 'frame', 'kind': 'regionHash', 'region': {'x': 0, 'y': 0, 'width': 400, 'height': 300}},
            ],
            'rules': [{'when': {'sensor': 'beat'}, 'do': {'action': 'key', 'key': 'ArrowLeft'}}],
        })
        assert pixel['firedTotal'] == 3, pixel
        assert await counters() == (8, '210,140')
        bands = {}
        for e in pixel['trace']:
            bands[e['band']] = bands.get(e['band'], 0) + 1
        print('pixel sense bands:', bands)

        trusted = await run_loop({
            'tickMs': 200, 'maxTicks': 2, 'trusted': True,
            'sensors': [{'id': 'beat', 'kind': 'timer', 'everyMs': 200}],
            'rules': [{'when': {'sensor': 'beat'}, 'do': {'action': 'key', 'key': 'ArrowUp'}}],
        })
        assert trusted['firedTotal'] == 2, trusted
        assert trusted['trusted'] is True, trusted
        assert await counters() == (10, '210,120')
        print('trusted path: 2 verified moves')

        await cmd('tabs.close', {'tabId': tab_id})
        print('C0 GREEN')


c0port = 0


def main():
    global c0port
    server = ThreadingHTTPServer((H.HOST, 0), C0Handler)
    c0port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]

    # The harness Handler serves the mock bridge on its own port, while the
    # fixture game rides a second local server. The drive below must point at
    # the bridge port, so it is passed explicitly.

    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-c0-')
    try:
        time.sleep(0.2)
        asyncio.run(drive(port, Path(profile.name)))
    finally:
        server.shutdown()
        server.server_close()
        bridge.shutdown()
        bridge.server_close()
        profile.cleanup()


if __name__ == '__main__':
    main()
