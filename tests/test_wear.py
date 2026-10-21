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

    def test_recent_lists_approvals_first_then_latest_finished_work_newest_first(self):
        done = lambda name, status, at: {'id': name, 'project': 'alpha', 'provider': 'claude', 'title': name, 'status': status, 'finished_at': at}
        records = [done('viejo', 'terminado', '2026-10-20 08:00:00 CEST'), done('fallo', 'error', '2026-10-20 09:30:00 CEST'),
                   done('nuevo', 'terminado', '2026-10-20 10:00:00 CEST'), done('activo', 'working', ''), done('cola', 'espera', '')]
        rows = wear.recent(records, [{'project': 'beta', 'provider': 'codex'}], limit=4)
        self.assertEqual([row['kind'] for row in rows], ['approval', 'terminado', 'error', 'terminado'])
        self.assertEqual([row['title'] for row in rows[1:]], ['nuevo', 'fallo', 'viejo'])
        self.assertEqual(rows[0]['project'], 'beta')
        self.assertGreater(rows[1]['at'], rows[2]['at'])
        self.assertEqual(wear.stamp('sin fecha'), 0)
        self.assertEqual(wear.recent([done('x', 'terminado', '')], [])[0]['at'], 0)

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

    def test_project_send_shares_chat_and_rejects_cross_project_retry(self):
        from cm import chats
        _, session = self.link()
        chat = chats.create('alpha', 'Desde el reloj')
        first = wear.send(session['id'], 'project-request-12345', 'Lee el README', 'alpha', chat['id'], 'codex')
        second = wear.send(session['id'], 'project-request-12345', 'Lee el README', 'alpha', chat['id'], 'codex')
        self.assertEqual(first['task']['id'], second['task']['id'])
        self.assertTrue(second['duplicate'])
        record, = tasks.task_records()
        self.assertEqual((record['project'], record['chat_id'], record['provider']), ('alpha', chat['id'], 'codex'))
        for project, chat_id in [('beta', 'main'), ('../alpha', 'main'), ('alpha', 'missing')]:
            with self.assertRaises(auth.AuthError): wear.send(session['id'], 'project-request-12345', 'Lee el README', project, chat_id, 'codex')

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

    async def test_dashboard_views_require_device_and_keep_allowlist(self):
        from cm import projects, quota
        token = await self.linked(); headers = {'Authorization': 'Bearer ' + token}
        self.assertEqual((await self.client.get('/api/wear/view?view=settings')).status, 401)
        finished = {'id': 't1', 'project': 'alpha', 'provider': 'codex', 'title': 'Actualizar tienda', 'status': 'terminado', 'finished_at': '2026-10-20 10:00:00 CEST'}
        with patch.object(projects, 'snapshot', return_value={'projects': [{'name': 'alpha'}], 'task_records': [finished], 'approvals': []}):
            home = await (await self.client.get('/api/wear/view?view=home', headers=headers)).json()
            self.assertEqual(home['projects'], 1)
            self.assertEqual(home['approvals'], 0)
            self.assertEqual([(row['kind'], row['project'], row['title']) for row in home['recent']], [('terminado', 'alpha', 'Actualizar tienda')])
            catalog = await (await self.client.get('/api/wear/view?view=projects', headers=headers)).json()
            self.assertEqual(catalog['projects'][0]['name'], 'alpha')
        self.assertEqual((await self.client.get('/api/wear/view?view=security', headers=headers)).status, 404)
        self.assertEqual((await self.client.get('/api/wear/view?view=files&project=../alpha', headers=headers)).status, 400)
        with patch.object(quota, 'read', return_value={'claude': {'windows': [{'used': 25, 'minutes': 300}]}}):
            self.assertEqual((await (await self.client.get('/api/wear/view?view=quota', headers=headers)).json())['claude']['windows'][0]['used'], 25)

    async def test_watch_actions_reuse_body_validation_and_existing_chat_logic(self):
        from cm import chats
        token = await self.linked(); headers = {'Authorization': 'Bearer ' + token}
        body = {'tool': 'chats', 'action': 'create', 'project': 'alpha', 'title': 'Reloj'}
        self.assertEqual((await self.client.post('/api/wear/action', json=body, headers=headers)).status, 400)
        body['confirmed'] = True
        response = await self.client.post('/api/wear/action', json=body, headers=headers)
        self.assertEqual(response.status, 201, await response.text())
        self.assertEqual(chats.list_chats('alpha')[-1]['title'], 'Reloj')
        self.assertEqual((await self.client.post('/api/wear/action', json={'confirmed': True, 'tool': 'security'}, headers=headers)).status, 404)

    async def test_terminal_snapshot_is_read_only_and_project_scoped(self):
        token = await self.linked(); headers = {'Authorization': 'Bearer ' + token}
        with patch.object(tmux, 'pane_state', return_value={'exists': True}), patch.object(tmux, 'tmux', return_value=(0, 'hello\n', '')) as command, patch.object(tmux, 'new_session') as create:
            response = await self.client.get('/api/wear/view?view=terminal&project=alpha&kind=shell&session=beta-shell', headers=headers)
            self.assertEqual((await response.json())['output'], 'hello\n')
            self.assertIn('=alpha-shell:', command.call_args.args)
            create.assert_not_called()

    async def test_files_paginate_and_keep_optimistic_edit_conflicts(self):
        token = await self.linked(); headers = {'Authorization': 'Bearer ' + token}
        root = config.PROJECTS / 'alpha'
        for i in range(45): (root / f'{i:02}.txt').write_text('original')
        data = await (await self.client.get('/api/wear/view?view=files&project=alpha', headers=headers)).json()
        self.assertEqual(len(data['entries']), 40); self.assertEqual(data['next'], 40)
        page = await (await self.client.get('/api/wear/view?view=files&project=alpha&offset=40', headers=headers)).json()
        self.assertEqual(len(page['entries']), 5); self.assertIsNone(page['next'])
        with patch('cm.gitops.versioned', side_effect=lambda project, title, source, fn: fn()):
            response = await self.client.post('/api/wear/action', headers=headers, json={'tool': 'write', 'confirmed': True, 'project': 'alpha', 'path': '00.txt', 'content': 'changed', 'mtime': 'outdated'})
        self.assertEqual(response.status, 409)
        self.assertEqual((root / '00.txt').read_text(), 'original')

    async def test_run_activity_cannot_cross_project_and_terminal_commands_use_literal_tmux_input(self):
        token = await self.linked(); headers = {'Authorization': 'Bearer ' + token}
        meta = self.run_meta(project='alpha')
        response = await self.client.get('/api/wear/view?view=run&project=beta&run_id=' + meta['id'], headers=headers)
        self.assertEqual(response.status, 404)
        with patch('app.terminal_session', return_value=('alpha-shell', None)), patch.object(tmux, 'tmux', return_value=(0, '', '')) as command:
            response = await self.client.post('/api/wear/action', headers=headers, json={'tool': 'terminal', 'confirmed': True, 'project': 'alpha', 'kind': 'shell', 'command': 'printf hello'})
            self.assertEqual(response.status, 200)
            self.assertEqual(command.call_args_list[0].args, ('send-keys', '-t', '=alpha-shell:', '-l', '--', 'printf hello'))
            self.assertEqual(command.call_args_list[1].args, ('send-keys', '-t', '=alpha-shell:', 'Enter'))


if __name__ == '__main__': unittest.main()
