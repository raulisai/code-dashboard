"""Ejercita procesos reales del puente MCP y runner, sin invocar modelos."""
import json
import os
import select
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class HostProcessTests(unittest.TestCase):
    def test_mcp_initialize_approve_deny_and_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'runs' / 'test'; folder.mkdir(parents=True)
            (folder / 'meta.json').write_text(json.dumps({'project': 'test'}))
            process = subprocess.Popen([sys.executable, str(ROOT / 'bin/cm-approval-mcp.py'), str(folder)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            def request(message):
                process.stdin.write((json.dumps(message) + '\n').encode()); process.stdin.flush()
            def response():
                ready, _, _ = select.select([process.stdout], [], [], 5)
                self.assertTrue(ready, 'MCP no respondió en 5 s')
                return json.loads(process.stdout.readline())
            try:
                request({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18'}})
                self.assertEqual(response()['result']['protocolVersion'], '2025-06-18')
                request({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'})
                self.assertEqual(response()['result']['tools'][0]['name'], 'approve')
                for number, decision in enumerate(('allow', 'deny', 'stop'), 3):
                    request({'jsonrpc': '2.0', 'id': number, 'method': 'tools/call', 'params': {'name': 'approve',
                             'arguments': {'tool_name': 'Bash', 'input': {'command': 'echo hola'}}}})
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        pending = [p for p in (folder / 'approvals').glob('*.req.json') if not p.with_name(p.name.replace('.req.json', '.ans.json')).exists()]
                        if pending: break
                        time.sleep(.05)
                    self.assertTrue(pending)
                    if decision == 'stop': (folder / 'stop').write_text('test')
                    else: pending[0].with_name(pending[0].name.replace('.req.json', '.ans.json')).write_text(json.dumps({'decision': decision}))
                    result = json.loads(response()['result']['content'][0]['text'])
                    self.assertEqual(result['behavior'], 'allow' if decision == 'allow' else 'deny')
                    if decision == 'allow': self.assertEqual(result['updatedInput']['command'], 'echo hola')
            finally:
                process.terminate(); process.communicate(timeout=5)

    def run_job(self, folder, argv):
        (folder / 'meta.json').write_text(json.dumps({'kind': 'job', 'argv': argv, 'cwd': str(folder)}))
        return subprocess.Popen([sys.executable, str(ROOT / 'bin/cm-runner.py'), str(folder)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def test_runner_records_output_and_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); process = self.run_job(folder, [sys.executable, '-c', 'print("RUNNER_OK")'])
            process.communicate(timeout=10)
            self.assertEqual(json.loads((folder / 'exit.json').read_text())['code'], 0)
            self.assertIn('RUNNER_OK', (folder / 'output.log').read_text())

    def test_runner_stops_process_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); process = self.run_job(folder, [sys.executable, '-c', 'import time; time.sleep(60)'])
            try:
                deadline = time.monotonic() + 5
                while not (folder / 'pid.json').exists() and time.monotonic() < deadline: time.sleep(.05)
                self.assertTrue((folder / 'pid.json').exists())
                (folder / 'stop').write_text('test'); process.communicate(timeout=20)
                self.assertTrue(json.loads((folder / 'exit.json').read_text())['stopped'])
            finally:
                if process.poll() is None: process.terminate(); process.communicate(timeout=20)

    def test_runner_launch_failure_is_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); process = self.run_job(folder, ['/missing/cm-test-command'])
            process.communicate(timeout=10)
            self.assertEqual(json.loads((folder / 'exit.json').read_text())['code'], 127)
