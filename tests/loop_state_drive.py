# Loop state drive: MAIN-world frame-rate play on the t-rex runner.
# No screenshots, no vision: the device reads game state and acts per frame,
# this script only supervises via state_read. Pass: jumps > 0 and either a
# long run or a game-over event with a real attempt behind it. Run by hand:
#   py tests/loop_state_drive.py

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
        await asyncio.sleep(4)
        await cmd('page.key', {'tabId': tab_id, 'key': 'Space', 'trusted': True})
        await asyncio.sleep(1)

        started = await cmd('loop.state_start', {'tabId': tab_id, 'reader': 'trex', 'leadMs': 250})
        loop_id = H.assert_completed_ok(started)['loopId']
        print('state loop:', loop_id)

        final = None
        for _ in range(12):
            await asyncio.sleep(5)
            await page.screenshot(path='tmp/c3shots/state-%02d.png' % _)
            body = await cmd('loop.state_read', {'loopId': loop_id})
            final = H.assert_completed_ok(body)
            print('ticks=%d jumps=%d running=%s events=%d' % (
                final['ticks'], final['jumps'], final['running'], len(final.get('events', []))))
            if not final['running']:
                break
        assert final is not None
        print('stop:', final.get('stopReason'))
        print('events:', json.dumps(final.get('events', [])[-8:])[:600])
        assert final['jumps'] > 0, final
        await cmd('loop.state_stop', {'loopId': loop_id})
        await cmd('tabs.close', {'tabId': tab_id})
        print('STATE DRIVE GREEN')


def main():
    bridge = ThreadingHTTPServer((H.HOST, 0), H.Handler)
    port = bridge.server_address[1]
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    profile = tempfile.TemporaryDirectory(prefix='opera-agent-state-')
    try:
        time.sleep(0.2)
        asyncio.run(drive(port, Path(profile.name)))
    finally:
        bridge.shutdown()
        bridge.server_close()
        profile.cleanup()


if __name__ == '__main__':
    main()
