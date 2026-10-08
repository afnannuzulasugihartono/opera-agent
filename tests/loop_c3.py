# Loop C3: vision-calibrated public play on the open-source T-Rex runner.
# agar.io is bot-walled (403/challenge) and voodoo paper.io 2 is a marketing
# page with no playable game, so C3 runs here: jump-only reflex play.
# The calibrator (qwen) confirms the canvas and marks the obstacle approach
# zone once; the device loop jumps on pixel change; qwen reads the score.
# Pass preset BEFORE the run: any of 3 attempts reaches score >= 100.
# Needs GROQ_API_KEY in the environment. Run by hand with:
#   GROQ_API_KEY=... py tests/loop_c3.py

import asyncio
import base64
import ctypes
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_extension_test as H
from playwright.async_api import async_playwright

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
MODEL = 'qwen/qwen3.8-27b'
NIM_MODEL = 'meta/llama-3.2-11b-vision-instruct'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
PASS_SCORE = 100
ATTEMPTS = 3
MAX_VISION_CALLS = 10


def qwen_call(request):
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.loads(response.read())
    time.sleep(12)
    return json.loads(payload['choices'][0]['message']['content'])


def nim_json(image_b64, question):
    key = os.environ.get('NVIDIA_API_KEY', '')
    assert key, 'NVIDIA_API_KEY is missing from the environment'
    body = json.dumps({
        'model': NIM_MODEL,
        'max_tokens': 512,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': question + ' Answer as JSON only.'},
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image_b64}},
            ],
        }],
    }).encode()
    last = None
    for wait in (15, 45):
        request = urllib.request.Request(
            NIM_URL, data=body,
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'User-Agent': UA},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read())
            time.sleep(5)
            return json.loads(payload['choices'][0]['message']['content'])
        except Exception as error:
            last = error
            print('nim retry in %ds: %s' % (wait, str(error)[:120]))
            time.sleep(wait)
    raise last


def see_json(image_b64, question):

    # Calibrator failover: NIM 11b-vision first (~3s), Groq qwen on failure.
    # Whichever answers valid JSON wins; the caller never knows the difference.
    last = None
    if os.environ.get('NVIDIA_API_KEY'):
        try:
            return nim_json(image_b64, question)
        except Exception as error:
            last = error
            print('nim failed, failing over to groq:', str(error)[:120])
    return qwen_json(image_b64, question)


def qwen_json(image_b64, question):
    key = os.environ.get('GROQ_API_KEY', '')
    assert key, 'GROQ_API_KEY is missing from the environment'
    body = json.dumps({
        'model': MODEL,
        'response_format': {'type': 'json_object'},
        'max_completion_tokens': 512,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': question + ' Answer as JSON only.'},
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image_b64}},
            ],
        }],
    }).encode()
    last = None
    for attempt in (30, 60, 120):
        request = urllib.request.Request(
            GROQ_URL, data=body,
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'},
        )
        try:
            return qwen_call(request)
        except urllib.error.HTTPError as error:
            last = error
            if error.code != 429:
                raise
            print('groq 429, backing off %ds' % attempt)
            time.sleep(attempt)
    raise last


