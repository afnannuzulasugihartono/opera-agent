// @last-edited: 2026-11-02 UTC+7.
// @title: opera-opencode — the opera-local surface as native OpenCode tools.
// @state: the registrations the plugin makes, the fetch it runs, the child server that keeps the code current, and the browser every tool drives.
// @dependencies: node:child_process, node:fs, node:path, node:url, ../tools.js, ../mcp-server.js, ../context.js, ../bridge.js.

import {
  spawn
} from 'node:child_process';
import {
  readdirSync,
  statSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS } from '../tools.js';
import { createMcpServer } from '../mcp-server.js';
import { createLocalContext } from '../context.js';
import { bridgeReachable } from '../bridge.js';

const NAMESPACE = 'opera';

// WHY THE TOOLS RUN IN A CHILD PROCESS, AND WHY THE TREE IS WATCHED INSTEAD OF THE PLUGIN.
// Node keeps an imported module for the life of the process, so a plugin loaded at startup keeps the code it was loaded with: measured, after a reload the tools still answered in the old timings, because the import cache handed the old module back.
// A child process reads the files when it starts, so replacing the child is what makes a code change real - and the check lives here, in code that already runs on every call, rather than in the module that cannot be replaced.
// The in-process server stays as the fallback for a machine where the child cannot start, because a slower answer beats no answer.

const LOCAL_DIR = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('./opera-local.js', import.meta.url));
const STAMP_EVERY_MS = 1000;

// WHY A BROKEN RUNTIME IS NOT RETRIED ON EVERY CALL.
// A machine where the child cannot start still has the in-process server, and trying again on every call turned one failure into a tax on every tool: measured, about 150 ms each time.
// So a failure is remembered for a while, and the tools answer from the server that is already here.

const RETRY_AFTER_MS = 60000;

// WHY THE CHILD RUNS ON NODE AND NOT ON WHATEVER RUNS THE PLUGIN.
// OpenCode is a compiled binary, so process.execPath points at it and not at a runtime that takes a script: measured, every call then paid about 150 ms for a spawn that could not start the server before falling back.
// Node is what the server is written for and what every machine that runs these tools has, so it is named, and a machine without it simply pays the in-process fallback.

const RUNNER = process.versions.bun ? 'node' : process.execPath;

// WHY A COUNTER IS EXPORTED.
// A test can prove a call answered, but not that a fresh server answered it; the count of children started is the only fact that tells a respawn from a cached answer.

let starts = 0;

/**
 * Count the tool servers this plugin has started, so a test can tell a respawn from a cached answer.
 * @returns {number} how many children have been started.
 */

export const pluginChildStarts = () => starts;

const FETCH_DESCRIPTION = 'Fetch one url with the real browser and answer with the page text. Use it when the page needs JavaScript or a signed-in session, where an HTTP fetch gets nothing back. It opens its own tab, waits for the page to settle, reads it again until the page holds text, and closes the tab again, so one call walks the whole road. Give waitFor when the content arrives late, and the fetch waits for that text before it reads. For a page you have to click through, use open_url and browser_burst instead.';

const FETCH_INPUT = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'absolute url to fetch'
    },
    waitFor: {
      type: 'string',
      description: 'text that must appear on the page before it is read'
    }
  },
  required: ['url']
};

// WHY THE ANSWER IS PARSED AND NOT TAKEN AS IT COMES.
// The tool answers with JSON inside a text block, because that is what the wire protocol carries.
// The plugin reads the fields it needs and hands the page text over as it is, so the model pays for the text and not for the profile that came with it.

const asJson = (result) => {
  const text = result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return {
      text
    };
  }
};

// WHY THE FETCH READS THE PAGE AGAIN.
// Measured live on Hacker News: a fresh tab held no text and no accessibility rows for its first 200ms, and wait_still answered "settled" after 155ms because two empty reads are identical.
// The wait measures stillness and not readiness, so the fetch reads until the page holds text and its document has finished loading.

const hasText = (page) => (page.text ?? '').trim().length > 0;
const isLoading = (page) => page.ready === 'loading';

