// @last-edited: 2026-11-11 UTC+7.
// @title: mcp-stream-cut - the hosted answer ends the stream it rides on, and the progress before it still arrives.
// @state: the cut rule, the progress that survives it, and the answer that closes it.
// @dependencies: node:test, node:assert/strict.

// WHY THIS GATE EXISTS.
// The hosted MCP transport answers on an event stream, and the stream used to stay open after the answer, so a client that reads the body before it parses waited for the edge to reap the invocation - ten seconds after the device had answered in four hundred milliseconds.
// The stream is still the transport, so progress still rides on it; what changed is that it ends at the answer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cutStreamAtTheAnswer } from '../supabase/functions/_shared/cut-stream.ts';

const encoder = new TextEncoder();

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    }
  });
}

async function readAll(stream) {
  const reader = stream.getReader();
  const out = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(new TextDecoder().decode(value));
  }
  return out.join('');
}

test('the stream ends with the answer, and everything before the answer is still there', async () => {
  const source = streamOf([
    'event: message\ndata: {"method":"notifications/progress","params":{"progress":1}}\n\n',
    'event: message\ndata: {"id":1,"result":{"ok":true}}\n\n',
    'event: message\ndata: {"id":2,"result":{"ok":true}}\n\n'
  ]);
  const text = await readAll(cutStreamAtTheAnswer(source));
  assert.match(text, /notifications\/progress/, 'the progress that came before the answer is still delivered');
  assert.match(text, /"id":1/, 'and the answer is delivered');
  assert.doesNotMatch(text, /"id":2/, 'the stream is closed at the answer, so what follows it never arrives');
});

test('an answer split across two chunks still closes the stream', async () => {
  const source = streamOf([
    'event: message\ndata: {"id":1,"result":{"ok":',
    'true}}\n\n',
    'event: message\ndata: {"id":2,"result":{"ok":true}}\n\n'
  ]);
  const text = await readAll(cutStreamAtTheAnswer(source));
  assert.match(text, /"id":1/, 'the answer is delivered even when the message was split');
  assert.doesNotMatch(text, /"id":2/, 'and the stream is closed right after it');
});

test('the cut happens at a chunk boundary, so one event may ride out with the answer', async () => {
  const source = streamOf([
    'event: message\ndata: {"id":1,"result":{"ok":true}}\n\n',
    'event: message\ndata: {"id":2,"result":{"ok":true}}\n\n'
  ]);
  const text = await readAll(cutStreamAtTheAnswer(source));
  assert.match(text, /"id":1/, 'the answer is delivered');
  assert.doesNotMatch(text, /"id":2/, 'and the stream is closed before the next event is read');
});

test('a stream with no answer in it is delivered whole', async () => {
  const source = streamOf(['event: message\ndata: {"method":"notifications/progress"}\n\n']);
  const text = await readAll(cutStreamAtTheAnswer(source));
  assert.match(text, /notifications\/progress/, 'nothing is cut when the answer never came');
});

test('an error answer closes the stream too', async () => {
  const source = streamOf([
    'event: message\ndata: {"id":7,"error":{"code":"X","message":"no"}}\n\n',
    'event: message\ndata: {"id":8,"result":{"ok":true}}\n\n'
  ]);
  const text = await readAll(cutStreamAtTheAnswer(source));
  assert.match(text, /"id":7/, 'the error answer is delivered');
  assert.doesNotMatch(text, /"id":8/, 'and the stream ends there');
});