async def drive(port, profile):
    calls = [0]

    async def see(page, question):
        assert calls[0] < MAX_VISION_CALLS, 'vision budget spent'
        shot = await page.screenshot(type='png')
        calls[0] += 1
        shot_dir = Path('tmp/c3shots')
        shot_dir.mkdir(parents=True, exist_ok=True)
        (shot_dir / ('shot-%d.png' % calls[0])).write_bytes(shot)
        answer = await asyncio.to_thread(see_json, base64.b64encode(shot).decode(), question)
        print('vision #%d:' % calls[0], json.dumps(answer)[:300])
        return answer

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

                # The game loop reads pixels every tick: a throttled renderer
                # dilates game time (score 9 after 16s was measured), which
                # reads as sensor blindness. These flags keep rAF honest.
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
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

        async def cmd(method, params, timeout=60):
            cid = H.STATE.push(method, params)
            return await asyncio.to_thread(H.STATE.wait, cid, timeout)

        opened = await cmd('tabs.open', {'url': 'https://wayou.github.io/t-rex-runner/', 'active': True, 'wait': True, 'waitTimeoutMs': 30000})
        tab_id = H.assert_completed_ok(opened)['tab']['id']
        page = [pg for pg in context.pages if 't-rex-runner' in (pg.url or '')][0]
        await asyncio.sleep(5)

        # A throttled renderer reads as sensor blindness (identical frames),
        # so the game window is kept in the foreground for the whole run.
        user32 = ctypes.windll.user32
        front_stop = [False]

        async def keep_front():
            seen = []
            while not front_stop[0]:
                try:
                    found = []

                    def enum_cb(hwnd, _):
                        if user32.IsWindowVisible(hwnd):
                            buf = ctypes.create_unicode_buffer(512)
                            user32.GetWindowTextW(hwnd, buf, 512)
                            if buf.value and 't-rex' in buf.value.lower():
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

        # Watch snapshots every 5s so a human can follow the run later.
        watching = [True]

        async def watcher():
            n = 0
            while watching[0]:
                await asyncio.sleep(3)
                try:
                    n += 1
                    await page.screenshot(path='tmp/c3shots/run-%02d.png' % n)
                except Exception:
                    pass

        watch_task = asyncio.create_task(watcher())

        # Start the game first: obstacles only exist on a running screen,
        # so the calibrator cannot mark an approach zone before this.
        await cmd('page.key', {'tabId': tab_id, 'key': 'Space', 'trusted': True})
        await asyncio.sleep(3)

        # Zone from direct observation of the running screen (1280x720
        # viewport, stable in this drive): dino at x<65, ground y~395.
        # Trigger distance must cover the widest clusters: the sense-act
        # latency (~1 tick) shifts every trigger earlier by v*tick, so the
        # zone sits further right than the raw jump window suggests.
        zone = [260, 340, 80, 55]
        print('approach zone:', zone)

        best = 0
        for attempt in range(1, ATTEMPTS + 1):

            # Guard FIRST, verify after: the game kills an unguarded dino in
            # ~4s while a vision round trip costs 5-15s, so every earlier run
            # handed the loop a corpse. The loop guards from the first tick;
            # vision only observes.
            await cmd('page.key', {'tabId': tab_id, 'key': 'Space', 'trusted': True})
            started = await cmd('loop.start', {'tabId': tab_id, 'program': {
                'tickMs': 100, 'maxTicks': 300, 'maxDurationMs': 45000, 'trusted': True,
                'sensors': [
                    {'id': 'obstacle', 'kind': 'track', 'region': {'x': 100, 'y': 315, 'width': 380, 'height': 70}, 'threshold': 0.01, 'leadMs': 200, 'pad': 35},
                    {'id': 'calm', 'kind': 'stillness', 'region': {'x': 1070, 'y': 120, 'width': 140, 'height': 60}, 'threshold': 0.005, 'stillTicks': 30},
                    {'id': 'flatline', 'kind': 'stillness', 'region': {'x': 950, 'y': 350, 'width': 300, 'height': 55}, 'threshold': 0.003, 'stillTicks': 30},
                    {'id': 'leapt', 'kind': 'pixelDiff', 'region': {'x': 0, 'y': 330, 'width': 70, 'height': 75}, 'threshold': 0.05},
                ],
                'rules': [
                    {'when': {'sensor': 'obstacle'}, 'do': {'action': 'key', 'key': 'Space'}},
                ],
                'stopWhen': [{'sensor': 'calm'}, {'sensor': 'flatline'}],
            }})
            loop_id = H.assert_completed_ok(started)['loopId']
            await asyncio.sleep(3)
            started_check = await see(page, 'This is the T-Rex runner game. Return {"started": true} if the game is running (ground scrolling or score counting), or {"started": false} if it still shows "Press Space to start" or a GAME OVER screen.')
            if not started_check.get('started'):
                print('attempt %d never started, retrying' % attempt)
                await cmd('loop.stop', {'loopId': loop_id})
                await asyncio.sleep(1)
                continue

            # Death stops the loop itself via the stillness sensors (score
            # digits and ground texture freeze), so no vision polling is
            # needed mid-run: the debugger detaches within seconds of death.
            await asyncio.sleep(35)
            body = await cmd('loop.read', {'loopId': loop_id})
            final = H.assert_completed_ok(body)
            if final['running']:
                await cmd('loop.stop', {'loopId': loop_id})
                body = await cmd('loop.read', {'loopId': loop_id})
                final = H.assert_completed_ok(body)
            bands = {}
            leapt_ticks = []
            obstacle_ticks = []
            for e in final['trace']:
                bands[e['band']] = bands.get(e['band'], 0) + 1
                if 'leapt' in e.get('sensors', []):
                    leapt_ticks.append(e['tick'])
                if 'obstacle' in e.get('sensors', []):
                    obstacle_ticks.append(e['tick'])
            print('attempt %d ticks=%d fired=%d stop=%s bands=%s' % (attempt, final['tick'], final['firedTotal'], final.get('stopReason'), bands))
            print('input ticks (obstacle):', obstacle_ticks[:20])
            print('output ticks (leapt):', leapt_ticks[:20])
            score_view = await see(page, 'This is the T-Rex runner game, possibly over. Return {"score": number-or-null} with the current score digits shown at the top right, and {"alive": true/false} (false if a GAME OVER / restart screen shows).')
            score = score_view.get('score') or 0
            print('attempt %d score=%s alive=%s' % (attempt, score, score_view.get('alive')))
            best = max(best, score if isinstance(score, (int, float)) else 0)
            if best >= PASS_SCORE:
                break
            await asyncio.sleep(2)

        print('best score:', best)
        front_stop[0] = True
        watching[0] = False
        await asyncio.sleep(0.2)
        assert best >= PASS_SCORE, {'best': best}
        print('C3 GREEN')


def main():
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-c3-')
    try:
        time.sleep(0.2)
        asyncio.run(drive(port, Path(profile.name)))
    finally:
        bridge.shutdown()
        bridge.server_close()
        profile.cleanup()


if __name__ == '__main__':
    main()