/**
 * Fetch one url through the browser and answer with the page text.
 * @param {object} options - the call seam, the url, the text to wait for, and the clock the fetch reads on.
 * @param {Function} options.call - runs one opera-local tool by name and answers with its result.
 * @param {string} options.url - the absolute url to open.
 * @param {string} [options.waitFor] - text that must appear before the page is read.
 * @param {number} [options.timeoutMs] - how long the fetch waits for the page to hold text, default 8000.
 * @param {number} [options.retryMs] - the pause between reads, default 300.
 * @param {Function} [options.sleep] - waits between reads.
 * @param {Function} [options.now] - reads the clock the budget is measured on.
 * @returns {Promise<object>} the url it ended on, its title, and the page text.
 */

export async function operaFetch({
  call,
  url,
  waitFor,
  timeoutMs = 8000,
  retryMs = 300,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now
}) {
  const opened = asJson(await call('open_url', {
    url
  }));
  const tabId = opened?.action?.id;
  if (!tabId) throw new Error(`open_url answered without a tab id for ${url}.`);

  try {
    if (waitFor) {
      const waited = asJson(await call('wait_for', {
        tabId,
        text: waitFor
      }));
      if (!waited?.action?.found) {
        throw new Error(`wait_for: "${waitFor}" never appeared on ${url}.`);
      }
    }
    await call('wait_still', {
      tabId
    });
    const deadline = now() + timeoutMs;
    let page = asJson(await call('read_page', {
      tabId
    }));
    while ((!hasText(page) || isLoading(page)) && now() < deadline) {
      await sleep(retryMs);
      page = asJson(await call('read_page', {
        tabId
      }));
    }
    if (!hasText(page)) {
      throw new Error(`the page at ${url} answered with no text after ${timeoutMs}ms; give waitFor the text to wait for, or drive it with opera_open_url and opera_browser_burst.`);
    }
    const note = isLoading(page) ? '\nnote: the page was still loading when the fetch ended' : '';
    return {
      content: [
        {
          type: 'text',
          text: `url: ${page.url ?? url}\ntitle: ${page.title ?? ''}${note}`
        },
        {
          type: 'text',
          text: page.text ?? ''
        }
      ]
    };
  } finally {
    await call('close_tab', {
      tabId
    }).catch(() => null);
  }
}

// WHY THE PICTURE IS HANDED OVER AS A FILE.
// OpenCode's native tool answer carries text and files, and the image block the capture tool sends has no place there, so the model was told the viewport and never saw the page.
// OpenCode's own MCP reader turns such a block into a data url file, so the plugin does the same and the picture arrives.

const asNative = (result) => {
  const content = result?.content;
  if (!Array.isArray(content)) return result;
  return {
    ...result,
    content: content.map((part) => {
      if (part?.type !== 'image' || !part.data) return part;
      const mime = String(part.mimeType ?? 'image/jpeg');
      return {
        type: 'file',
        uri: `data:${mime};base64,${part.data}`,
        mime
      };
    })
  };
};

// WHY THE PERMISSION IS ASKED AND NOT FORCED.
// A rule that says ask is the person's decision, and a rule that says nothing lets the call through.
// So every tool asks the same question, and the rules decide what the answer is.

const allowed = async (
  ctx,
  action,
  input,
  context
) => {
  if (typeof ctx.permission?.assert !== 'function') return;
  const resource = input?.tabId ? String(input.tabId) : '*';
  await ctx.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    source: {
      type: 'tool',
      messageID: context.messageID,
      id: context.id
    },
    action,
    resources: [
      resource
    ],
    save: [
      resource
    ]
  });
};

/**
 * Build the OpenCode plugin that offers the opera-local surface as native tools.
 * @param {object} [options] - the call seam, for a caller that already holds a server.
 * @param {Function} [options.call] - runs one opera-local tool by name; the plugin builds its own when this is absent.
 * @returns {object} the plugin: an id, and a setup that registers the tools.
 */

