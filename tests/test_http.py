import unittest
from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer
import app
from cm import auth, files, tasks
from test_core import IsolatedConfig
from http_support import start_client, login_client


class HttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)

    async def login(self):
        return await login_client(self)

    async def test_health_auth_cookie_logout(self):
        self.assertEqual((await self.client.get('/health')).status, 200)
        self.assertEqual((await self.client.get('/api/me')).status, 401)
        response = await self.login(); self.assertTrue(response.cookies[auth.COOKIE]['httponly'])
        self.assertEqual((await self.client.get('/api/me')).status, 200)
        await self.client.post('/api/logout'); self.assertEqual((await self.client.get('/api/me')).status, 401)

    async def test_sibling_origin_cannot_mutate_or_connect_terminal(self):
        await self.login(); headers = {'Origin': 'https://other.devdj.lat'}
        self.assertEqual((await self.client.post('/api/agent/send', headers=headers, json={})).status, 403)
        self.assertEqual((await self.client.get('/api/term?project=alpha', headers=headers)).status, 403)

    async def test_send_persists_multiline_and_rejects_bad_provider(self):
        await self.login()
        response = await self.client.post('/api/agent/send', json={'project': 'alpha', 'provider': 'codex', 'text': 'Uno\n\tdos'})
        self.assertEqual(response.status, 201); self.assertEqual(tasks.task_records()[0]['details'], 'Uno\n\tdos')
        self.assertEqual((await self.client.post('/api/agent/send', json={'project': 'alpha', 'provider': 'bad', 'text': 'Hola'})).status, 400)

    async def test_file_save_over_json(self):
        await self.login(); files.write_file('alpha', 'test.txt', 'uno')
        data = await (await self.client.get('/api/files/read?project=alpha&path=test.txt')).json()
        response = await self.client.post('/api/files/write', json={'project': 'alpha', 'path': 'test.txt', 'content': 'dos', 'mtime': data['mtime']})
        self.assertEqual(response.status, 200, await response.text()); self.assertEqual(files.read_file('alpha', 'test.txt')['content'], 'dos')

    async def test_upload_explicit_root(self):
        await self.login(); form = FormData(); form.add_field('file', b'hello', filename='hello.txt')
        response = await self.client.post('/api/files/upload?project=alpha&dir=', data=form)
        self.assertEqual(response.status, 201); self.assertEqual((await response.json())['paths'], ['hello.txt'])

    async def test_retry_and_delete_guards(self):
        await self.login(); task = self.task(status='error'); tasks.save_tasks([task])
        response = await self.client.post('/api/tasks', json={'action': 'retry', 'id': task['id']})
        self.assertEqual(response.status, 200); self.assertEqual(tasks.task_records()[0]['status'], 'espera')
        task['status'] = 'working'; tasks.save_tasks([task])
        self.assertEqual((await self.client.post('/api/tasks', json={'action': 'delete', 'id': task['id']})).status, 409)

    async def test_push_key_and_bad_subscription(self):
        self.assertEqual((await self.client.get('/api/push')).status, 401)
        await self.login()
        self.assertEqual(len((await (await self.client.get('/api/push')).json())['public_key']), 87)
        self.assertEqual((await self.client.post('/api/push', json={'subscription': {'endpoint': 'http://localhost'}})).status, 400)

    async def test_delete_requires_auth_origin_and_exact_confirmation(self):
        self.assertEqual((await self.client.post('/api/projects', json={'action': 'delete', 'name': 'alpha', 'confirmation': 'alpha'})).status, 401)
        await self.login()
        self.assertEqual((await self.client.post('/api/projects', json={'action': 'delete', 'name': 'alpha', 'confirmation': 'alpha'}, headers={'Origin': 'https://other.devdj.lat'})).status, 403)
        self.assertEqual((await self.client.post('/api/projects', json={'action': 'delete', 'name': 'alpha', 'confirmation': 'wrong'})).status, 409)
