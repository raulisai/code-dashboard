"""Prueba aprobaciones web con MCP real y detener/reintentar un Codex real.

Ejecutar en la imagen con .env y /config montado; solo usa cm-smoke-20261017.
"""
import asyncio
import json
import os
import sys
import time
from pathlib import Path
import aiohttp
from auth_client import login as authenticated_login
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cm import config, runs
from cm.util import write_json

URL = 'https://codex-dashboard.devdj.lat'
PROJECT = 'cm-smoke-20261017'


async def main():
    async with aiohttp.ClientSession() as session:
        async def post(path, data, expected=200):
            async with session.post(URL + path, json=data) as response:
                value = await response.json(); assert response.status == expected, value
                return value
        async def get(path):
            async with session.get(URL + path) as response:
                assert response.status == 200; return await response.json()
        await authenticated_login(post)
        meta = {'id': runs.new_id(), 'project': PROJECT, 'provider': 'claude', 'kind': 'agent', 'created_at': time.time()}
        folder = config.RUNS / meta['id']; write_json(folder / 'meta.json', meta)
        (folder / 'prompt.txt').write_text('Prueba sintética del puente MCP y de las aprobaciones HTTP, sin invocar el modelo.')
        process = await asyncio.create_subprocess_exec(sys.executable, '/src/bin/cm-approval-mcp.py', str(folder),
                                                       stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
        async def request(message):
            process.stdin.write((json.dumps(message) + '\n').encode()); await process.stdin.drain()
        async def response(): return json.loads(await asyncio.wait_for(process.stdout.readline(), 8))
        try:
            await request({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18'}}); await response()
            for index, (command, decision, remember) in enumerate((('echo CM_ALLOW', 'allow', True), ('echo CM_ALLOW', 'allow', False), ('echo CM_DENY', 'deny', False)), 2):
                await request({'jsonrpc': '2.0', 'id': index, 'method': 'tools/call', 'params': {'name': 'approve',
                               'arguments': {'tool_name': 'Bash', 'input': {'command': command}}}})
                if index != 3:
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        run = await get(f'/api/runs/{meta["id"]}')
                        if run['approvals']: break
                        await asyncio.sleep(.15)
                    else: raise AssertionError('No llegó la solicitud de aprobación')
                    await post('/api/approvals', {'run_id': meta['id'], 'request_id': run['approvals'][0]['id'], 'decision': decision, 'remember': remember})
                result = json.loads((await response())['result']['content'][0]['text'])
                assert result['behavior'] == decision
            print('WEB_MCP_ALLOW_REMEMBER_DENY_OK', flush=True)
        finally:
            process.terminate(); await process.wait()
            write_json(folder / 'exit.json', {'code': 0, 'finished_at': time.time()})
        task = (await post('/api/agent/send', {'project': PROJECT, 'provider': 'codex',
                    'text': 'Prueba de detener. Usa la terminal únicamente para ejecutar sleep 60. No cambies archivos ni ejecutes ningún otro comando.'}, 201))['task']
        async def await_record(statuses):
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                state = await get('/api/state')
                record = next(t for t in state['task_records'] if t['id'] == task['id'])
                if record['status'] in statuses: return record
                await asyncio.sleep(.5)
            raise AssertionError('No cambió el estado de la tarea')
        for attempt in range(2):
            if attempt: await post('/api/tasks', {'action': 'retry', 'id': task['id']})
            record = await await_record(('working', 'error'))
            assert record['status'] == 'working', record
            await post(f'/api/runs/{record["run_id"]}/stop', {})
            finished = await await_record(('terminado', 'error'))
            run = await get(f'/api/runs/{record["run_id"]}')
            assert run['status'] == 'stopped', run
        print('WEB_CODEX_STOP_RETRY_OK', flush=True)


asyncio.run(main())
