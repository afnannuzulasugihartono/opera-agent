// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-page — the page in sight, and the marker the document is searched for.
// @state: the visibility probe, the find bar probe, and the marker that is left selected.
// @dependencies: node:test, strict, ../local/doc-native-page.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureVisible,
  selectMarker
} from '../local/doc-native-page.js';

const noSleep = async () => {};

test('a page in sight is left alone, and a page out of sight without a title says so', async () => {
  const seen = await ensureVisible({
    evaluate: async () => ({
      visibility: 'visible',
      title: 'Doc - Google Docs'
    })
  });
  assert.equal(seen.visible, true);
  assert.equal(seen.why, '');

  const blind = await ensureVisible({
    evaluate: async () => ({
      visibility: 'hidden',
      title: ''
    })
  });
  assert.equal(blind.visible, false);
  assert.match(blind.why, /no title/);
});

test('the marker is found, counted and left selected', async () => {
  const calls = [];
  const doc = {
    front: async () => {
      calls.push({
        what: 'front'
      });
    },
    key: async (name) => {
      calls.push({
        what: 'key',
        name
      });
    },
    evaluate: async (expression) => {
      if (expression.includes('visibilityState')) {
        return {
          visibility: 'visible',
          title: 'Doc - Google Docs'
        };
      }
      return {
        counter: '1 of 1',
        count: 1,
        missing: false,
        noBar: false
      };
    },
    cdp: {
      send: async (
        method,
        params = {}
      ) => {
        calls.push({
          what: 'cdp',
          method,
          text: params.text ?? ''
        });
        return null;
      }
    }
  };
  const found = await selectMarker({
    doc,
    marker: '[[opera-toc]]',
    sleep: noSleep
  });

  assert.equal(found.missing, false);
  assert.equal(found.counter, '1 of 1');
  assert.equal(found.visible, true);
  const keys = calls
    .filter((call) => call.what === 'key')
    .map((call) => call.name);
  assert.deepEqual(keys, [
    'f',
    'Enter',
    'Escape'
  ], 'the marker is searched for, the match is taken, and the find bar is closed with the match still selected');
  assert.ok(calls.some((call) => call.what === 'cdp' && call.text === '[[opera-toc]]'), 'the marker was typed into the find bar');
});

test('a document that does not open its find bar says so', async () => {
  const doc = {
    front: async () => {},
    key: async () => {},
    evaluate: async (expression) => {
      if (expression.includes('visibilityState')) {
        return {
          visibility: 'visible',
          title: 'Doc - Google Docs'
        };
      }
      return {
        counter: '',
        count: null,
        missing: false,
        noBar: true
      };
    },
    cdp: {
      send: async () => null
    }
  };
  const found = await selectMarker({
    doc,
    marker: '[[opera-toc]]',
    sleep: noSleep
  });

  assert.equal(found.noBar, true);
});
