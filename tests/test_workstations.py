import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import secrets
import time
import unittest
from unittest.mock import patch

from cm import auth, config, workstations as ws
from test_core import IsolatedConfig
from http_support import start_client, login_client


class WorkstationTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()

    def device(self, projects=None):
        pair = ws.create_enrollment('Windows Android', projects or ['alpha'])
        token = secrets.token_urlsafe(32)
        info = ws.enroll(pair['code'], token)
        return pair, token, info['device_id']

    def enqueue(self, device, key='idempotencia-00000001'):
        return ws.enqueue(device, 'alpha', 'claude', 'Implementa la pantalla Android', key)

    def test_pairing_retries_and_no_plain_secrets(self):
        pair, token, device = self.device()
        self.assertEqual(ws.enroll(pair['code'], token)['device_id'], device)
        with self.assertRaises(auth.AuthError): ws.enroll(pair['code'], secrets.token_urlsafe(32))
        raw = (config.CONFIG / 'workstations.sqlite3').read_bytes()
        self.assertNotIn(token.encode(), raw)
        self.assertNotIn(pair['code'].encode(), raw)
        self.assertEqual(ws.authenticate(token)['kind'], 'workstation')
        self.assertNotIn('token_hash', json.dumps(ws.overview()))

    def test_pairing_expiry_and_revocation(self):
        pair = ws.create_enrollment('Windows', ['alpha'])
        with patch.object(ws.time, 'time', return_value=pair['expires'] + 1):
            with self.assertRaises(auth.AuthError): ws.enroll(pair['code'], secrets.token_urlsafe(32))
        _, token, device = self.device()
        ws.revoke(device)
        with self.assertRaises(auth.AuthError): ws.authenticate(token)

    def test_password_rotation_invalidates_device(self):
        _, token, _ = self.device()
        with patch.object(config, 'PASSWORD', 'otra-clave'):
            with self.assertRaises(auth.AuthError): ws.authenticate(token)

    def test_atomic_claim_and_enqueue_idempotence(self):
        _, token, device = self.device()
        with ThreadPoolExecutor(max_workers=5) as pool:
            ids = list(pool.map(lambda _: self.enqueue(device)['id'], range(5)))
        self.assertEqual(len(set(ids)), 1)
        with ThreadPoolExecutor(max_workers=5) as pool:
            claims = list(pool.map(lambda _: ws.poll(token, ['alpha'])['job'], range(5)))
        self.assertEqual(sum(job is not None for job in claims), 1)
        self.assertEqual(len(ws.overview()['jobs']), 1)
        with self.assertRaises(auth.AuthError): ws.enqueue(device, 'alpha', 'claude', 'otra tarea', 'idempotencia-00000001')

    def test_project_and_provider_allowlist(self):
        _, token, device = self.device()
        with self.assertRaises(auth.AuthError): ws.enqueue(device, 'beta', 'claude', 'Tarea', 'idempotencia-00000001')
        with self.assertRaises(auth.AuthError): ws.enqueue(device, 'alpha', 'shell', 'Tarea', 'idempotencia-00000001')
        self.enqueue(device)
        self.assertIsNone(ws.poll(token, ['beta'])['job'])
        self.assertIsNotNone(ws.poll(token, ['alpha'])['job'])

    def test_stolen_lease_cannot_cross_devices(self):
        _, token, device = self.device()
        _, other_token, _ = self.device()
        self.enqueue(device)
        job = ws.poll(token, ['alpha'])['job']
        with self.assertRaises(auth.AuthError): ws.heartbeat(other_token, job['id'], job['lease'])
        with self.assertRaises(auth.AuthError): ws.finish(other_token, job['id'], job['lease'], {'status': 'completed'})

    def test_cancel_revocation_and_expired_lease_never_requeue(self):
        _, token, device = self.device()
        first = self.enqueue(device)
        job = ws.poll(token, ['alpha'])['job']
        ws.cancel(first['id'])
        self.assertTrue(ws.heartbeat(token, job['id'], job['lease'])['cancel'])
        result = {'status': 'cancelled', 'summary': 'Cancelada localmente'}
        ws.finish(token, job['id'], job['lease'], result)
        ws.finish(token, job['id'], job['lease'], result)
        with self.assertRaises(auth.AuthError): ws.finish(token, job['id'], job['lease'], {'status': 'completed'})
        self.enqueue(device, 'idempotencia-00000002')
        job = ws.poll(token, ['alpha'])['job']
        with patch.object(ws.time, 'time', return_value=time.time() + ws.LEASE_SECONDS + 1):
            self.assertIsNone(ws.poll(token, ['alpha'])['job'])
            self.assertEqual(ws.overview()['jobs'][0]['status'], 'interrupted')
            with self.assertRaises(auth.AuthError): ws.heartbeat(token, job['id'], job['lease'])
        self.assertIsNone(ws.poll(token, ['alpha'])['job'])

    def test_invalid_payloads_and_result_limits(self):
        for name, projects in (('', ['alpha']), ('PC', []), ('PC', ['../beta'])):
            with self.assertRaises(auth.AuthError): ws.create_enrollment(name, projects)
        _, token, device = self.device()
        for value in (None, {}, '../bad'):
            with self.assertRaises(auth.AuthError): ws.cancel(value)
            with self.assertRaises(auth.AuthError): ws.revoke(value)
        self.enqueue(device)
        job = ws.poll(token, ['alpha'])['job']
        for result in ({'status': 'completed', 'summary': 'x' * 24001},
                       {'status': 'completed', 'token': 'no'}, {'status': 'running'}):
            with self.assertRaises(auth.AuthError): ws.finish(token, job['id'], job['lease'], result)

    def test_root_scope_requires_local_root_capability_and_preserves_mode(self):
        _, token, device = self.device(['*'])
        new = ws.enqueue(device, 'new_android', 'claude', 'Crea la aplicación', 'root-scope-key-0001', 'new')
        self.assertIsNone(ws.poll(token, [])['job'])
        job = ws.poll(token, [], True)['job']
        self.assertEqual(job['id'], new['id'])
        self.assertEqual(job['project_mode'], 'new')
        with self.assertRaises(auth.AuthError):
            ws.enqueue(device, 'new_android', 'claude', 'Crea la aplicación', 'root-scope-key-0001', 'existing')
        with self.assertRaises(auth.AuthError):
            ws.enqueue(device, '../escape', 'claude', 'Tarea', 'root-scope-key-0002')

    def test_root_capability_does_not_expand_server_allowlist(self):
        _, token, device = self.device(['alpha'])
        with self.assertRaises(auth.AuthError): ws.enqueue(device, 'other', 'claude', 'Tarea', 'root-scope-key-0001')
        job = self.enqueue(device)
        self.assertEqual(ws.poll(token, [], True)['job']['id'], job['id'])

    def test_legacy_clients_do_not_receive_new_project_modes(self):
        _, token, device = self.device()
        ws.enqueue(device, 'alpha', 'claude', 'Tarea', 'root-scope-key-0001', 'new')
        self.assertIsNone(ws.poll(token, ['alpha'])['job'])
        job = ws.poll(token, ['alpha'], project_modes=True)['job']
        self.assertEqual(job['project_mode'], 'new')


class WorkstationHTTPTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)

    async def test_mfa_pairing_and_strict_device_scope(self):
        response = await self.client.post('/api/workstations', json={'action': 'enroll', 'label': 'PC', 'projects': ['alpha']})
        self.assertEqual(response.status, 401)
        await login_client(self)
        response = await self.client.post('/api/workstations', json={'action': 'enroll', 'label': 'PC', 'projects': ['alpha']})
        self.assertEqual(response.status, 201)
        pair = await response.json()
        token = secrets.token_urlsafe(32)
        # El endpoint de alta es público; no se aprovecha la cookie web para autorizarlo.
        self.client.session.cookie_jar.clear()
        response = await self.client.post('/api/workstation/enroll', json={'code': pair['code'], 'token': token})
        self.assertEqual(response.status, 200)
        headers = {'Authorization': 'Bearer ' + token}
        response = await self.client.post('/api/workstation/poll', json={'projects': ['alpha']}, headers=headers)
        self.assertEqual(response.status, 200)
        for path in ('/api/state', '/api/tasks', '/api/workstations', '/api/wear/state'):
            response = await self.client.get(path, headers=headers)
            self.assertIn(response.status, (401, 403))
        response = await self.client.post('/api/workstation/poll', json={'projects': ['alpha']}, headers={**headers, 'Origin': 'https://evil.invalid'})
        self.assertEqual(response.status, 403)
        response = await self.client.post('/api/workstation/poll', json={'projects': ['alpha']})
        self.assertEqual(response.status, 401)

    async def test_non_mfa_web_session_cannot_create_connector(self):
        response = await self.client.post('/api/login', json={'user': 'tester', 'password': 'unit-password'})
        self.assertEqual(response.status, 200)
        response = await self.client.post('/api/workstations', json={'action': 'enroll', 'label': 'PC', 'projects': ['alpha']})
        self.assertEqual(response.status, 403)
