// @last-edited: 2026-10-31 UTC+7.
// @title: opera-opencode — the opera-local surface as native OpenCode tools.
// @state: the registrations the plugin makes, the fetch it runs, and the browser every tool drives.
// @dependencies: ../tools.js, ../mcp-server.js, ../context.js, ../bridge.js.

import { TOOLS } from '../tools.js';
import { createMcpServer } from '../mcp-server.js';
import { createLocalContext } from '../context.js';
import { bridgeReachable } from '../bridge.js';

const NAMESPACE = 'opera';

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

  // WHY THE BRIDGE IS ASKED FOR HERE AND NOT AT LOAD.
  // A plugin that binds a port when OpenCode starts would take the machine's bridge whether the browser is used or not.
  // The first call asks instead, and pays the link wait only when there is a call to make.

  const serverFor = async () => {
    if (server) return server;
    await bridgeReachable().catch(() => false);
    server = createMcpServer(createLocalContext());
    return server;
  };

  const callFor = async (
    name,
    args
  ) => {
    if (call) return call(name, args);
    return (await serverFor()).call(name, args);
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
