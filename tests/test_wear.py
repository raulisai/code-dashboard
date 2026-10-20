import asyncio
import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from cm import auth, config, runs, tasks, tmux, wear
from test_core import IsolatedConfig
from http_support import start_client, login_client


class WearTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        wear._retry.clear()
        wear._oauth.clear()

    def link(self):
        pair = wear.start_pair('ip')
        wear.approve_pair(pair['code'])
        token = wear.poll_pair(pair['secret'])['token']
        session = wear.authenticate(token)
        return token, session

    def test_pair_requires_approval_and_recovers_lost_response_until_first_authenticated_use(self):
        pair = wear.start_pair('ip')
        self.assertEqual(wear.poll_pair(pair['secret']), {'status': 'pending'})
        self.assertEqual(len(pair['code']), 8)
        wear.approve_pair(pair['code'])
        first = wear.poll_pair(pair['secret'])
        self.assertEqual(first['token'], wear.poll_pair(pair['secret'])['token'])
        with self.assertRaises(auth.AuthError): wear.approve_pair(pair['code'])
        self.assertTrue(wear.authenticate(first['token'])['mfa'])
        with self.assertRaises(auth.AuthError): wear.poll_pair(pair['secret'])

    def test_database_never_contains_plain_device_secret_or_session_token(self):
        pair = wear.start_pair('ip'); wear.approve_pair(pair['code'])
        token = wear.poll_pair(pair['secret'])['token']
        raw = (config.CONFIG / 'web-auth.sqlite3').read_bytes()
        self.assertNotIn(token.encode(), raw)
        self.assertNotIn(pair['secret'].encode(), raw)

    def test_expired_and_bruteforced_pairing(self):
        pair = wear.start_pair('ip')
        with patch.object(wear.time, 'time', return_value=pair['expires'] + 1):
            with self.assertRaises(auth.AuthError): wear.poll_pair(pair['secret'])
            with self.assertRaises(auth.AuthError): wear.approve_pair(pair['code'])
        for _ in range(5): wear.start_pair('ip')
        with self.assertRaises(auth.AuthError) as caught: wear.start_pair('ip')
        self.assertEqual(caught.exception.status, 429)

    def test_unclaimed_pairing_session_is_revoked_at_expiry(self):
        pair = wear.start_pair('ip'); wear.approve_pair(pair['code'])
        token = wear.poll_pair(pair['secret'])['token']
        with patch.object(wear.time, 'time', return_value=pair['expires'] + 1):
            wear.start_pair('another-ip')
        self.assertIsNone(wear.authenticate(token))

    def test_revocation_password_change_and_regular_sessions(self):
        token, session = self.link()
        self.assertIsNotNone(wear.authenticate(token))
        with patch.object(config, 'PASSWORD', 'changed'): self.assertIsNone(wear.authenticate(token))
        auth.revoke_sessions('browser', session['id'])
        self.assertIsNone(wear.authenticate(token))
        with auth._db() as db: browser = auth._new_session(db, mfa=True)
        self.assertIsNone(wear.authenticate(browser['token']))

    def test_concurrent_retries_queue_exactly_one_general_task_and_preserve_default_provider(self):
        _, session = self.link()
        runs.save_settings({'default_provider': 'claude'})
        with patch('cm.availability.choose', side_effect=lambda provider: provider):
            with ThreadPoolExecutor(max_workers=6) as pool:
                values = list(pool.map(lambda _: wear.send(session['id'], 'request-1234567890', 'Trabaja en alpha'), range(6)))
        self.assertEqual(len(tasks.task_records()), 1)
        task = tasks.task_records()[0]
        self.assertEqual((task['project'], task['chat_id'], task['provider'], task['origin']), (config.GENERAL, 'main', 'claude', 'wear'))
        self.assertEqual(tasks.task_prompt(task), 'Trabaja en alpha')
        self.assertEqual(sum(not value['duplicate'] for value in values), 1)
        with self.assertRaises(auth.AuthError): wear.send(session['id'], 'request-1234567890', 'Otro texto')

    def test_invalid_messages_and_queue_limit(self):
        _, session = self.link()
        for ident, text in [('', 'Hola'), ('request-1234567890', ''), ('request-1234567890', 'x' * 4001), ('request-1234567890', {})]:
            with self.assertRaises(auth.AuthError): wear.send(session['id'], ident, text)
        tasks.save_tasks([self.task(project=config.GENERAL) for _ in range(8)])
        with self.assertRaises(auth.AuthError) as caught: wear.send(session['id'], 'request-1234567890', 'Hola')
        self.assertEqual(caught.exception.status, 429)

    def test_snapshot_is_bounded_and_does_not_expose_server_settings(self):
        _, session = self.link()
        meta = self.run_meta(project=config.GENERAL)
        (config.RUNS / meta['id'] / 'events.jsonl').write_text(json.dumps({'type': 'turn.completed'}) + '\n')
        tasks.save_tasks([self.task(title='Cambiar tienda'), self.task(project=config.GENERAL, run_id=meta['id'], status='working')])
        data = wear.snapshot(session['id'])
        self.assertEqual(data['state'], 'working')
        self.assertEqual(data['last_task']['title'], 'Cambiar tienda')
        self.assertNotIn('settings', data)
        self.assertNotIn('events', data)
        self.assertNotIn('provider', data['task'])
        self.assertEqual(wear.plain('Listo\n```cm-ui\n{"secret":true}\n```'), 'Listo')

    def test_watch_prompt_reuses_general_and_injects_compact_real_queue(self):
        tasks.save_tasks([self.task(title='Última tarea real', status='terminado')])
        task = self.task(project=config.GENERAL, origin='wear', details='¿Cómo va?')
        with patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, run_id = runs.start_run(task)
        self.assertTrue(ok)
        prompt = (config.RUNS / run_id / 'prompt.txt').read_text()
        self.assertIn('Galaxy Watch / Wear OS', prompt)
        self.assertIn('Última tarea real', prompt)
        self.assertEqual(runs.run_meta(run_id)['cwd'], config.HOST_PROJECTS)

    def test_notifications_default_to_attention_group_and_honor_revocation(self):
        _, session = self.link()
        wear.preferences(session['id'], 'attention', 'fcm-token')
        with patch.object(wear, 'service_account_path', return_value=config.SECRET_FILE), patch.object(wear, 'fcm_send', return_value=True) as sender:
            tasks.save_tasks([self.task(project=config.GENERAL, status='terminado', run_id='r1')])
            wear.deliver_once(); sender.assert_not_called()
            records = tasks.task_records() + [self.task(project=config.GENERAL, status='error', run_id='r2'), self.task(project=config.GENERAL, status='error', run_id='r3')]
            tasks.save_tasks(records); wear.deliver_once(); wear.deliver_once()
            self.assertEqual(sender.call_count, 1)
            self.assertIn('r3', sender.call_args.args[1])
            auth.revoke_sessions('browser', session['id'])
            tasks.save_tasks(records + [self.task(project=config.GENERAL, status='error', run_id='r4')]); wear.deliver_once()
            self.assertEqual(sender.call_count, 1)

    def test_notification_failure_is_retried_and_does_not_mark_seen(self):
        _, session = self.link(); wear.preferences(session['id'], 'all', 'token')
        tasks.save_tasks([self.task(project=config.GENERAL, status='terminado')])
        with patch.object(wear, 'service_account_path', return_value=config.SECRET_FILE), patch.object(wear, 'fcm_send', side_effect=RuntimeError('failed')) as sender:
            wear.deliver_once(); wear.deliver_once(); self.assertEqual(sender.call_count, 1)
        wear._retry.clear()
        with patch.object(wear, 'service_account_path', return_value=config.SECRET_FILE), patch.object(wear, 'fcm_send', return_value=True) as sender:
            wear.deliver_once(); self.assertEqual(sender.call_count, 1)


class WearHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); self.client = await start_client(self)

    async def linked(self):
        pair = await (await self.client.post('/api/wear/pair/start', json={})).json()
        await login_client(self)
        self.assertEqual((await self.client.post('/api/wear/pair/approve', json={'code': pair['code']})).status, 200)
        value = await (await self.client.post('/api/wear/pair/poll', json={'secret': pair['secret']})).json()
        return value['token']

    async def test_approval_requires_mfa_and_matching_origin(self):
        pair = await (await self.client.post('/api/wear/pair/start', json={})).json()
        self.assertEqual((await self.client.post('/api/wear/pair/approve', json={'code': pair['code']})).status, 401)
        await login_client(self)
        self.assertEqual((await self.client.post('/api/wear/pair/approve', json={'code': pair['code']}, headers={'Origin': 'https://evil.example'})).status, 403)
        self.assertEqual(wear.poll_pair(pair['secret'])['status'], 'pending')

    async def test_bearer_and_cookie_cannot_escape_device_scope(self):
        token = await self.linked()
        headers = {'Authorization': 'Bearer ' + token}
        self.assertEqual((await self.client.get('/api/wear/state', headers=headers)).status, 200)
        self.assertEqual((await self.client.get('/api/wear/state')).status, 401)
        self.client.session.cookie_jar.clear()
        for path in ('/api/state', '/api/security', '/api/files/list', '/api/agent?project=_general'):
            self.assertEqual((await self.client.get(path, headers=headers)).status, 403)
            self.assertEqual((await self.client.get(path, headers={'Cookie': f'{auth.COOKIE}={token}'})).status, 403)
        response = await self.client.post('/api/wear/send', json={'request_id': 'request-1234567890', 'text': '¿Qué proyectos tenemos?'}, headers=headers)
        self.assertEqual(response.status, 201)
        self.assertEqual((await self.client.post('/api/wear/disconnect', json={}, headers=headers)).status, 200)
        self.assertEqual((await self.client.get('/api/wear/state', headers=headers)).status, 401)

    async def test_body_limits_and_bad_json(self):
        response = await self.client.post('/api/wear/pair/start', json={'label': 'x' * 17000})
        self.assertEqual(response.status, 413)
        self.assertEqual((await self.client.post('/api/wear/pair/start', json=[])).status, 400)


if __name__ == '__main__': unittest.main()
