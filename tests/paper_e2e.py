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


def words_of(name, args):
    if name == 'docs.apply_heading':
        return len(str(args.get('text', '')).split())
    if name == 'docs.make_list':
        return sum(len(str(item).split()) for item in args.get('items', []))
    return 0


PROOFS = {
    'docs.apply_heading': lambda o: o.get('applied') is True,
    'docs.make_list': lambda o: o.get('verified') is True,
    'docs.insert_table': lambda o: o.get('verified') is True,
    'docs.insert_image': lambda o: bool(o.get('placed')),
    'docs.footnote': lambda o: bool(o.get('noteId')),
    'docs.header_footer': lambda o: bool(o.get('header')) and bool(o.get('pageNumbers')),
    'docs.page_setup': lambda o: bool(o.get('applied')),
    'docs.toc_insert': lambda o: bool(o.get('entries')),
    'docs.export_pdf': lambda o: bool(o.get('downloaded')),
}


# WHY open_doc RETRIES. One command can be claimed and lost in transit, and one
# tabs.open can time out while the tab it opened stays open. Both leave the run
# recoverable, so opening a doc tries three times before it ends the run.


def open_doc(mcp, attempts=3):
    last = ''
    for attempt in range(attempts):
        try:
            opened = mcp.tool('open_url', {'url': 'https://docs.new/', 'timeoutMs': 30000}, timeout=90)
            raw = tool_text(opened)
        except Exception as error:
            last = str(error)
            continue
        info = json.loads(raw or '{}')
        tab = info.get('result', {}).get('tab', {}) if isinstance(info.get('result'), dict) else {}
        tab_id = tab.get('id')
        url = str(tab.get('url', ''))
        if 'accounts.google.com' in raw:
            raise RuntimeError('NO_GOOGLE_SESSION')
        if tab_id and '/edit' in url:
            return tab_id, url
        last = raw[:200]
    raise RuntimeError('could not open a doc tab: %s' % last)


def step_input(name, args, words):
    if name == 'docs.make_list':
        return dict(args, expectedWords='Words %d' % (words + words_of(name, args)))
    return dict(args)


def run_step(mcp, name, args, tab_id):
    started = __import__('time').time()
    reply = mcp.tool('run_workflow', {'name': name, 'input': dict(args, tabId=tab_id),
                                      'timeoutMs': 100000}, timeout=140)
    elapsed = int((__import__('time').time() - started) * 1000)
    try:
        body = json.loads(tool_text(reply) or '{}')
    except ValueError:
        return False, {}, 'unparseable output: %s' % tool_text(reply)[:200]
    ok = body.get('ok') is True and body.get('status') in (None, 'completed', 'ok', True)
    result = body.get('result', {})
    output = result.get('output', result) if isinstance(result, dict) else {}
    if not ok:
        return False, output, '%s failed: %s' % (name, json.dumps(body)[:400])
    proof = PROOFS.get(name)
    if proof is not None and not proof(output if isinstance(output, dict) else {}):
        return False, output, '%s proof missing: output=%s' % (name, json.dumps(output)[:300])
    return True, output, '%5dms output=%s' % (elapsed, json.dumps(output)[:160])


def main():
    if not os.environ.get('OPERA_AGENT_MCP_TOKEN'):
        print('paper_e2e SKIP: OPERA_AGENT_MCP_TOKEN is not set.')
        return 2
    mcp = Mcp()
    try:
        try:
            tab_id, url = open_doc(mcp)
        except RuntimeError as error:
            if str(error) == 'NO_GOOGLE_SESSION':
                print('paper_e2e SKIP: no Google session (docs.new did not land in a document).')
                return 2
            return fail(str(error))
        print('paper_e2e doc tab %s: %s' % (tab_id, url[:80]))
        words = 0
        for index, (name, args) in enumerate(STEPS):
            passed = False
            for attempt in (1, 2, 3):
                if attempt > 1:
                    try:
                        tab_id, url = open_doc(mcp)
                    except RuntimeError as error:
                        print('retry %s attempt %d: %s' % (name, attempt, error))
                        continue
                    words = 0
                    replayed = True
                    for pname, pargs in STEPS[:index]:
                        ok, _, detail = run_step(mcp, pname, step_input(pname, pargs, words), tab_id)
                        if not ok:
                            print('retry %s attempt %d replay %s failed: %s' % (name, attempt, pname, detail[:160]))
                            replayed = False
                            break
                        words += words_of(pname, pargs)
                    if not replayed:
                        continue
                    print('retry %s attempt %d on fresh tab %s' % (name, attempt, tab_id))
                ok, _, detail = run_step(mcp, name, step_input(name, args, words), tab_id)
                if ok:
                    words += words_of(name, args)
                    print('ok %-22s %s' % (name, detail))
                    passed = True
                    break
                print('retry %s attempt %d failed: %s' % (name, attempt, detail[:200]))
            if not passed:
                return fail('%s failed after 3 attempts (fresh doc plus prefix replay each).' % name)
        print('paper_e2e PASS: mini-thesis built, every workflow completed ok.')
        print('doc tab left open: %s' % url[:100])
        return 0
    finally:
        mcp.close()


if __name__ == '__main__':
    raise SystemExit(main())
