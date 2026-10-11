# Loop C2: anomaly adaptation without vision.
# At t=15s the fixture sextuples enemy speed. The outer loop below reads TEXT
# only (loop trace plus DOM text via page.read, never a screenshot): on death
# it sends a revised table that dodges on blue approach instead of the red
# telegraph. Pass: recovered without one screenshot. Run by hand with:
#   py tests/loop_c2.py

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

RED = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC'
BLUE = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAGUlEQVR4nGNgYPhPARrVPKp5VPOo5gHVDAAUwI6AVu8gqwAAAABJRU5ErkJggg=='

GAME = """<!doctype html><html><head><title>Loop C2 fixture</title></head>
<body style="margin:0">
<canvas id="game" width="400" height="300"></canvas>
<div id="alive">alive</div>
<div id="score">0</div>
<div id="phase">phase1</div>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let px = 200, py = 150, score = 0, alive = true;
let ex = 0, edir = 1, coinCool = 0, speed = 1.5, phase = 1;
const LANE = 140;
setTimeout(() => { if (alive) { speed = 18; phase = 2; } }, 15000);
function draw() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  if (coinCool === 0) {
    ctx.fillStyle = 'gold';
    ctx.fillRect(200, 140, 20, 20);
  }
  const near = Math.abs(ex - px) < 30;
  ctx.fillStyle = near ? 'red' : 'blue';
  ctx.fillRect(ex, LANE, 20, 20);
  ctx.fillStyle = 'green';
  ctx.fillRect(px, py, 20, 20);
  document.getElementById('alive').textContent = alive ? 'alive ' + score : 'dead ' + score;
  document.getElementById('score').textContent = String(score);
  document.getElementById('phase').textContent = 'phase' + phase;
}
function collide() {
  return alive && px < ex + 20 && ex < px + 20 && py < LANE + 20 && LANE < py + 20;
}
function grab() {
  return alive && px < 220 && 200 < px + 20 && py < 160 && 140 < py + 20;
}
setInterval(() => {
  if (!alive) return;
  ex += edir * speed;
  if (ex >= 380) { ex = 380; edir = -1; }
  if (ex <= 0) { ex = 0; edir = 1; }
  if (coinCool > 0) coinCool -= 1;
  if (coinCool === 0 && grab()) { score += 1; coinCool = 100; }
  if (collide()) { alive = false; }
  draw();
}, 50);
draw();
document.addEventListener('keydown', (event) => {
  if (!alive) return;
  const step = 10;
  if (event.key === 'ArrowLeft') px = Math.max(0, px - step);
  else if (event.key === 'ArrowRight') px = Math.min(380, px + step);
  else if (event.key === 'ArrowUp') py = Math.max(130, py - step);
  else if (event.key === 'ArrowDown') py = Math.min(280, py + step);
  else return;
  event.preventDefault();
  if (coinCool === 0 && grab()) { score += 1; coinCool = 100; }
  if (collide()) { alive = false; }
  draw();
});
</script>
</body></html>"""

class C2Handler(BaseHTTPRequestHandler):

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

        async def state_text():
            read = await cmd('page.read', {'tabId': tab_id, 'limit': 300, 'includeElements': False})
            return H.assert_completed_ok(read)['page']['text']

        async def run_until_stopped(loop_id, polls=100):
            final = None
            for _ in range(polls):
                await asyncio.sleep(0.5)
                body = await cmd('loop.read', {'loopId': loop_id})
                final = H.assert_completed_ok(body)
                if not final['running']:
                    break
            assert final is not None and not final['running'], final
            return final

        opened = await cmd('tabs.open', {'url': f'http://{H.HOST}:{gameport}/game', 'active': False, 'wait': True})
        tab_id = H.assert_completed_ok(opened)['tab']['id']

        started = await cmd('loop.start', {'tabId': tab_id, 'program': {
            'tickMs': 200, 'maxTicks': 200, 'maxDurationMs': 60000,
            'sensors': [
                {'id': 'danger', 'kind': 'templateMatch', 'template': RED, 'region': {'x': 100, 'y': 130, 'width': 200, 'height': 40}, 'threshold': 0.5},
                {'id': 'clock', 'kind': 'timer', 'everyMs': 8000},
            ],
            'rules': [
                {'when': {'sensor': 'danger'}, 'do': {'action': 'key', 'key': 'ArrowDown'}},
                {'when': {'sensor': 'clock'}, 'do': {'action': 'key', 'key': 'ArrowUp'}},
            ],
        }})
        loop1 = H.assert_completed_ok(started)['loopId']
        print('phase 1 loop:', loop1)

        dead = False
        for _ in range(90):
            await asyncio.sleep(0.5)
            text = await state_text()
            if 'dead' in text:
                dead = True
                break
            body = await cmd('loop.read', {'loopId': loop1})
            if not H.assert_completed_ok(body)['running']:
                break
        text1 = await state_text()
        print('phase 1 end state:', text1)
        await cmd('loop.stop', {'loopId': loop1})
        assert dead or 'dead' in text1, 'anomaly never killed phase 1; C2 inconclusive: ' + text1
        print('anomaly killed phase 1 (text evidence only)')

        await cmd('tabs.reload', {'tabId': tab_id})
        await asyncio.sleep(1.5)
        started2 = await cmd('loop.start', {'tabId': tab_id, 'program': {
            'tickMs': 200, 'maxTicks': 120, 'maxDurationMs': 30000,
            'sensors': [
                {'id': 'approach', 'kind': 'templateMatch', 'template': BLUE, 'region': {'x': 40, 'y': 130, 'width': 320, 'height': 40}, 'threshold': 0.5},
                {'id': 'clock', 'kind': 'timer', 'everyMs': 8000},
            ],
            'rules': [
                {'when': {'sensor': 'approach'}, 'do': {'action': 'key', 'key': 'ArrowDown'}},
                {'when': {'sensor': 'clock'}, 'do': {'action': 'key', 'key': 'ArrowUp'}},
            ],
        }})
        loop2 = H.assert_completed_ok(started2)['loopId']
        final2 = await run_until_stopped(loop2)
        text2 = await state_text()
        print('phase 2 end state:', text2)
        bands = {}
        for e in final2['trace']:
            bands[e['band']] = bands.get(e['band'], 0) + 1
        print('phase 2 bands:', bands)
        assert 'alive' in text2 and 'dead' not in text2, text2
        print('C2 GREEN: recovered without one screenshot')

def main():
    server = ThreadingHTTPServer((H.HOST, 0), C2Handler)
    gameport = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-c2-')
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
