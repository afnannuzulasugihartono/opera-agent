/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: download-wait - wait for the browser to finish an in-page download and return its item, so the caller can report where the file landed.
 * @state: polls chrome.downloads.search by filename until state is complete or interrupted, bounded; the filename match is substring on purpose because Chrome rewrites duplicates to "name (1).ext".
 * @dependencies: chrome.downloads.
 */

// WHY THE PAGE STARTS THE DOWNLOAD AND THE WORKER WAITS, NOT THE OTHER WAY ROUND: a data: URL download is renamed after its MIME type by the browser (measured: demo-page.webm landed as download.webm), and a service worker has no URL.createObjectURL at all; an anchor click from the page keeps the caller's filename, which is the one promise the user cares about.

import { sleep } from './utils.js';
import { codedError } from './capture.js';

const sleepMs = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

export async function waitForDownloadByFilename(filename: string, timeoutMs = 20000) {
  const started = Date.now();

  for (;;) {
    const [item] = await chrome.downloads.search({ query: [filename], limit: 1, orderBy: ['-startTime'] });

    if (item && item.state === 'complete') return item;

    if (item && item.state === 'interrupted') {
      throw codedError('DOWNLOAD_FAILED', item.error || 'The file could not be written.', { filename });
    }

    if (Date.now() - started > timeoutMs) {
      throw codedError('DOWNLOAD_TIMEOUT', 'The file did not appear in Downloads in time.', { filename });
    }

    await sleepMs(200);
  }
}
