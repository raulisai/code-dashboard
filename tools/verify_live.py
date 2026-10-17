#!/usr/bin/env python3
"""Validación HTTP/WS contra el despliegue; requiere MONITOR_USER/PASSWORD.

Crea únicamente cm-smoke-20261017. No modifica otros proyectos ni los ajustes.
"""
import asyncio
import json
import os
import time
from pathlib import Path

import aiohttp
from auth_client import login as authenticated_login

URL = os.environ.get('CM_TEST_URL', 'https://codex-dashboard.devdj.lat')
PROJECT = 'cm-smoke-20261017'


async def main():
    async with aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar()) as session:
        async def api(path, data=None, expected=200):
            async with session.request('POST' if data is not None else 'GET', URL + path, json=data, timeout=aiohttp.ClientTimeout(total=40)) as response:
                result = await response.json()
                assert response.status == expected, (path, response.status, result)
                return result
        await authenticated_login(api)
        state = await api('/api/state')
        assert state['tmux_ok'] and state['docker_ok']
        exists = any(p['name'] == PROJECT for p in state['projects'])
        assert not exists or os.environ.get('CM_TEST_RESUME') == '1', 'El proyecto de prueba ya existe; no se sobrescribe'
        if not exists:
            await api('/api/projects', {'action': 'create', 'name': PROJECT, 'description': 'Validación temporal del panel', 'stack': 'web', 'build': False, 'deploy': True}, 201)
        print('PROJECT_CREATED', flush=True)
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            jobs = (await api(f'/api/jobs?project={PROJECT}'))['jobs']
            if jobs and jobs[0]['status'] != 'running':
                assert jobs[0]['status'] == 'done', jobs[0]
                break
            await asyncio.sleep(1)
        else: raise AssertionError('Despliegue sin terminar')
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                async with session.get(f'https://{PROJECT}.devdj.lat', timeout=20) as response:
                    if response.status == 200 and 'Validación temporal' in await response.text(): break
            except aiohttp.ClientError: pass  # primera emisión del certificado de Let's Encrypt
            await asyncio.sleep(2)
        else: raise AssertionError('El HTTPS del proyecto no está listo')
        print('DEPLOY_HTTPS_OK', flush=True)
        for path in ('/manifest.webmanifest', '/sw.js', '/p/' + PROJECT):
            async with session.get(URL + path) as response: assert response.status == 200, path
        listing = await api(f'/api/files/list?project={PROJECT}')
        assert any(e['name'] == 'README.md' for e in listing['entries'])
        doc = await api(f'/api/files/read?project={PROJECT}&path=README.md')
        await api('/api/files/write', {'project': PROJECT, 'path': 'README.md', 'content': doc['content'] + '\nPrueba del editor HTTP.\n', 'mtime': doc['mtime']})
        assert (await api(f'/api/git?project={PROJECT}'))['files']
        assert 'Prueba del editor' in (await api(f'/api/git/diff?project={PROJECT}&path=README.md'))['diff']
        await api('/api/git', {'project': PROJECT, 'action': 'commit', 'message': 'Prueba HTTP del editor'})
        assert not (await api(f'/api/git?project={PROJECT}'))['files']
        print('FILES_GIT_OK', flush=True)
        async with session.ws_connect(URL.replace('https:', 'wss:') + f'/api/term?project={PROJECT}&kind=shell', heartbeat=15, headers={'Origin': URL}) as ws:
            output = bytearray(); sent = False
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                message = await ws.receive(timeout=15)
                if message.type == aiohttp.WSMsgType.TEXT:
                    info = json.loads(message.data)
                    assert info.get('t') != 'error', info
                    if info.get('t') == 'ready':
                        await ws.send_json({'t': 'i', 'd': "printf 'CM_%s\\n' 'TERM_OK'\r"}); sent = True
                elif message.type == aiohttp.WSMsgType.BINARY:
                    output.extend(message.data)
                    if b'CM_TERM_OK' in output: break
                elif message.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
                    raise AssertionError(f'Terminal desconectada: {output.decode(errors="replace")}')
            else: raise AssertionError(f'Terminal sin respuesta: {output.decode(errors="replace")}')
            assert sent
        print('TERMINAL_WS_OK', flush=True)
        task = (await api('/api/agent/send', {'project': PROJECT, 'provider': 'codex', 'text': 'No uses herramientas ni comandos. Recuerda CM_WEB_185 y responde solo WEB_OK.'}, 201))['task']
        async def await_task(task_id):
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                state = await api('/api/state')
                record = next(t for t in state['task_records'] if t['id'] == task_id)
                if record['status'] in ('terminado', 'error'): return record
                await asyncio.sleep(1)
            raise AssertionError('Petición sin terminar')
        finished = await await_task(task['id'])
        assert finished['status'] == 'terminado', finished
        task = (await api('/api/agent/send', {'project': PROJECT, 'provider': 'codex', 'text': 'Sin herramientas ni comandos, responde el código que te pedí recordar.'}, 201))['task']
        finished = await await_task(task['id'])
        assert 'CM_WEB_185' in finished['result'], finished
        print('CODEX_WEB_RESUME_OK', flush=True)
        task = (await api('/api/agent/send', {'project': PROJECT, 'provider': 'claude', 'text': 'No uses herramientas. Responde solo WEB_OK.'}, 201))['task']
        finished = await await_task(task['id'])
        print(json.dumps({'claude_status': finished['status'], 'result': finished['result']}, ensure_ascii=False), flush=True)
        print('LIVE_VALIDATION_OK', flush=True)


asyncio.run(main())
