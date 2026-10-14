# paper_e2e: builds a mini-thesis in a real Google Doc via run_workflow.
# Manual gate (needs a Google session): prints SKIP loudly without one, never green.
#   py tests/paper_e2e.py

import base64
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELAY = os.path.join(REPO, 'local', 'bin', 'opera-relay.js')

PIXEL_PNG_B64 = (
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA'
    'hKmMIQAAAABJRU5ErkJggg=='
)

STEPS = [
    ('docs.apply_heading', {'level': 1, 'text': 'Mini Thesis Proving Run'}),
    ('docs.make_list', {'kind': 'bullet', 'items': ['alpha', 'beta']}),
    ('docs.insert_table', {'rows': 2, 'cols': 2}),
    ('docs.insert_image', {'source': 'upload', 'filename': 'e2e-pixel.png',
                           'data': 'data:image/png;base64,' + PIXEL_PNG_B64}),
    ('docs.insert_image', {'source': 'url',
                           'imageUrl': 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png'}),
    ('docs.footnote', {'text': 'proof note'}),
    ('docs.header_footer', {'header': 'E2E', 'footer': 'p1', 'pageNumbers': True}),
    ('docs.page_setup', {'margins': {'top': '2.54', 'bottom': '2.54', 'left': '2.54', 'right': '2.54'}}),
    ('docs.toc_insert', {}),
    ('docs.export_pdf', {}),
]


class Mcp:
    def __init__(self):
        env = dict(os.environ)
        self.proc = subprocess.Popen(
            ['node', RELAY], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd=REPO, env=env, text=True, bufsize=1)
        self.next_id = 1
        self.call('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                 'clientInfo': {'name': 'paper-e2e', 'version': '1.0'}})
        self.proc.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n')
        self.proc.stdin.flush()

    def call(self, method, params):
        rid = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params}) + '\n')
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError('relay stdio closed')
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get('id') == rid:
                if 'error' in msg:
                    raise RuntimeError('MCP error: %s' % json.dumps(msg['error'])[:300])
                return msg.get('result')

    def tool(self, name, args, timeout=120):
        import threading
        out = {}
        def run():
            try:
                out['r'] = self.call('tools/call', {'name': name, 'arguments': args})
            except Exception as e:
                out['e'] = e
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        thread.join(timeout)
        if 'r' not in out:
            raise RuntimeError('tool %s timed out after %ss' % (name, timeout))
        if 'e' in out:
            raise out['e']
        return out['r']

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass


def tool_text(reply):
    for block in (reply.get('content') or []):
        if block.get('type') == 'text':
            return block.get('text', '')
    return ''


def fail(message):
    print('paper_e2e FAIL: %s' % message)
    return 1


def main():
    if not os.environ.get('OPERA_AGENT_MCP_TOKEN'):
        print('paper_e2e SKIP: OPERA_AGENT_MCP_TOKEN is not set.')
        return 2
    mcp = Mcp()
    try:
        opened = mcp.tool('open_url', {'url': 'https://docs.new/'}, timeout=60)
        raw = tool_text(opened)
        info = json.loads(raw or '{}')
        tab = info.get('result', {}).get('tab', {}) if isinstance(info.get('result'), dict) else {}
        tab_id = tab.get('id')
        url = str(tab.get('url', ''))
        if 'accounts.google.com' in raw:
            print('paper_e2e SKIP: no Google session (docs.new did not land in a document).')
            return 2
        if not tab_id:
            return fail('could not open a doc tab: %s' % raw[:200])
        print('paper_e2e doc tab %s: %s' % (tab_id, url[:80]))
        for name, args in STEPS:
            started = __import__('time').time()
            reply = mcp.tool('run_workflow', {'name': name, 'input': dict(args, tabId=tab_id),
                                              'timeoutMs': 100000}, timeout=140)
            try:
                body = json.loads(tool_text(reply) or '{}')
            except ValueError:
                return fail('%s returned unparseable output: %s' % (name, tool_text(reply)[:200]))
            ok = body.get('ok') is True and body.get('status') in (None, 'completed', 'ok', True)
            result = body.get('result', {})
            output = result.get('output', result) if isinstance(result, dict) else {}
            if not ok:
                return fail('%s failed: %s' % (name, json.dumps(body)[:400]))
            print('ok %-22s %5dms output=%s' % (name, int((__import__('time').time() - started) * 1000),
                                                json.dumps(output)[:160]))
        print('paper_e2e PASS: mini-thesis built, every workflow completed ok.')
        print('doc tab left open: %s' % url[:100])
        return 0
    finally:
        mcp.close()


if __name__ == '__main__':
    raise SystemExit(main())
