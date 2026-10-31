#!/usr/bin/env node

// @last-edited: 2026-10-31 UTC+7.
// @title: opera-local — the installed entry point: a local CDP driver behind an MCP stdio server.
// @state: binds the protocol to a real browser and to the environment it was given.
// @dependencies: ../context.js, ../mcp-server.js, ../bridge.js.

// WHY THE SERVER SPEAKS MCP AND THE DRIVER SPEAKS CDP.
// This file is the only place the two are joined, and it is separate so the protocol stays testable without a browser.
// The context that carries the driver lives in ../context.js, so the OpenCode plugin drives the same browser through the same code.

import { bridgeReachable } from '../bridge.js';
import { startStdio } from '../mcp-server.js';
import { createLocalContext } from '../context.js';

// WHY THE BRIDGE LISTENS BEFORE THE FIRST TOOL CALL.
// A lazy server makes the first command pay the whole link wait, and leaves the extension polling a dead port until then.
// Listening here links the worker while the client is still shaking hands.
// A failure is swallowed on purpose: the port may belong to another session, and every tool call retries with a named error anyway.

await bridgeReachable().catch(() => false);

// WHY THE STARTUP PROBE MAY NOT KILL THE SERVER.
// Asking which pipe is right is asking whether a port is free, and the honest answer to "another driver owns it" is to say so.
// Dying here instead said it by refusing to start at all, which is what happened when the person toggled the server on while a previous instance was still holding the loopback port: the conflict was real and the only visible result was a dead MCP with a stack trace instead of a server that starts and names the conflict on the first tool call.

startStdio({
  context: createLocalContext()
});
