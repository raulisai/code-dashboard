import json
import secrets
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from cm import chats, config, dockerapi, lifecycle, runs, tasks, tmux
from cm.util import write_json
from test_core import IsolatedConfig
from http_support import start_client, login_client


class ChatTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_legacy_tsv_and_sessions_stay_in_main(self):
        task = self.task(details='línea\n\tcódigo\\new')
        config.TASKS.write_text('\t'.join(tasks.encode(task[k]) for k in tasks.FIELDS[:13]) + '\n')
        restored = tasks.task_records()[0]
        self.assertEqual(restored['chat_id'], 'main')
        self.assertEqual(restored['details'], task['details'])
        runs.set_agent_session('alpha', 'codex', 'old-thread')
        chat = chats.create('alpha', 'Diseño')
        self.assertEqual(runs.chat_sessions('alpha')['codex']['id'], 'old-thread')
        self.assertEqual(runs.chat_sessions('alpha', chat['id']), {})

    def test_concurrent_creation_and_session_updates(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            created = list(pool.map(lambda i: chats.create('alpha', f'Chat {i}'), range(16)))
            list(pool.map(lambda c: runs.set_agent_session('alpha', 'codex', c['title'], c['id']), created))
        self.assertEqual(len(chats.list_chats('alpha')), 17)
        for chat in created:
            self.assertEqual(runs.chat_sessions('alpha', chat['id'])['codex']['id'], chat['title'])
        self.assertEqual(runs.chat_sessions('alpha'), {})

    def test_resume_scoped_to_chat_for_both_providers(self):
        chat = chats.create('alpha')['id']
        for provider in ('codex', 'claude'):
            runs.set_agent_session('alpha', provider, 'main-context')
            runs.set_agent_session('alpha', provider, 'other-context', chat)
            with patch.object(tmux, 'new_session', return_value=(True, '')):
                ok, _, run_id = runs.start_run(self.task(provider=provider, chat_id=chat))
            self.assertTrue(ok)
            meta = runs.run_meta(run_id)
            self.assertEqual(meta['resume_id'], 'other-context')
            self.assertEqual(meta['chat_id'], chat)
            self.assertEqual(runs.chat_sessions('alpha')[provider]['id'], 'main-context')

    def test_filter_before_history_limit_and_legacy_history(self):
        legacy = self.run_meta()
        for _ in range(4): self.run_meta(chat_id='another')
        self.assertEqual([m['id'] for m in runs.list_runs('alpha', limit=1, chat_id='main')], [legacy['id']])
        self.assertEqual([r['id'] for r in runs.conversation('alpha')], [legacy['id']])
        self.assertNotEqual(runs.conversation_revision('alpha'), runs.conversation_revision('alpha', 'another'))

    def test_scheduler_serializes_each_chat_but_not_other_chats(self):
        other = chats.create('alpha')['id']
        rows = [self.task(), self.task(), self.task(chat_id=other)]
        tasks.save_tasks(rows)
        with patch.object(tmux, 'host_server_ok', return_value=True), patch.object(runs, 'start_run', return_value=(True, 'ok', 'fake')) as start:
            runs.tick()
        self.assertEqual(start.call_count, 2)
        self.assertEqual([t['status'] for t in tasks.task_records()], ['working', 'espera', 'working'])

    def test_reset_only_selected_chat_and_blocks_queued_messages(self):
        other = chats.create('alpha')['id']
        runs.set_agent_session('alpha', 'codex', 'main-context')
        runs.set_agent_session('alpha', 'codex', 'other-context', other)
        tasks.save_tasks([self.task()])
        self.assertFalse(runs.reset_conversation('alpha', 'codex')[0])
        self.assertTrue(runs.reset_conversation('alpha', 'codex', other)[0])
        self.assertEqual(runs.chat_sessions('alpha')['codex']['id'], 'main-context')
        self.assertEqual(runs.chat_sessions('alpha', other), {})

    def test_rename_and_validation_project_boundaries(self):
        chat = chats.create('alpha', 'Diseño')
        chats.rename('alpha', chat['id'], 'Correcciones')
        self.assertEqual(chats.list_chats('alpha')[1]['title'], 'Correcciones')
        for project, identifier in [('beta', chat['id']), ('alpha', '../../etc'), ('alpha', [])]:
            with self.assertRaises(ValueError): chats.require(project, identifier)
        with self.assertRaises(ValueError): chats.rename('alpha', 'main', 'otro')

    def test_finalize_saves_returned_thread_only_to_its_chat(self):
        chat = chats.create('alpha')['id']
        runs.set_agent_session('alpha', 'codex', 'main-thread')
        meta = self.run_meta(chat_id=chat)
        write_json(config.RUNS / meta['id'] / 'exit.json', {'code': 0})
        with patch.object(runs, 'run_events', return_value=([], {'session_id': 'new-thread', 'result': {'text': 'Listo'}})):
            runs._finalize(self.task(chat_id=chat), meta)
        self.assertEqual(runs.chat_sessions('alpha')['codex']['id'], 'main-thread')
        self.assertEqual(runs.chat_sessions('alpha', chat)['codex']['id'], 'new-thread')

    def test_project_deletion_preserves_catalog_for_recovery_and_clears_all_contexts(self):
        chat = chats.create('alpha', 'Diseño')
        runs.set_agent_session('alpha', 'codex', 'thread', chat['id'])
        with patch.object(dockerapi, 'project_containers', return_value=[]), patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, job_id = lifecycle.start_delete('alpha', 'alpha')
        self.assertTrue(ok)
        recovery = runs.job_meta(job_id)['recovery']
        self.assertEqual(recovery['chats'], [chat])
        self.assertNotIn('alpha', runs.agent_sessions())
        self.assertNotIn('alpha', chats.catalog())
        archive = config.PROJECTS / '.cm-trash' / runs.new_id()
        archive.mkdir(parents=True)
        (config.PROJECTS / 'alpha').rename(archive / 'project')
        write_json(archive / 'meta.json', {'project': 'alpha', 'recovery': recovery})
        self.assertTrue(lifecycle.restore(archive.name)[0])
        self.assertEqual(chats.catalog()['alpha'], [chat])
        self.assertEqual(runs.chat_sessions('alpha', chat['id']), {})

    def finished_run(self, provider, chat_id, request, answer, session, path='index.html', created_at=None):
        # Los identificadores reales empiezan por la hora de creación: el historial se ordena por ellos.
        created_at = created_at or time.time() - 30
        identifier = time.strftime('%Y%m%d-%H%M%S', time.localtime(created_at)) + '-' + secrets.token_hex(3)
        meta = self.run_meta(provider=provider, chat_id=chat_id, id=identifier, created_at=created_at)
        (config.RUNS / meta['id'] / 'request.txt').write_text(request)
        return self.complete(meta, answer, session, path)

    def complete(self, meta, answer, session, path='index.html'):
        provider, folder = meta['provider'], config.RUNS / meta['id']
        full = f"{meta['cwd']}/{path}"
        if provider == 'codex':
            rows = [{'type': 'thread.started', 'thread_id': session},
                    {'type': 'item.completed', 'item': {'id': 'f', 'type': 'file_change', 'changes': [{'path': full, 'kind': 'update'}], 'status': 'completed'}},
                    {'type': 'item.completed', 'item': {'id': 'm', 'type': 'agent_message', 'text': answer}}, {'type': 'turn.completed', 'usage': {}}]
        else:
            rows = [{'type': 'system', 'subtype': 'init', 'session_id': session},
                    {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 'e', 'name': 'Edit', 'input': {'file_path': full}}]}},
                    {'type': 'result', 'subtype': 'success', 'result': answer}]
        (folder / 'events.jsonl').write_text('\n'.join(json.dumps(row) for row in rows) + '\n')
        write_json(folder / 'exit.json', {'code': 0})
        runs.set_agent_session('alpha', provider, session, meta.get('chat_id', 'main'))
        return meta

    def start(self, provider, chat_id, text):
        with patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, run_id = runs.start_run(self.task(provider=provider, chat_id=chat_id, origin='chat', details=text))
        self.assertTrue(ok)
        folder = config.RUNS / run_id
        return runs.run_meta(run_id), (folder / 'prompt.txt').read_text(), (folder / 'request.txt').read_text()

    def test_switching_provider_hands_over_unseen_turns_of_the_same_chat(self):
        chat = chats.create('alpha', 'Diseño')['id']
        self.finished_run('codex', 'main', 'Otro chat', 'No debe aparecer', 'main-thread', created_at=time.time() - 90)
        self.finished_run('codex', chat, 'Pon el botón azul', 'Botón azul listo', 'thread-1', 'src/app.css', created_at=time.time() - 60)
        meta, prompt, request = self.start('claude', chat, 'Ahora hazlo redondo')
        self.assertEqual(request, 'Ahora hazlo redondo')
        self.assertTrue(prompt.startswith('[Contexto de Codex Manager: continuidad del chat]'))
        self.assertTrue(prompt.endswith('[Mensaje actual del usuario]\nAhora hazlo redondo'))
        for expected in ('Pon el botón azul', 'Codex respondió: Botón azul listo', 'Archivos modificados: src/app.css'):
            self.assertIn(expected, prompt)
        self.assertNotIn('No debe aparecer', prompt)
        self.assertEqual(meta['handoff'], 1)
        self.assertEqual(runs.describe_run(meta, full=False)['prompt'], 'Ahora hazlo redondo')
        # Claude respondió; al volver a Codex solo recibe lo que hizo Claude, no su propio turno.
        self.complete(meta, 'Bordes redondeados', meta['session_id'], 'src/button.css')
        time.sleep(1.01)  # identificador de la siguiente ejecución en otro segundo, como en el uso real
        meta, prompt, _ = self.start('codex', chat, 'Revisa en celular')
        self.assertEqual(meta['resume_id'], 'thread-1')
        self.assertIn('Claude respondió: Bordes redondeados', prompt)
        self.assertNotIn('Botón azul listo', prompt)
        self.assertEqual(meta['handoff'], 1)

    def test_same_provider_continuing_gets_no_extra_context(self):
        self.finished_run('codex', 'main', 'Primero', 'Hecho', 'thread-1')
        meta, prompt, request = self.start('codex', 'main', 'Segundo')
        self.assertEqual((prompt, request, meta.get('handoff')), ('Segundo', 'Segundo', None))

    def test_new_session_receives_whole_chat_and_reset_starts_clean(self):
        self.finished_run('codex', 'main', 'Primero', 'Hecho 1', 'thread-1', created_at=time.time() - 60)
        self.finished_run('claude', 'main', 'Segundo', 'Hecho 2', 'session-2', created_at=time.time() - 30)
        runs.set_agent_session('alpha', 'claude', '')  # p. ej. sesión perdida por un error de cuota
        meta, prompt, _ = self.start('claude', 'main', 'Tercero')
        self.assertEqual(meta['handoff'], 2)
        self.assertLess(prompt.index('Hecho 1'), prompt.index('Hecho 2'))
        tasks.save_tasks([])
        self.assertTrue(runs.reset_conversation('alpha', 'codex')[0])
        self.assertEqual(runs.chat_sessions('alpha'), {})
        meta, prompt, _ = self.start('codex', 'main', 'Desde cero')
        self.assertNotIn('continuidad del chat', prompt)
        self.assertTrue(prompt.startswith('[Contexto de Codex Manager] '))

    def test_chat_processes_one_message_at_a_time_even_across_providers(self):
        tasks.save_tasks([self.task(provider='codex'), self.task(provider='claude')])
        with patch.object(tmux, 'host_server_ok', return_value=True), patch.object(runs, 'start_run', return_value=(True, 'ok', 'fake')) as start:
            runs.tick()
        self.assertEqual(start.call_count, 1)
        self.assertEqual([t['status'] for t in tasks.task_records()], ['working', 'espera'])

    def test_delete_chat_cancels_queue_forgets_context_and_archives(self):
        keep, chat = chats.create('alpha', 'Otro')['id'], chats.create('alpha', 'Equivocado')['id']
        runs.set_agent_session('alpha', 'codex', 'thread', chat)
        runs.set_agent_session('alpha', 'codex', 'kept', keep)
        tasks.save_tasks([self.task(chat_id=chat, status='working')])
        with self.assertRaises(ValueError): chats.delete('alpha', chat)
        tasks.save_tasks([self.task(chat_id=chat), self.task(chat_id=keep)])
        self.assertIn('Equivocado', chats.delete('alpha', chat))
        self.assertEqual([c['id'] for c in chats.list_chats('alpha')], ['main', keep])
        self.assertEqual([t['status'] for t in tasks.task_records()], ['error', 'espera'])
        self.assertEqual(runs.chat_sessions('alpha', chat), {})
        self.assertEqual(runs.chat_sessions('alpha', keep)['codex']['id'], 'kept')
        archived = chats.archive()['alpha'][0]
        self.assertEqual((archived['id'], archived['sessions']['codex']['id'], archived['cancelled']), (chat, 'thread', 1))
        with self.assertRaises(ValueError): chats.require('alpha', chat)
        with self.assertRaises(ValueError): chats.delete('beta', keep)

    def test_clearing_main_hides_history_and_resets_both_agents(self):
        old = self.finished_run('codex', 'main', 'Viejo', 'Hecho', 'thread', created_at=time.time() - 30)
        runs.set_agent_session('alpha', 'claude', 'session')
        chats.delete('alpha', 'main')
        self.assertEqual(chats.list_chats('alpha')[0]['id'], 'main')
        self.assertEqual(runs.conversation('alpha'), [])
        self.assertEqual(runs.chat_sessions('alpha'), {})
        self.assertTrue((config.RUNS / old['id'] / 'meta.json').exists())
        meta, prompt, _ = self.start('codex', 'main', 'Nuevo')
        self.assertNotIn('Viejo', prompt)
        self.assertEqual([r['id'] for r in runs.conversation('alpha')], [meta['id']])


class ChatHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)

    async def test_authenticated_create_send_filter_rename_and_restore_selection(self):
        self.assertEqual((await self.client.get('/api/agent/chats?project=alpha')).status, 401)
        await login_client(self)
        response = await self.client.post('/api/agent/chats', json={'project': 'alpha', 'title': 'Diseño'})
        self.assertEqual(response.status, 201)
        chat = (await response.json())['chat']['id']
        for identifier in ['main', chat]:
            response = await self.client.post('/api/agent/send', json={'project': 'alpha', 'chat_id': identifier, 'text': identifier, 'provider': 'codex'})
            self.assertEqual(response.status, 201)
        for identifier in ['main', chat]:
            response = await self.client.get(f'/api/agent?project=alpha&chat_id={identifier}')
            self.assertEqual(response.status, 200)
            payload = await response.json()
            self.assertEqual([t['details'] for t in payload['queue']], [identifier])
            same = await (await self.client.get(f'/api/agent?project=alpha&chat_id={identifier}&rev={payload["rev"]}')).json()
            self.assertTrue(same['same'])
        response = await self.client.post('/api/agent/chats', json={'project': 'alpha', 'action': 'rename', 'chat_id': chat, 'title': 'Errores'})
        self.assertEqual(response.status, 200)
        rows = (await (await self.client.get('/api/agent/chats?project=alpha')).json())['chats']
        self.assertEqual(rows[1]['title'], 'Errores')
        self.assertEqual(rows[1]['queued'], 1)
        for project, identifier in [('beta', chat), ('alpha', 'bad'), ('alpha', [])]:
            response = await self.client.post('/api/agent/send', json={'project': project, 'chat_id': identifier, 'text': 'no'})
            self.assertEqual(response.status, 404)
        self.assertEqual(len(tasks.task_records()), 2)
        self.assertEqual((await self.client.post('/api/agent/chats', json={'project': 'alpha'}, headers={'Origin': 'https://evil.example'})).status, 403)
        response = await self.client.post('/api/agent/chats', json={'project': 'alpha', 'action': 'delete', 'chat_id': chat})
        self.assertEqual(response.status, 200)
        self.assertEqual([c['id'] for c in (await (await self.client.get('/api/agent/chats?project=alpha')).json())['chats']], ['main'])
        self.assertEqual((await self.client.get(f'/api/agent?project=alpha&chat_id={chat}')).status, 404)
        self.assertEqual((await self.client.post('/api/agent/chats', json={'project': 'alpha', 'action': 'delete', 'chat_id': chat})).status, 400)
        self.assertEqual((await self.client.post('/api/agent/chats', json={'project': 'alpha', 'action': 'delete', 'chat_id': 'main'}, headers={'Origin': 'https://evil.example'})).status, 403)
