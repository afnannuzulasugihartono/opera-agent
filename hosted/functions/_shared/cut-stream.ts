// @last-edited: 2026-11-11 UTC+7.
// @title: cut-stream - the hosted answer ends the event stream it rides on, and the progress before it still arrives.
// @state: the cut rule, the progress that survives it, and the answer that closes it.
// @dependencies: none.

// WHY THE ANSWER IS FOUND IN THE STREAM AND NOT ASSUMED.
// The transport writes progress events and the answer into one stream, and the answer is the only event that carries an id together with a result or an error.
// Progress events carry no id, so the first message with an id is the answer, and the stream is closed right after that message is written - not before it, so nothing the model should see is cut.

// WHY THE STREAM IS CUT AT ALL.
// Measured on the hosted road: the device completed a command in 414 ms, the function's own leg cost about 950 ms, and the caller still waited about ten seconds.
// The transport's stream stays open after the answer for server-to-client messages, and a client that reads the body before it parses waits for that stream to end - which the edge does when it reaps the invocation, long after the work was done.
// The stream is kept, because progress still rides on it, and closed at the answer.

export function cutStreamAtTheAnswer(body: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value) {
        seen += decoder.decode(value, { stream: true });
        let answer = false;
        for (const line of seen.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          // WHY THE PARSE MAY FAIL: a message split across two chunks is parsed again when the next chunk arrives.
          try {
            const message = JSON.parse(payload) as { id?: unknown; result?: unknown; error?: unknown };
            if (message && message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
              answer = true;
            }
          } catch {
            void 0;
          }
        }
        if (seen.length > 8192) seen = seen.slice(-4096);
        controller.enqueue(value);
        if (answer) {
          controller.close();
        }
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    }
  });
}
