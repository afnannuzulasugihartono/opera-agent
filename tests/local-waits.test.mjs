// @last-edited: 2026-10-23 UTC+7.
// @title: local-waits — a wait ends on evidence, not on a clock that guessed how long a page takes.
// @state: the page settle, the mutation wait, and the text, row and stillness waits built on it.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTLE_MAX_MS,
  SETTLE_POLL_MS
} from '../local/page-expressions.js';
import { createPrimitives } from '../local/primitives.js';
import { createWaits } from '../local/waits.js';
import {
  recordingCdp,
  DOC_URL
} from './helpers/local-page.mjs';

test('settle watches the page from Node, so a hidden tab cannot clamp its timer', async () => {
  const cdp = recordingCdp();
  const slept = [];
  const out = await createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } }).settle();

  const calls = cdp.calls.filter((call) => call.method === 'Runtime.evaluate');
  const arm = calls.find((call) => call.params.expression.includes('opera-settle-arm'));
  const read = calls.find((call) => call.params.expression.includes('opera-settle-read'));
  const disarm = calls.find((call) => call.params.expression.includes('opera-settle-disarm'));

  assert.ok(arm, 'settle installs a mutation watcher');
  assert.match(arm.params.expression, /MutationObserver/);
  assert.equal(arm.params.awaitPromise, undefined, 'no page-side promise waits on a throttled timer');
  assert.ok(read, 'settle asks the watcher how quiet the page is');
  assert.match(read.params.expression, /__operaSettle/);
  assert.ok(disarm, 'settle removes its watcher');
  assert.equal(out.why, 'quiet');
  assert.equal(out.changes, 1);
  assert.equal(out.maxMs, SETTLE_MAX_MS);
  assert.deepEqual(slept, [SETTLE_POLL_MS]);
});


test('settle stops at the cap when the page never goes quiet', async () => {
  const cdp = recordingCdp();
  cdp.send = async (
    method,
    params = {}
  ) => {
    cdp.calls.push({
      method,
      params
    });
    if (params.expression.includes('opera-settle-read')) {
      return { result: { value: {
        changes: 0,
        quietMs: 0,
        elapsedMs: 0,
        visibility: 'visible'
      } } };
    }
    return { result: { value: true } };
  };
  const slept = [];
  const out = await createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } }).settle();

  assert.equal(out.why, 'deadline');
  assert.equal(slept.length, SETTLE_MAX_MS / SETTLE_POLL_MS);
  assert.ok(slept.every((ms) => ms === SETTLE_POLL_MS));
});


test('a text wait settles the page between checks instead of sleeping a fixed gap', async () => {
  const texts = [
    'not yet',
    'Heading is here'
  ];
  let ask = 0;
  const slept = [];
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('document.title')) {
        return { result: { value: {
          title: 't',
          url: 'u',
          text: texts[Math.min(ask++, texts.length - 1)],
          ready: 'complete'
        } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-arm')) {
        return { result: { value: true } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-read')) {
        return { result: { value: {
          changes: 0,
          quietMs: 40,
          elapsedMs: 40,
          visibility: 'visible'
        } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-disarm')) {
        return { result: { value: true } };
      }
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } });

  const out = await p.waitForText('Heading', {
    timeoutMs: 200,
    intervalMs: 100
  });

  assert.equal(out.text, 'Heading is here');
  assert.ok(cdp.calls.some((call) => call.params?.expression?.includes('opera-settle-arm')), 'the wait waits on a mutation settle');
  assert.ok(slept.includes(SETTLE_POLL_MS), 'and sleeps the settle beat, not the fixed 100 ms gap');
  assert.ok(!slept.includes(100), 'the fixed interval is not the method anymore');
});


test('a row wait settles the page between checks instead of sleeping a fixed gap', async () => {
  const slept = [];
  const cdp = rowsCdp([
    [],
    [{
      role: 'menuitem',
      name: 'Upload',
      x: 1,
      y: 1,
      node: 0
    }]
  ]);
  const p = createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } });

  const out = await p.waitForRow({
    role: 'menuitem',
    name: 'Upload',
    timeoutMs: 200,
    intervalMs: 100
  });

  assert.equal(out.found, true);
  assert.ok(cdp.calls.some((call) => call.params?.expression?.includes('opera-settle-arm')), 'the wait waits on a mutation settle');
  assert.ok(slept.includes(SETTLE_POLL_MS), 'and sleeps the settle beat, not the fixed 100 ms gap');
  assert.ok(!slept.includes(100), 'the fixed interval is not the method anymore');
});


