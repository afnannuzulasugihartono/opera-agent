// @last-edited: 2026-11-01 UTC+7.
// @title: focus-confirm — the question asked in the window the person is working in, before the screen is taken from them.
// @state: the notice the person sees, the answer it gives, and the question of whether a focus steals the screen at all.
// @dependencies: node:test, strict, ../local/focus-confirm.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync
} from 'node:fs';

import {
  NOTICE,
  askFocus,
  createNoticeHost,
  focusSteal,
  warmFocusNotice
} from '../local/focus-confirm.js';

// WHY THE PERSON IS ASKED IN THE WINDOW THEY ARE IN.
// The person may have moved on to another tab, another browser or another program while the drive was working, and a focus that lands under their hands takes that away without asking.
// So the question is asked where their eyes already are, and it is asked without taking the focus.

test('the question is asked in the window in front, and it is asked without taking the focus', async () => {
  const calls = [];
  const spawn = (
    command,
    args,
    options
  ) => {
    const piped = [];
    calls.push({
      command,
      args,
      options,
      piped
    });
    return {
      stdout: {
        on: (
          _event,
          fn
        ) => {
          fn('ALLOW\n');
        }
      },
      stderr: {
        on: () => {}
      },
      stdin: {
        end: (text) => {
          piped.push(text);
        }
      },
      on: (
        event,
        fn
      ) => {
        if (event === 'close') fn(0);
      },
      kill: () => {}
    };
  };

  const out = await askFocus({
    what: 'the "Bukti Template Jurnal" tab',
    spawn
  });

  assert.equal(calls[0].command, 'powershell');
  assert.ok(calls[0].args.includes(NOTICE), 'the notice that carries the question is the one in this tree');
  assert.deepEqual(calls[0].piped, ['the "Bukti Template Jurnal" tab'], 'and the question reaches it over the pipe, where a title keeps its quotes');
  assert.equal(calls[0].options.windowsHide, true, 'the console of the question stays out of the way');
  assert.deepEqual(out, {
    allowed: true,
    answer: 'allow'
  });
});

test('a person who says no stops the focus', async () => {
  const spawn = () => ({
    stdout: {
      on: (
        _event,
        fn
      ) => {
        fn('DISMISS\n');
      }
    },
    stderr: {
      on: () => {}
    },
    stdin: {
      end: () => {}
    },
    on: (
      event,
      fn
    ) => {
      if (event === 'close') fn(0);
    },
    kill: () => {}
  });

  const out = await askFocus({
    what: 'a window',
    spawn
  });

  assert.equal(out.allowed, false);
  assert.equal(out.answer, 'dismiss');
});

test('a focus that changes nothing is not asked about', () => {
  const same = focusSteal({
    foreground: 'Bukti Template Jurnal - Google Docs - Google Chrome',
    title: 'Bukti Template Jurnal - Google Docs'
  });

  assert.equal(same.ask, false, 'the person is already on that tab');
  assert.equal(same.why, '');
});

test('a focus that moves the screen away from the person is asked about, and says what it would take', () => {
  const other = focusSteal({
    foreground: 'Typecelerate - Brave',
    title: 'Bukti Template Jurnal - Google Docs'
  });

  assert.equal(other.ask, true);
  assert.match(other.why, /Typecelerate - Brave/, 'and names what is on the screen now');
});

// WHY THE BROWSER IS PART OF THE ANSWER.
// The same page can be open in two browsers at once, and the window in front would then carry the title of the tab the drive wants - so a title alone says "the person is already here" while the screen is about to move to another browser.

test('the same page open in another browser is still a steal', () => {
  const other = focusSteal({
    foreground: 'Bukti Template Jurnal - Google Docs - Brave',
    title: 'Bukti Template Jurnal - Google Docs',
    browser: 'Google Chrome'
  });

  assert.equal(other.ask, true, 'the screen is about to move to another browser');
  assert.match(other.why, /Brave/, 'and names what is on the screen now');
});

test('the same page in the browser being driven is not a steal', () => {
  const same = focusSteal({
    foreground: 'Bukti Template Jurnal - Google Docs - Google Chrome',
    title: 'Bukti Template Jurnal - Google Docs',
    browser: 'Google Chrome'
  });

  assert.equal(same.ask, false, 'the person is already on that tab in that browser');
});

test('a machine that cannot say what is in front is not asked about', () => {
  const silent = focusSteal({
    foreground: '',
    title: 'Bukti Template Jurnal'
  });

  assert.equal(silent.ask, false);
  assert.match(silent.why, /did not say/);
});

// WHY THE QUESTION GIVES UP AFTER THIRTY SECONDS.
// The person is sometimes away from the machine, and a drive that waits five minutes on a question nobody is there to see is a drive that never finishes.
// So the panel says when the screen goes, and at that moment the screen goes.

test('the question waits thirty seconds, and then the screen goes', async () => {
  const calls = [];
  const spawn = (
    command,
    args
  ) => {
    calls.push(args);
    return {
      stdout: {
        on: (
          _event,
          fn
        ) => {
          fn('ALLOW\n');
        }
      },
      stderr: {
        on: () => {}
      },
      stdin: {
        end: () => {}
      },
      on: (
        event,
        fn
      ) => {
        if (event === 'close') fn(0);
      },
      kill: () => {}
    };
  };

  await askFocus({
    what: 'a window',
    spawn
  });

  const at = calls[0].indexOf('-TimeoutSec');
  assert.ok(at >= 0, 'the panel is told how long it may wait');
  assert.equal(calls[0][at + 1], '30', 'and thirty seconds is the deadline');
});

