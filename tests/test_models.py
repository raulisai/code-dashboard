import unittest
from unittest.mock import patch
from cm import config, runs, tasks, tmux, modelcatalog
from test_core import IsolatedConfig, runner
from cm.util import write_json
from http_support import start_client, login_client


class ModelTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        write_json(config.CONFIG / 'model-catalog.json', {'codex': [{'id':'custom-model-v1', 'efforts':['low','high']}], 'claude': [{'id':'sonnet', 'efforts':['medium','high']}], 'defaults': {'codex':'custom-model-v1', 'claude':'sonnet'}})

    def test_cli_arguments_apply_effort_with_resume(self):
        self.assertEqual(modelcatalog.supported_efforts('codex', 'custom-model-v1'), ['low','high'])
        self.assertEqual(modelcatalog.supported_efforts('codex', 'unknown'), [])
        argv = runner.codex_command({'cwd':'/tmp', 'model':'custom-model-v1', 'effort':'high', 'resume_id':'thread'})
        self.assertIn('model_reasoning_effort="high"', argv)
        self.assertLess(argv.index('-c'), argv.index('resume'))
        argv = runner.claude_command({'model':'sonnet', 'effort':'medium', 'permission':'auto'}, config.CONFIG)
        self.assertEqual(argv[argv.index('--effort')+1], 'medium')
        self.assertNotIn('--effort', runner.claude_command({'permission':'auto'}, config.CONFIG))


    def test_queued_models_round_trip_and_override_only_their_run(self):
        rows = [self.task(provider='claude', model='sonnet', effort='medium'), self.task(provider='codex', model='custom-model-v1', effort='high')]
        tasks.save_tasks(rows)
        self.assertEqual([t['model'] for t in tasks.task_records()], ['sonnet', 'custom-model-v1'])
        settings = runs.load_settings()
        for task in tasks.task_records():
            with patch.object(tmux, 'new_session', return_value=(True, '')):
                ok, _, run_id = runs.start_run(task)
            self.assertTrue(ok)
            self.assertEqual(runs.run_meta(run_id)['model'], task['model'])
            self.assertEqual(runs.run_meta(run_id)['effort'], task['effort'])
        self.assertEqual(settings, runs.load_settings())

    def test_legacy_rows_and_general_keep_default(self):
        task = self.task(provider='claude')
        tasks.save_tasks([task])
        config.TASKS.write_text('\t'.join(config.TASKS.read_text().rstrip('\n').split('\t')[:14]) + '\n')
        self.assertEqual(tasks.task_records()[0]['model'], '')
        task.update(project=config.GENERAL, model='custom-model')
        with patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, run_id = runs.start_run(task)
        self.assertTrue(ok)
        self.assertEqual(runs.run_meta(run_id)['model'], runs.load_settings()['claude_model'])


class ModelHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        write_json(config.CONFIG / 'model-catalog.json', {'codex': [{'id':'custom-model-v1', 'efforts':['low','high']}], 'claude': [{'id':'sonnet', 'efforts':['medium','high']}], 'defaults': {'codex':'custom-model-v1', 'claude':'sonnet'}})
        self.client = await start_client(self)
        await login_client(self)

    async def test_model_is_bound_to_each_message(self):
        for provider, model in [('claude', 'sonnet'), ('codex', 'custom-model-v1')]:
            response = await self.client.post('/api/agent/send', json={'project':'alpha', 'provider':provider, 'text':'Hola', 'model':model})
            self.assertEqual(response.status, 201, await response.text())
        self.assertEqual([t['model'] for t in tasks.task_records()], ['sonnet', 'custom-model-v1'])

    async def test_invalid_and_general_overrides_rejected(self):
        for model in ['--bad option', 'x'*81, {}, None, 'a\nb']:
            response = await self.client.post('/api/agent/send', json={'project':'alpha', 'provider':'codex', 'text':'Hola', 'model':model})
            self.assertEqual(response.status, 400)
        response = await self.client.post('/api/agent/send', json={'project':config.GENERAL, 'provider':'codex', 'text':'Hola', 'model':'custom-model'})
        self.assertEqual(response.status, 400)
        self.assertEqual(tasks.task_records(), [])

    async def test_catalog_and_effort_compatibility(self):
        response = await self.client.get('/api/models')
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['codex'][0]['efforts'], ['low','high'])
        payload = {'project':'alpha','provider':'codex','text':'Hola','model':'custom-model-v1','effort':'high'}
        response = await self.client.post('/api/agent/send', json=payload)
        self.assertEqual(response.status, 201)
        self.assertEqual(tasks.task_records()[0]['effort'], 'high')
        for effort in ['ultra', '--bad', 3, None]:
            response = await self.client.post('/api/agent/send', json={**payload,'effort':effort})
            self.assertEqual(response.status,400)
        response = await self.client.post('/api/agent/send', json={**payload,'project':config.GENERAL,'model':''})
        self.assertEqual(response.status,400)
        await self.client.post('/api/logout',json={})
        self.assertEqual((await self.client.get('/api/models')).status,401)