test('a read on a settled page takes two samples and says the text stood still', async () => {
  const cdp = recordingCdp();
  const slept = [];

  const out = await createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } }).read();

  assert.equal(out.title, 't');
  assert.equal(out.url, 'u');
  assert.equal(out.text, 'body text');
  assert.equal(out.ready, 'complete');
  assert.equal(out.settled, true, 'the text stood still across the two samples');
  assert.equal(out.grewBy, 0, 'and it did not grow');
  assert.equal(out.strategy, 'dom');
  assert.equal(out.harm, 'none');
  assert.equal(out.caretMoved, false);
  assert.equal(out.caretRestored, true);
  assert.equal(out.caretWhy, '');
  const asks = cdp.calls.filter((c) => c.method === 'Runtime.evaluate').map((c) => c.params.expression);
  assert.ok(asks.some((expression) => expression.includes('opera-settle-arm')), 'the read settles before its second sample');
  assert.ok(asks.some((expression) => expression.includes('opera-settle-read')), 'and asks the page how quiet it is');
  assert.deepEqual(slept, [SETTLE_POLL_MS], 'the settle is a beat, not a hundred milliseconds');
});

// WHY A READ THAT RETURNS A TENTH OF THE PAGE IS THE BUG THIS PINS.
// Measured live on YouTube: at 1.9 seconds readyState said complete with 871 characters; by 2.4 seconds the page held 8,478.
// One read there is not wrong about what it saw - it is wrong about what it implies, because nothing in the answer says the page was still filling in.
// The second sample turns that into a fact the caller can act on.


test('a read on a page still filling in says so, and answers with the later sample', async () => {
  const samples = [
    {
      title: 'YouTube',
      url: 'https://www.youtube.com/',
      text: 'x'.repeat(871),
      ready: 'complete'
    },
    {
      title: 'YouTube',
      url: 'https://www.youtube.com/',
      text: 'x'.repeat(8478),
      ready: 'complete'
    }
  ];
  let ask = 0;
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('document.title')) {
        return { result: { value: samples[Math.min(ask++, samples.length - 1)] } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-arm')) {
        return { result: { value: true } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-read')) {
        return { result: { value: {
          changes: 1,
          quietMs: 0,
          elapsedMs: 8,
          visibility: 'visible'
        } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-disarm')) {
        return { result: { value: true } };
      }
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.ready, 'complete', 'readyState said complete, and that is exactly why it cannot be the only signal');
  assert.equal(out.settled, false, 'the page had not stopped moving');
  assert.equal(out.grewBy, 7607, 'and it says by how much');
  assert.equal(out.text.length, 8478, 'the answer is the later sample, not the one already stale');
});


// WHY THIS TEST NAMES A CANVAS SURFACE AND NOT A SITE.
// It used to ask for a Google Doc by name and assert the document came from that site's clipboard.
// The behaviour worth pinning is the same for any canvas editor: the DOM around the canvas holds chrome, and the wait must not end on that chrome.
// So the fake models a canvas surface and the assertion is that the wait reaches past the chrome.

// WHY THE CHROME IS LONGER THAN THE DOM BAR.
// Measured on a real Google Doc: the chrome around the canvas holds 1,312 characters, so a wait that measures length alone is satisfied by the toolbar and reports found:false for text that is sitting in the document.
// The fake therefore answers the DOM with a toolbar's worth of words, and only a wait that asks the page what it is can see past them.

test('a text wait on a canvas surface reaches past the chrome in the DOM', async () => {
  const CANVAS_PROBE = {
    textInDom: {
      value: true,
      evidence: 1312
    },
    canvas: {
      value: true,
      evidence: 0.61
    },
    editable: {
      value: true,
      evidence: 'true'
    },
    focused: {
      value: true,
      evidence: 'document.hasFocus() is true'
    }
  };
  const RICH_AX = [
    'First line',
    'Second line',
    'Third line',
    'Fourth line',
    'Fifth line',
    'Sixth line',
    'Seventh line',
    'Eighth line',
    'Ninth line',
    'Tenth line'
  ];
  const axTree = (texts) => {
    const nodes = [
      {
        nodeId: 'root',
        parentId: undefined,
        childIds: [
          'chromeRoot',
          'docRoot'
        ],
        role: { value: 'RootWebArea' },
        name: { value: '' }
      },
      {
        nodeId: 'chromeRoot',
        parentId: 'root',
        childIds: [],
        role: { value: 'toolbar' },
        name: { value: '' }
      },
      {
        nodeId: 'docRoot',
        parentId: 'root',
        childIds: [],
        role: { value: 'generic' },
        name: { value: '' }
      }
    ];
    texts.forEach((
      text,
      i
    ) => nodes.push({
      nodeId: `doc${i}`,
      parentId: 'docRoot',
      childIds: [],
      role: { value: 'InlineTextBox' },
      name: { value: text }
    }));
    return { nodes };
  };
  const chrome = [
    'Insert',
    'Mode tampilan',
    'Share',
    'Video',
    'Banner hidden',
    'Caption',
    'Screen reader support enabled',
    'Terakhir disunting',
    'Comment',
    'Edit',
    'Format',
    'Tools',
    'Extensions',
    'Help',
    'History'
  ].join('\n');
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      const expression = String(params.expression ?? '');
      if (method === 'Runtime.evaluate' && expression.includes('window.innerHeight')) {
        return { result: { value: CANVAS_PROBE } };
      }
      if (method === 'Accessibility.getFullAXTree') return axTree(RICH_AX);
      if (method === 'Runtime.evaluate' && expression.includes('document.title')) {
        return { result: { value: {
          title: 'Doc',
          url: DOC_URL,
          text: chrome
        } } };
      }
      if (method === 'Runtime.evaluate' && expression.includes('opera-settle-read')) {
        return { result: { value: {
          changes: 1,
          quietMs: 40,
          elapsedMs: 40,
          visibility: 'visible'
        } } };
      }
      return { result: { value: null } };
    }
  };
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForText('Second line', {
    timeoutMs: 200,
    intervalMs: 10
  });

  assert.match(out.text, /Second line/, 'the wait ends on the words in the document');
  assert.ok(!out.text.includes('Mode tampilan'), 'and not on the chrome the DOM holds');
  assert.equal(out.strategy, 'ax', 'the ladder decided which read would reach it');
});


