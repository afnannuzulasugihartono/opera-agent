# Loop drive: proves loop.start/read/stop against a real headed browser
# through the mock bridge. Not part of CI; run by hand with:
#   py tests/loop_drive.py

import asyncio
import json
import os
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_extension_test as H
from playwright.async_api import async_playwright


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

        async def cmd(method, params, timeout=20):
            cid = H.STATE.push(method, params)
            return await asyncio.to_thread(H.STATE.wait, cid, timeout)

        opened = await cmd('tabs.open', {'url': f'http://{H.HOST}:{port}/visual', 'active': True, 'wait': True})
        tab_id = H.assert_completed_ok(opened)['tab']['id']

        started = await cmd('loop.start', {'tabId': tab_id, 'program': {
            'tickMs': 100, 'maxTicks': 8,
            'sensors': [{'id': 'beat', 'kind': 'timer', 'everyMs': 200}],
            'rules': [{'when': {'sensor': 'beat'}, 'do': {'action': 'key', 'key': 'ArrowDown'}}],
        }})
        loop_id = H.assert_completed_ok(started)['loopId']
        print('loop started:', loop_id)

        final = None
        for _ in range(30):
            await asyncio.sleep(0.5)
            body = await cmd('loop.read', {'loopId': loop_id})
            final = H.assert_completed_ok(body)
            if not final['running']:
                break
        assert final is not None and not final['running'], final
        assert final['tick'] >= 3, final
        assert final['firedTotal'] >= 1, final
        assert all(e['band'] in ('green', 'yellow', 'orange', 'red') for e in final['trace']), final
        bands = {}
        for e in final['trace']:
            bands[e['band']] = bands.get(e['band'], 0) + 1
        print('timer loop final:', json.dumps({k: final[k] for k in ('tick', 'firedTotal', 'mode', 'stopReason', 'trusted')}, indent=2))
        print('bands:', bands)

        visual = await cmd('tabs.open', {'url': f'http://{H.HOST}:{port}/visual', 'active': True, 'wait': True})
        visual_id = H.assert_completed_ok(visual)['tab']['id']
        started2 = await cmd('loop.start', {'tabId': visual_id, 'program': {
            'tickMs': 200, 'maxTicks': 3,
            'sensors': [
                {'id': 'beat', 'kind': 'timer', 'everyMs': 200},
                {'id': 'frame', 'kind': 'regionHash', 'region': {'x': 0, 'y': 0, 'width': 640, 'height': 320}},
            ],
            'rules': [{'when': {'sensor': 'beat'}, 'do': {'action': 'key', 'key': 'ArrowDown'}}],
        }}, timeout=30)
        loop2 = H.assert_completed_ok(started2)['loopId']
        final2 = None
        for _ in range(30):
            await asyncio.sleep(0.5)
            body = await cmd('loop.read', {'loopId': loop2}, timeout=30)
            final2 = H.assert_completed_ok(body)
            if not final2['running']:
                break
        assert final2 is not None and not final2['running'], final2
        assert final2['tick'] >= 1, final2
        bands2 = {}
        for e in final2['trace']:
            bands2[e['band']] = bands2.get(e['band'], 0) + 1
        print('pixel loop final:', json.dumps({k: final2[k] for k in ('tick', 'firedTotal', 'mode', 'stopReason', 'trusted')}, indent=2))
        print('bands:', bands2)
        print('LOOP DRIVE GREEN')


def main():
    server = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-loop-')
    try:
        time.sleep(0.2)
        asyncio.run(drive(port, Path(profile.name)))
    finally:
        server.shutdown()
        server.server_close()
        profile.cleanup()


if __name__ == '__main__':
    main()
