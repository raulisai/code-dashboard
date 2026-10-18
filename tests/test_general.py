import json
import unittest
from unittest.mock import patch
from cm import config, push, runs, tasks, tmux
from test_core import IsolatedConfig
from http_support import start_client, login_client


class GeneralAgentTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        (config.PROJECTS / 'alpha' / 'README.md').write_text('# Alpha\n\nTienda de tacos en línea.\n')

    def start(self, provider, **changes):
        with patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, message, run_id = runs.start_run(self.task(project=config.GENERAL, provider=provider, **changes))
        self.assertTrue(ok, message)
        return runs.run_meta(run_id), (config.RUNS / run_id / 'prompt.txt').read_text()

    def test_runs_from_projects_root_without_versioning_and_knows_projects(self):
        meta, _ = self.start('claude')
        self.assertEqual(meta['cwd'], config.HOST_PROJECTS)
        self.assertFalse(meta['versioning'])
        self.assertIn('agente general', meta['system_prompt'])
        self.assertIn('- alpha: Tienda de tacos en línea.', meta['system_prompt'])
        self.assertIn('- beta:', meta['system_prompt'])
        self.assertIn('Nuevo proyecto', meta['system_prompt'])
        self.assertIn('el texto solo se muestra si el usuario lo pide', meta['system_prompt'])

    def test_codex_gets_catalog_on_first_and_resumed_messages(self):
        _, first = self.start('codex')
        self.assertIn('Tienda de tacos', first)
        runs.set_agent_session(config.GENERAL, 'codex', 'thread-1')
        meta, resumed = self.start('codex')
        self.assertEqual(meta['resume_id'], 'thread-1')
        self.assertTrue(resumed.startswith('[Contexto de Codex Manager] Proyectos actuales: alpha, beta.'))
        self.assertIn('una a tres frases cortas', resumed)

    def test_regular_projects_keep_their_folder_and_versioning(self):
        with patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, run_id = runs.start_run(self.task())
        meta = runs.run_meta(run_id)
        self.assertTrue(ok)
        self.assertEqual(meta['cwd'], f'{config.HOST_PROJECTS}/alpha')
        self.assertEqual(meta['versioning'], runs.load_settings()['auto_commit'] == 'on')

    def test_claude_tool_times_come_from_stream_timestamps(self):
        events, _ = runs.normalize_claude([
            {'type': 'assistant', 'timestamp': '2026-10-17T10:00:00.000Z', 'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': 'npm test'}}]}},
            {'type': 'user', 'timestamp': '2026-10-17T10:00:12.500Z', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'ok'}]}},
            {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 't2', 'name': 'Read', 'input': {}}]}},
        ])
        self.assertEqual(events[0]['t1'] - events[0]['t0'], 12.5)
        self.assertIsNone(events[1]['t0'])

    def test_notifications_link_to_general_view(self):
        tasks.save_tasks([self.task(project=config.GENERAL, status='terminado', run_id='r1')])
        event = [payload for key, payload in push.notifications() if key.startswith('task:')][0]
        self.assertEqual((event['body'], event['url']), ('Agente general', '/agent?chat=main'))


class GeneralAgentHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)

    async def test_chat_endpoints_accept_general_but_not_unknown_projects(self):
        self.assertEqual((await self.client.get(f'/api/agent?project={config.GENERAL}')).status, 401)
        await login_client(self)
        response = await self.client.post('/api/agent/send', json={'project': config.GENERAL, 'provider': 'claude', 'text': '¿Cómo está el servidor?'})
        self.assertEqual(response.status, 201, await response.text())
        task, = tasks.task_records()
        self.assertEqual((task['project'], task['chat_id']), (config.GENERAL, 'main'))
        data = await (await self.client.get(f'/api/agent?project={config.GENERAL}&chat_id=main')).json()
        self.assertEqual([t['id'] for t in data['queue']], [task['id']])
        self.assertEqual((await self.client.get(f'/api/agent/chats?project={config.GENERAL}')).status, 200)
        for project in ('_otro', '../alpha', 'gamma'):
            response = await self.client.post('/api/agent/send', json={'project': project, 'provider': 'codex', 'text': 'Hola'})
            self.assertEqual(response.status, 400, project)
        self.assertEqual(len(tasks.task_records()), 1)
        response = await self.client.post('/api/agent/reset', json={'project': config.GENERAL, 'chat_id': 'main', 'provider': 'claude'})
        self.assertEqual(response.status, 400, json.dumps(await response.json()))


if __name__ == '__main__':
    unittest.main()