test('waitForMutation uses the page settle between reads instead of a fixed gap', async () => {
  const slept = [];
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-arm')) return { result: { value: true } };
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-read')) return { result: { value: {
        changes: 1,
        quietMs: 40,
        elapsedMs: 40,
        visibility: 'visible'
      } } };
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-disarm')) return { result: { value: true } };
      return { result: { value: { value: 'wait' } } };
    }
  };
  let asks = 0;
  const read = async () => {
    asks += 1;
    if (asks < 2) return { value: 'wait' };
    return { value: 'go' };
  };
  const p = createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } });

  const out = await p.waitForMutation(read, (state) => state.value === 'go', {
    timeoutMs: 200,
    intervalMs: 100
  });

  assert.equal(out.value, 'go');
  assert.ok(slept.includes(SETTLE_POLL_MS), 'the wait waits on the page settle');
  assert.ok(!slept.includes(100), 'and not on a fixed gap');
});


test('createWaits assembles the settle and the shared waits in one place', () => {
  const methods = createWaits({
    cdp: { send: async () => ({ result: { value: {
      quietMs: 40,
      changes: 0,
      visibility: 'visible'
    } } }) },
    sleep: async () => {},
    readState: async () => ({}),
    readRows: async () => [],
    read: async () => ({}),
    primitives: {
      settle: async () => ({ why: 'quiet' }),
      evaluate: async () => 'complete'
    }
  });

  assert.deepEqual(Object.keys(methods).sort(),
    [
      'settle',
      'waitForIdle',
      'waitForMutation',
      'waitForRow',
      'waitForStill',
      'waitForText'
    ]);
});


