"""Retira únicamente cm-smoke-20261017 y archiva las evidencias en /archive."""
import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path
import aiohttp
from auth_client import login as authenticated_login

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cm import config

PROJECT = 'cm-smoke-20261017'
URL = 'https://codex-dashboard.devdj.lat'


async def main():
    archive = Path('/archive')
    assert archive.is_dir(), 'Monta un directorio de evidencias en /archive'
    async with aiohttp.ClientSession() as session:
        async def api(path, data=None, expected=200):
            async with session.request('POST' if data is not None else 'GET', URL + path, json=data) as response:
                result = await response.json(); assert response.status == expected, (path, result)
                return result
        await authenticated_login(api)
        state = await api('/api/state')
        own = [t for t in state['task_records'] if t['project'] == PROJECT]
        assert not any(t['status'] == 'working' for t in own), 'Hay una prueba en ejecución'
        job = await api('/api/jobs', {'project': PROJECT, 'action': 'down'}, 201)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = await api(f'/api/jobs/{job["job_id"]}')
            if result['status'] != 'running':
                assert result['status'] == 'done', result
                break
            await asyncio.sleep(.5)
        else: raise AssertionError('El apagado no terminó')
        for task in own: await api('/api/tasks', {'action': 'delete', 'id': task['id']})
        for provider in ('claude', 'codex'): await api('/api/agent/reset', {'project': PROJECT, 'provider': provider})
        conversation = await api(f'/api/agent?project={PROJECT}')
        for rule in conversation['rules']: await api('/api/rules', {'project': PROJECT, 'rule': rule})
        for name in (PROJECT + '-shell', PROJECT + '-claude', PROJECT):
            if any(s['name'] == name for s in state['sessions']): await api('/api/term/kill', {'session': name})
        (archive / 'test-tasks.json').write_text(json.dumps(own, ensure_ascii=False, indent=2))
        for kind in ('runs', 'jobs'):
            for folder in (config.CONFIG / kind).iterdir():
                if not folder.is_dir(): continue
                try: meta = json.loads((folder / 'meta.json').read_text())
                except (OSError, ValueError): continue
                if meta.get('project') != PROJECT: continue
                assert (folder / 'exit.json').exists(), f'Proceso sin terminar: {folder}'
                target = archive / ('web-' + kind) / folder.name
                target.parent.mkdir(exist_ok=True)
                assert not target.exists()
                shutil.move(str(folder), str(target))
        project = config.PROJECTS / PROJECT
        assert project.resolve().parent == config.PROJECTS.resolve()
        destination = archive / PROJECT
        assert project.is_dir() and not destination.exists()
        shutil.move(str(project), str(destination))
        print('VALIDATION_CLEANUP_OK: proyecto apagado y archivado; otros proyectos conservados', flush=True)


asyncio.run(main())
