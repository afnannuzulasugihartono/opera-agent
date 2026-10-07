# Loop C1: 30-second reactive survival on a deterministic fixture.
# The enemy telegraphs (turns red) 1.5s before reaching the player column, and
# one Down step always escapes. Death is only possible if the loop itself
# stalls, which is what C1 must rule out. Run by hand with:
#   py tests/loop_c1.py

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

GAME = """<!doctype html><html><head><title>Loop C1 fixture</title></head>
<body style="margin:0">
<canvas id="game" width="400" height="300"></canvas>
<div id="alive">alive</div>
<div id="score">0</div>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let px = 200, py = 150, score = 0, alive = true;
let ex = 0, edir = 1, coinCool = 0;
const SPEED = 1.5, LANE = 140;
function draw() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  if (coinCool === 0) {
    ctx.fillStyle = 'gold';
    ctx.fillRect(200, 140, 20, 20);
  }
  const near = Math.abs(ex - px) < 60;
  ctx.fillStyle = near ? 'red' : 'blue';
  ctx.fillRect(ex, LANE, 20, 20);
  ctx.fillStyle = 'green';
  ctx.fillRect(px, py, 20, 20);
  document.getElementById('alive').textContent = alive ? 'alive ' + score : 'dead ' + score;
  document.getElementById('score').textContent = String(score);
}
function collide() {
  return alive && px < ex + 20 && ex < px + 20 && py < LANE + 20 && LANE < py + 20;
}
function grab() {
  return alive && px < 220 && 200 < px + 20 && py < 160 && 140 < py + 20;
}
setInterval(() => {
  if (!alive) return;
  ex += edir * SPEED;
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


class C1Handler(BaseHTTPRequestHandler):

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

        started = await cmd('loop.start', {'tabId': tab_id, 'program': {
            'tickMs': 200, 'maxTicks': 160, 'maxDurationMs': 40000,
            'sensors': [
                {'id': 'danger', 'kind': 'templateMatch', 'template': 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC', 'region': {'x': 100, 'y': 130, 'width': 200, 'height': 40}, 'threshold': 0.5},
                {'id': 'clock', 'kind': 'timer', 'everyMs': 8000},
            ],
            'rules': [
                {'when': {'sensor': 'danger'}, 'do': {'action': 'key', 'key': 'ArrowDown'}},
                {'when': {'sensor': 'clock'}, 'do': {'action': 'key', 'key': 'ArrowUp'}},
            ],
        }})
        loop_id = H.assert_completed_ok(started)['loopId']
        print('loop started:', loop_id)

        final = None
        for _ in range(100):
            await asyncio.sleep(0.5)
            body = await cmd('loop.read', {'loopId': loop_id})
            final = H.assert_completed_ok(body)
            if not final['running']:
                break
        assert final is not None and not final['running'], final
        print('final:', json.dumps({k: final[k] for k in ('tick', 'firedTotal', 'mode', 'stopReason', 'trusted')}, indent=2))
        bands = {}
        for e in final['trace']:
            bands[e['band']] = bands.get(e['band'], 0) + 1
        print('bands:', bands)

        read = await cmd('page.read', {'tabId': tab_id, 'limit': 300, 'includeElements': False})
        text = H.assert_completed_ok(read)['page']['text']
        print('end state:', text)
        assert 'alive' in text and 'dead' not in text, text
        score = int(text.split()[-1])
        assert score >= 1, text
        green_share = bands.get('green', 0) / max(1, final['tick'])
        assert final['tick'] >= 120, final
        assert green_share >= 0.7, bands

        await cmd('tabs.close', {'tabId': tab_id})
        print('C1 GREEN')


def main():
    server = ThreadingHTTPServer((H.HOST, 0), C1Handler)
    gameport = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-c1-')
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