test('a person who is away lets the drive on', async () => {
  const spawn = () => ({
    stdout: {
      on: () => {}
    },
    stderr: {
      on: () => {}
    },
    stdin: {
      end: () => {}
    },
    on: () => {},
    kill: () => {}
  });

  const out = await askFocus({
    what: 'a window',
    spawn,
    timeoutMs: 40
  });

  assert.equal(out.allowed, true, 'the drive goes on without the person');
  assert.equal(out.answer, 'timeout');
});

// WHY THE NOTICE ITSELF ANSWERS ALLOW AT ITS DEADLINE.
// The operating system path asks the notice directly, with no JavaScript in between, so the panel has to make the same promise on its own.

test('the notice lets the screen go when nobody answers it', () => {
  const script = readFileSync(NOTICE, 'utf8');

  assert.match(script, /\$form\.Answer = 'ALLOW'/, 'the panel answers yes when its deadline passes');
  assert.doesNotMatch(script, /\$form\.Answer = 'TIMEOUT'/, 'and never answers no');
});

// WHY THE QUESTION GOES TO A PANEL THAT IS ALREADY UP.
// Measured live on this machine: the question cost 1.6 s before it was even on screen, because every ask started its own PowerShell and compiled the panel class again.
// So one panel host stays up for the life of the agent, and the question is a line to it.

test('the question goes to the panel host that is already up', async () => {
  const asked = [];
  const out = await askFocus({
    what: 'the "Tool bench" window',
    host: {
      ask: async (request) => {
        asked.push(request);
        return 'ALLOW';
      }
    }
  });

  assert.equal(asked.length, 1, 'the panel that is already up was asked once');
  assert.equal(asked[0].what, 'the "Tool bench" window');
  assert.deepEqual(out, {
    allowed: true,
    answer: 'allow'
  });
});

test('a person who says no in the panel host stops the focus', async () => {
  const out = await askFocus({
    what: 'a window',
    host: {
      ask: async () => 'DISMISS'
    }
  });

  assert.deepEqual(out, {
    allowed: false,
    answer: 'dismiss'
  });
});

test('a panel host that cannot answer falls back to the panel that starts on the spot', async () => {
  const spawns = [];
  const out = await askFocus({
    what: 'a window',
    host: {
      ask: async () => null
    },
    spawn: (
      command,
      args,
      options
    ) => {
      spawns.push({
        command,
        args,
        options
      });
      return {
        stdout: {
          on: (
            _event,
            fn
          ) => {
            fn('ALLOW\n');
          }
        },
        stderr: {
          on: () => {}
        },
        stdin: {
          end: () => {}
        },
        on: (
          event,
          fn
        ) => {
          if (event === 'close') fn(0);
        },
        kill: () => {}
      };
    }
  });

  assert.equal(spawns.length, 1, 'the panel that starts on the spot was used');
  assert.ok(spawns[0].args.includes(NOTICE), 'and it is the notice in this tree');
  assert.deepEqual(out, {
    allowed: true,
    answer: 'allow'
  });
});

// WHY THE PANEL HOST IS ONE PROCESS AND NOT ONE PER QUESTION.
// The panel class is compiled when the host starts, and every question after that travels over one pipe.

const fakeHost = () => {
  const state = {
    written: [],
    listeners: [],
    handlers: {}
  };
  const child = {
    stdout: {
      on: (
        _event,
        fn
      ) => {
        state.listeners.push(fn);
      }
    },
    stderr: {
      on: () => {}
    },
    stdin: {
      write: (text) => {
        state.written.push(text);
      }
    },
    on: (
      event,
      fn
    ) => {
      state.handlers[event] = fn;
    },
    unref: () => {},
    kill: () => {}
  };
  return {
    child,
    state,
    say: (line) => state.listeners.forEach((fn) => fn(line + '\n')),
    close: () => state.handlers.close?.(0)
  };
};

test('the panel host answers every question over one pipe', async () => {
  const hosts = [];
  const host = createNoticeHost({
    spawn: () => {
      const fake = fakeHost();
      hosts.push(fake);
      setTimeout(() => fake.say('READY'), 0);
      return fake.child;
    }
  });

  const first = host.ask({
    what: 'one window'
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  hosts[0].say('ALLOW');
  assert.equal(await first, 'ALLOW');

  const second = host.ask({
    what: 'another window'
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  hosts[0].say('DISMISS');
  assert.equal(await second, 'DISMISS');

  assert.equal(hosts.length, 1, 'one host answers every question');
  assert.equal(hosts[0].state.written.length, 2, 'and every question is one line');
  assert.deepEqual(JSON.parse(hosts[0].state.written[0]), {
    what: 'one window',
    seconds: 30
  });
});

test('a panel host whose shell dies answers nothing', async () => {
  const hosts = [];
  const host = createNoticeHost({
    spawn: () => {
      const fake = fakeHost();
      hosts.push(fake);
      return fake.child;
    }
  });

  const asked = host.ask({
    what: 'a window'
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  hosts[0].close();

  assert.equal(await asked, null, 'a dead panel answers nothing');
});

test('the panel host is started before any question is asked', async () => {
  const starts = [];
  const host = warmFocusNotice({
    spawn: (
      command,
      args,
      options
    ) => {
      starts.push({
        command,
        args,
        options
      });
      return fakeHost().child;
    }
  });

  assert.equal(starts.length, 1, 'the panel host starts on its own');
  assert.equal(starts[0].command, 'powershell');
  assert.ok(starts[0].args.includes(NOTICE), 'it runs the notice in this tree');
  assert.ok(starts[0].args.includes('-Worker'), 'and it waits for questions instead of asking one');
  assert.equal(starts[0].options.windowsHide, true, 'the console of the panel stays out of the way');

  host.close();
});
