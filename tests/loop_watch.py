# C3 watcher: passive screenshots while a human plays. Plain Chromium, no
# extension, no input, no vision API. The operator plays; analysis happens
# after from the saved frames. Run, then play for ~100 seconds:
#   py tests/loop_watch.py

import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.async_api import async_playwright


async def main():
    shot_dir = Path('tmp/watch')
    shot_dir.mkdir(parents=True, exist_ok=True)
    for old in shot_dir.glob('w-*.png'):
        old.unlink()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 720})
        await page.goto('https://wayou.github.io/t-rex-runner/')
        await page.wait_for_timeout(3000)
        print('PLAY NOW: 100 seconds, 50 frames')
        for i in range(50):
            await page.screenshot(path=str(shot_dir / ('w-%02d.png' % i)))
            await page.wait_for_timeout(2000)
        print('done:', len(list(shot_dir.glob('w-*.png'))), 'frames')
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
