// @last-edited: 2026-10-11 UTC+7.
// @title: mcp-server — the stdio MCP surface over the local driver.
// @state: 8 locks; the handshake, the advertised tools, and every way a call can fail without killing the server.
// @dependencies: ./driver.js.

// WHY THIS FILE EXISTS
//
// The driver runs in a process with no stdio contract, so nothing that speaks MCP
// can use it. This is that contract, and it is the whole difference between a
// driver that works on the machine it was written on and one that anyone can run
// with npx.
//
// WHY there are no dependencies. The repository runs on stock Node with an empty
// dependency list, and a driver meant for other people's machines is the worst
// place to introduce an install step that can fail on someone else's network. MCP
// over stdio is newline-delimited JSON-RPC, which Node can do unaided.
//
// WHY handle() is a plain function. A server that only exists as a process cannot
// be tested without spawning one, and a test that spawns a real browser fails on
// whoever else's machine runs it. So the protocol lives in a function that takes a
// request and returns a response, and the stdio wrapper below it stays thin enough
// to be obvious by reading.

const PROTOCOL_VERSION = '2024-11-05';

const stringArg = (name) => ({ type: 'string', description: name });
const numberArg = (name) => ({ type: 'number', description: name });

// The surface is only what the driver does well. There is no run_browser_burst and
// no reusable element refs here: those are the cloud server's affordances, and
// pretending a local stdio process has them would advertise something it cannot
// honour. Coordinates and a fresh read per action are honest and sufficient.

export const TOOLS = Object.freeze([
  {
    name: 'browser_status',
    description: 'Report which Chromium browsers are installed and which debugging port is live, before any action.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_tabs',
    description: 'List the page targets the browser currently has open.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'open_url',
    description: 'Open a url in its own tab and return it. Never navigates a tab that is already open, so a drive cannot destroy what the user was reading.',
    inputSchema: { type: 'object', properties: { url: stringArg('absolute url to open') }, required: ['url'] }
  },
  {
    name: 'read_page',
    description: 'Read the focused tab: url, title and visible text. A canvas-rendered page returns little or no text, so pair this with capture_page when the task needs to see content.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'find_elements',
    description: 'Find visible text on the page and return each match with a viewport rect. Coordinates are in the same space capture_page returns, so a rect here can be clicked directly.',
    inputSchema: { type: 'object', properties: { query: stringArg('text to look for') }, required: ['query'] }
  },
  {
    name: 'click',
    description: 'Click a coordinate in the focused tab. The coordinate space is the viewport in CSS pixels, which is what capture_page is clipped to.',
    inputSchema: {
      type: 'object',
      properties: { x: numberArg('viewport x'), y: numberArg('viewport y') },
      required: ['x', 'y']
    }
  },
  {
    name: 'press_key',
    description: 'Send a key with optional modifiers to the focused element, for example a chord or an arrow. Measured against Google editors: the first key after a write is swallowed, so send one harmless key first.',
    inputSchema: {
      type: 'object',
      properties: { key: stringArg('key name'), modifiers: { type: 'array', items: { type: 'string' }, description: 'Control, Alt, Shift, Meta' } },
      required: ['key']
    }
  },
  {
    name: 'type',
    description: 'Insert text into the focused surface, including newlines as real paragraph breaks in a rich editor.',
    inputSchema: { type: 'object', properties: { text: stringArg('text to insert') }, required: ['text'] }
  },
  {
    name: 'capture_page',
    description: 'Capture the focused tab as a JPEG, clipped to the viewport at one pixel per clickable coordinate.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
]);

function requireArguments(args, required) {
  for (const name of required) {
    if (args?.[name] === undefined || args?.[name] === null || args?.[name] === '') {
      throw new Error(`${name} is required`);
    }
  }
}

// A browser that closed mid-call must not take the server with it, because the
// next tool call is still worth trying.

function asText(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

export function createMcpServer(context) {
  const run = async (name, args) => {
    const { driver } = context;
    requireArguments(args, TOOLS.find((t) => t.name === name)?.inputSchema.required ?? []);

    switch (name) {
      case 'browser_status':
        return asText({ browsers: context.browsers, port: context.port });
      case 'list_tabs':
        return asText(await driver.tabs());
      case 'open_url':
        return asText(await driver.open(args.url));
      case 'read_page':
        return asText(await driver.read());
      case 'find_elements':
        return asText(await driver.find(args.query));
      case 'click':
        return asText(await driver.click(args.x, args.y));
      case 'press_key':
        return asText(await driver.key(args.key, args.modifiers ?? []));
      case 'type':
        return asText(await driver.type(args.text));
      case 'capture_page':
        return asText(await driver.capture());
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  return {
    async handle(request) {
      const { id, method, params } = request ?? {};
      const reply = (result) => ({ jsonrpc: '2.0', id, result });
      const fail = (message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });

      try {
        if (method === 'initialize') {
          return reply({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'opera-local', version: context.version ?? '0.0.0' }
          });
        }
        if (method === 'tools/list') return reply({ tools: TOOLS });
        if (method === 'tools/call') return reply(await run(params?.name, params?.arguments ?? {}));

        if (method?.startsWith('notifications/')) return undefined;
        return fail(`Unknown method: ${method}`);
      } catch (error) {
        return fail(error.message);
      }
    }
  };
}

// WHY the loop is line based and never awaits a parse. MCP stdio frames are
// newline-delimited JSON, so a line that is not yet complete is not a frame, and a
// malformed one must be reported rather than thrown, because a throwing read loop
// ends the session over one bad message.

export function startStdio({ input = process.stdin, output = process.stdout, context }) {
  const server = createMcpServer(context);
  let buffer = '';

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      Promise.resolve(server.handle(request)).then((response) => {
        if (response) output.write(`${JSON.stringify(response)}\n`);
      });
    }
  });

  return server;
}