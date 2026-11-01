// @last-edited: 2026-11-01 UTC+7.
// @title: focus-confirm — the question asked in the window the person is working in, before the screen is taken from them.
// @state: the notice script, the panel host that stays up, the answer it gives back, and the question of whether a focus would take the screen at all.
// @dependencies: node:child_process, node:url.

import {
  spawn
} from 'node:child_process';
import {
  fileURLToPath
} from 'node:url';

export const NOTICE = fileURLToPath(new URL('./focus-notice.ps1', import.meta.url));

// WHY THE PERSON IS ASKED IN THE WINDOW THEY ARE IN.
// The person may have moved on to another tab, another browser or another program while the drive was working, and a focus that lands under their hands takes that away without asking.
// So the question is asked where their eyes already are, and it is asked without taking the focus: the panel is shown without being activated, so the keys they are typing keep going where they were going.

// WHY THE QUESTION GOES OVER THE PIPE AND NOT IN THE ARGUMENTS.
// Measured on this machine: a window title handed to PowerShell as an argument arrived as `bring A` - every quote and every word after it was gone.
// The pipe carries the text as it is, so the person is told what is about to happen to their screen.

// WHY THE PANEL HOST IS A PROCESS THAT STAYS UP.
// Measured live on this machine: the question cost 1.6 s before it was on screen, because every ask started its own PowerShell and compiled the panel class again.
// One host compiles that class once and answers every question over one pipe, so the question is on screen the moment it is asked.
// The transport is the console stream and not the PowerShell pipeline: measured live, a line written to the console and flushed comes back in under ten milliseconds, while the same line through the pipeline took 1.1 s.
// The host does not hold the agent up: it is let go of when it starts and killed by the exit hook when the process really ends, and a question that is waiting keeps it alive on its own.

/**
 * Build the panel host: one PowerShell that keeps the panel class compiled and answers every question.
 * @param {object} [options] - the process runner to start the host with.
 * @param {Function} [options.spawn] - the runner that starts the host.
 * @param {number} [options.readyTimeoutMs] - how long the host may take to say it is ready.
 * @returns {object} the host, with the question it asks and the way to close it.
 */

export const createNoticeHost = ({
  spawn: spawn_ = spawn,
  readyTimeoutMs = 3000
} = {}) => {
  let child = null;
  let seen = '';
  let ready = false;
  let dead = false;
  const waiting = [];
  const readyWaiters = [];

  const take = (line) => {
    if (line === 'READY') {
      ready = true;
      readyWaiters.splice(0).forEach((resolve) => resolve(true));
      return;
    }
    waiting.shift()?.resolve(line);
  };

  const die = () => {
    dead = true;
    ready = false;
    waiting.splice(0).forEach((one) => one.resolve(null));
    readyWaiters.splice(0).forEach((resolve) => resolve(false));
  };

  const start = () => {
    if (child || dead) return;
    try {
      child = spawn_('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        NOTICE,
        '-Worker'
      ], {
        windowsHide: true,
        stdio: [
          'pipe',
          'pipe',
          'pipe'
        ]
      });
    } catch {
      die();
      return;
    }
    child.stdout?.on('data', (chunk) => {
      seen += String(chunk);
      for (;;) {
        const at = seen.indexOf('\n');
        if (at < 0) break;
        const line = seen.slice(0, at).trim();
        seen = seen.slice(at + 1);
        take(line);
      }
    });
    child.stderr?.on('data', () => {});
    child.on('error', die);
    child.on('close', die);
    child.unref?.();
    child.stdout?.unref?.();
    child.stderr?.unref?.();
    process.once('exit', () => {
      try {
        child?.kill();
      } catch {}
    });
  };

  const waitReady = () => new Promise((resolve) => {
    if (ready) {
      resolve(true);
      return;
    }
    if (dead) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      const at = readyWaiters.indexOf(resolve);
      if (at >= 0) readyWaiters.splice(at, 1);
      resolve(false);
    }, readyTimeoutMs);
    readyWaiters.push((up) => {
      clearTimeout(timer);
      resolve(up);
    });
  });

  const ask = async ({
    what,
    timeoutMs = 30000
  } = {}) => {
    if (dead) return null;
    start();
    const up = await waitReady();
    if (!up) return null;
    const answer = await new Promise((resolve) => {
      const waiter = {
        resolve: null
      };
      const timer = setTimeout(() => {
        const at = waiting.indexOf(waiter);
        if (at >= 0) waiting.splice(at, 1);
        resolve('TIMEOUT');
      }, timeoutMs + 1000);
      waiter.resolve = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      waiting.push(waiter);
      try {
        child.stdin.write(JSON.stringify({
          what: String(what ?? ''),
          seconds: Math.max(1, Math.ceil(timeoutMs / 1000))
        }) + '\n');
        child.stdout?.ref?.();
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    child.stdout?.unref?.();
    return answer;
  };

  const close = () => {
    die();
    try {
      child?.kill();
    } catch {}
    child = null;
  };

  start();

  return {
    ask,
    close,
    alive: () => !dead
  };
};

// WHY ONE PANEL HOST FOR THE WHOLE PROCESS.
// The window reads and the dialog reads share one shell for the same reason: the first caller pays the slow start and every later one answers in milliseconds.

let shared = null;

/**
 * Start the panel host this process keeps, so a question never pays for a boot.
 * @param {object} [options] - the process runner to start the host with.
 * @param {Function} [options.spawn] - the runner that starts the host.
 * @returns {object|null} the host, or null on a machine that cannot show the panel.
 */

export const warmFocusNotice = ({
  spawn: spawn_ = spawn
} = {}) => {
  if (process.platform !== 'win32') return null;
  if (shared === null || !shared.alive()) shared = createNoticeHost({
    spawn: spawn_
  });
  return shared;
};

// WHY A PANEL THAT CANNOT ANSWER FALLS BACK TO THE PANEL THAT STARTS ON THE SPOT.
// The host is a convenience, not a promise: a machine where it never says it is ready must still ask the person, or the drive would take the screen without asking.

const askOnce = ({
  what,
  timeoutMs = 30000,
  spawn: spawn_ = spawn
}) => new Promise((resolve) => {
  const child = spawn_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    NOTICE,
    '-TimeoutSec',
    String(Math.max(1, Math.ceil(timeoutMs / 1000)))
  ], {
    windowsHide: true
  });
  let out = '';
  child.stdout?.on('data', (chunk) => {
    out += String(chunk);
  });
  child.stderr?.on('data', () => {});

  child.stdin?.end?.(String(what ?? ''));

  // WHY THERE IS A TIMEOUT ON THE WAIT AND NOT ONLY ON THE PANEL.
  // A person who is not at the machine must not leave a drive waiting forever, and a panel that nobody answered is not an answer of no. The panel answers yes at its own deadline, and this is the backstop for a panel that never comes back at all.

  const timer = setTimeout(() => {
    child.kill();
    resolve({
      allowed: true,
      answer: 'timeout'
    });
  }, timeoutMs + 1000);
  child.on('error', () => {
    clearTimeout(timer);
    resolve({
      allowed: false,
      answer: 'error'
    });
  });
  child.on('close', () => {
    clearTimeout(timer);
    const allowed = /\bALLOW\b/.test(out);
    resolve({
      allowed,
      answer: allowed ? 'allow' : 'dismiss'
    });
  });
});