function rowsCdp(reads) {
  const queue = [...reads];
  const calls = [];
  return {
    calls,
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-arm')) {
        return { result: { value: true } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-read')) {
        return { result: { value: {
          changes: 0,
          quietMs: 40,
          elapsedMs: 40,
          visibility: 'visible'
        } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-disarm')) {
        return { result: { value: true } };
      }
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { result: { value: next } };
    }
  };
}


test('a row wait ends on the first read that has the row', async () => {
  const cdp = rowsCdp([
    [],
    [],
    [{
      role: 'menuitem',
      name: 'Upload from computer',
      x: 5,
      y: 6,
      node: 0
    }]
  ]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForRow({
    role: 'menuitem',
    name: 'Upload from computer'
  });

  assert.equal(out.found, true);
  assert.equal(out.checks, 3, 'it stopped looking the moment the row was there');
  assert.equal(out.row.name, 'Upload from computer');
});


test('a row wait can wait for a row to go away', async () => {
  const cdp = rowsCdp([
    [{
      role: 'menuitem',
      name: 'Upload',
      x: 1,
      y: 1,
      node: 0
    }],
    []
  ]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForRow({
    role: 'menuitem',
    name: 'Upload',
    absent: true
  });

  assert.equal(out.found, true, 'gone is what was asked for');
  assert.equal(out.row, null);
});


test('a row wait that runs out says so and hands back the page', async () => {
  const cdp = rowsCdp([[{
    role: 'menuitem',
    name: 'Other',
    x: 1,
    y: 1,
    node: 0
  }]]);
  const p = createPrimitives(cdp, {
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock
  });

  let clock = 0;
  const result = await p.waitForRow({
    role: 'menuitem',
    name: 'Upload',
    timeoutMs: 200,
    intervalMs: 100
  });

  assert.equal(result.found, false);
  assert.equal(result.row, null);
  assert.ok(result.checks >= 2, 'it looked more than once before saying no');
});


test('stillness ends on two identical reads and names how long it took', async () => {
  const still = [{
    role: 'menuitem',
    name: 'Image',
    x: 3,
    y: 4,
    node: 0
  }];
  const cdp = rowsCdp([
    [{
      role: 'menuitem',
      name: 'Image',
      x: 3,
      y: 4,
      node: 0
    }],
    still,
    still
  ]);
  const slept = [];
  const p = createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } });

  const out = await p.waitForStill({
    quietMs: 0,
    intervalMs: 1000,
    timeoutMs: 5000
  });

  assert.equal(out.still, true);
  assert.equal(out.settled, true, 'the wait already settled, so the page look does not pay twice');
  assert.ok(out.checks >= 2, 'one matching pair is what stillness means');
  assert.ok(slept.every((ms) => ms === SETTLE_POLL_MS), 'the wait settles on the page instead of sleeping a fixed interval');
  assert.ok(slept.length > 0, 'and it did wait for the page to be quiet');
});

// WHY THE CLOCK MOVES INSTEAD OF THE SLEEP.
// The wait measures quiet time against the wall clock, so a one-millisecond budget is over before a second read can be reached and the wait would answer "still" having read once — the opposite of what a page that never stops moving deserves.


test('a page that never settles says so instead of pretending', async () => {
  let tick = 0;
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-arm')) {
        return { result: { value: true } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-read')) {
        return { result: { value: {
          changes: 1,
          quietMs: 0,
          elapsedMs: 8,
          visibility: 'visible'
        } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-settle-disarm')) {
        return { result: { value: true } };
      }
      tick += 1;
      return { result: { value: [{
        role: 'menuitem',
        name: 'Image',
        x: tick,
        y: 4,
        node: 0
      }] } };
    }
  };
  let at = 1000;
  const p = createPrimitives(cdp, {
    sleep: async (ms) => {
      at += ms;
    },
    now: () => at
  });

  const out = await p.waitForStill({
    quietMs: 50,
    intervalMs: 10,
    timeoutMs: 1000
  });

  assert.equal(out.still, false);
  assert.ok(out.checks >= 5, `a page moving every read is not still (read ${out.checks} times)`);
});


test('stillness watches the rows an agent acts on, not the whole document', async () => {
  const cdp = rowsCdp([[{
    role: 'menuitem',
    name: 'Image',
    x: 3,
    y: 4,
    node: 0
  }]]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  await p.waitForStill({
    quietMs: 0,
    intervalMs: 1,
    timeoutMs: 2000
  });

  const asked = cdp.calls.find((c) => c.method === 'Runtime.evaluate');
  assert.match(asked.params.expression, /__LIMIT__|getBoundingClientRect/, 'the read is the snapshot the agent already uses');
});

// WHY A DOWNLOAD IS TESTED AGAINST A DISK AND NOT AN EVENT.
// The bridge road carries commands and not CDP events, so an implementation that waited for downloadProgress would pass on a debugging port and hang on the signed-in profile.
// These tests therefore give the primitive a fake filesystem and check what an observer would check: a file appeared, it stopped growing, the folder was armed before the click, and the browser-wide behavior was handed back.