export function createOperaPlugin({
  call
} = {}) {
  let server = null;
  let child = null;
  let childStamp = -1;
  let checkedAt = 0;
  let newestSeen = -1;
  let retryAt = 0;

  // WHY THE BRIDGE IS ASKED FOR HERE AND NOT AT LOAD.
  // A plugin that binds a port when OpenCode starts would take the machine's bridge whether the browser is used or not.
  // The first call asks instead, and pays the link wait only when there is a call to make.

  const treeStamp = () => {
    try {
      let newest = 0;
      for (const entry of readdirSync(LOCAL_DIR, {
        recursive: true,
        withFileTypes: true
      })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        const stat = statSync(join(entry.parentPath ?? entry.path, entry.name));
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      }
      return newest;
    } catch {
      return 0;
    }
  };

  const stopChild = () => {
    if (!child) return;
    try {
      child.proc.kill();
    } catch {}
    child = null;
  };

  const startChild = () => new Promise((
    resolve,
    reject
  ) => {
    starts += 1;
    const proc = spawn(RUNNER, [BIN], {
      stdio: [
        'pipe',
        'pipe',
        'pipe'
      ],
      windowsHide: true
    });
    const pending = new Map();
    let buffer = '';
    let error = null;
    let nextId = 0;
    const fail = (reason) => {
      error = reason;
      for (const waiter of pending.values()) waiter.reject(reason);
      pending.clear();
    };
    proc.on('error', (reason) => {
      fail(reason);
      reject(reason);
    });
    proc.on('exit', () => fail(new Error('the tool server stopped')));
    proc.stderr.on('data', () => {});
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          continue;
        }
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(String(message.error.message ?? 'the tool refused')));
        else waiter.resolve(message.result);
      }
    });
    proc.unref?.();
    proc.stdin?.unref?.();
    proc.stdout?.unref?.();
    proc.stderr?.unref?.();
    const busy = () => {
      proc.ref?.();
      proc.stdin?.ref?.();
      proc.stdout?.ref?.();
    };
    const idle = () => {
      proc.unref?.();
      proc.stdin?.unref?.();
      proc.stdout?.unref?.();
      proc.stderr?.unref?.();
    };
    process.once('exit', () => {
      try {
        proc.kill();
      } catch {}
    });
    const api = {
      proc,
      pending: () => pending.size,
      call: (
        name,
        args
      ) => new Promise((
        resolveCall,
        rejectCall
      ) => {
        if (error) {
          rejectCall(error);
          return;
        }
        nextId += 1;
        pending.set(nextId, {
          resolve: (value) => {
            resolveCall(value);
            if (!pending.size) idle();
          },
          reject: (reason) => {
            rejectCall(reason);
            if (!pending.size) idle();
          }
        });
        busy();
        try {
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: nextId,
            method: 'tools/call',
            params: {
              name,
              arguments: args ?? {}
            }
          }) + '\n');
        } catch (reason) {
          pending.delete(nextId);
          idle();
          rejectCall(reason);
        }
      })
    };
    resolve(api);
  });

  const serverFor = async () => {
    if (server) return server;
    await bridgeReachable().catch(() => false);
    server = createMcpServer(createLocalContext({
      warm: true
    }));
    return server;
  };

  const callFor = async (
    name,
    args
  ) => {
    if (call) return call(name, args);
    const now = Date.now();
    if (now - checkedAt > STAMP_EVERY_MS) {
      checkedAt = now;
      newestSeen = treeStamp();
      if (child && newestSeen !== childStamp && child.pending() === 0) stopChild();
    }
    if (!child && now < retryAt) return (await serverFor()).call(name, args);
    if (!child) {
      try {
        child = await startChild();
        childStamp = newestSeen;
      } catch {
        retryAt = Date.now() + RETRY_AFTER_MS;
        return (await serverFor()).call(name, args);
      }
    }
    try {
      return await child.call(name, args);
    } catch {
      stopChild();
      retryAt = Date.now() + RETRY_AFTER_MS;
      return (await serverFor()).call(name, args);
    }
  };

  return {
    id: 'opera.agent',
    async setup(ctx) {
      await ctx.tool.transform((editor) => {
        editor.namespace({
          name: NAMESPACE,
          description: 'Opera Agent drives your own browser: read a page, click, type, and build documents.'
        });
        for (const tool of TOOLS) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.inputSchema,
            options: {
              namespace: NAMESPACE
            },
            execute: async (
              input,
              context
            ) => {
              await allowed(ctx, tool.name, input, context);
              return asNative(await callFor(tool.name, input));
            }
          });
        }
        editor.add({
          name: 'fetch',
          description: FETCH_DESCRIPTION,
          input: FETCH_INPUT,
          options: {
            namespace: NAMESPACE
          },
          execute: async (
            input,
            context
          ) => {
            await allowed(ctx, 'fetch', input, context);
            return operaFetch({
              call: callFor,
              url: input.url,
              waitFor: input.waitFor
            });
          }
        });
      });
    }
  };
}

export default createOperaPlugin();