/**
 * Ask the person, in the window they are in, whether the drive may take the screen.
 * @param {object} [options] - what the drive wants, how long the question waits, the panel host that is already up, and the process runner to ask with.
 * @param {string} [options.what] - what the drive wants to take.
 * @param {number} [options.timeoutMs] - how long the question waits before the drive goes on.
 * @param {object} [options.host] - the panel host that is already up.
 * @param {Function} [options.spawn] - the runner that starts a panel when there is no host.
 * @returns {Promise<object>} whether the person allowed it, and the answer they gave.
 */

export const askFocus = async ({
  what,
  timeoutMs = 30000,
  host = null,
  spawn: spawn_ = spawn
} = {}) => {
  const panel = host ?? shared;
  if (panel) {
    const answer = await Promise.resolve().then(() => panel.ask({
      what,
      timeoutMs
    })).catch(() => null);
    if (answer === 'ALLOW') return {
      allowed: true,
      answer: 'allow'
    };
    if (answer === 'DISMISS') return {
      allowed: false,
      answer: 'dismiss'
    };
    if (answer === 'TIMEOUT') return {
      allowed: true,
      answer: 'timeout'
    };
  }
  return askOnce({
    what,
    timeoutMs,
    spawn: spawn_
  });
};

// WHY A FOCUS THAT CHANGES NOTHING IS NOT ASKED ABOUT.
// The person is already on the tab or the window the drive wants, so there is nothing to take from them and a question would be noise.

/**
 * Say whether a focus would take the screen away from the person.
 * @param {object} [options] - the window in front, the title the drive wants, and the browser the drive is in.
 * @returns {object} whether to ask, and what the screen is on now.
 */

export const focusSteal = ({
  foreground,
  title,
  browser = ''
}) => {
  const front = String(foreground ?? '');
  if (front === '') {
    return {
      ask: false,
      why: 'the machine did not say which window is in front'
    };
  }

  // WHY THE BROWSER IS PART OF THE ANSWER.
  // The same page can be open in two browsers at once, and the window in front would then carry the title of the tab the drive wants - so a title alone says "the person is already here" while the screen is about to move to another browser.
  // A browser that did not name itself is no browser to compare, and a title alone is then the best answer there is.

  const lower = front.toLowerCase();
  const wanted = String(title ?? '').toLowerCase();
  const own = String(browser ?? '').toLowerCase();
  const sameTitle = wanted !== '' && lower.includes(wanted);
  const sameBrowser = own === '' || own === 'unknown' || lower.includes(own);
  if (sameTitle && sameBrowser) {
    return {
      ask: false,
      why: ''
    };
  }
  return {
    ask: true,
    why: `the screen is on "${front}"`
  };
};
