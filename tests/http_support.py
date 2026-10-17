"""Cliente HTTPS simulado y alta TOTP real, siempre con configuración temporal."""
from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer
import pyotp
import app


async def start_client(test):
    server = TestServer(app.make_app())
    await server.start_server()
    client = TestClient(server, cookie_jar=CookieJar(unsafe=True, treat_as_secure_origin=[server.make_url('/')]))
    await client.start_server()
    test.addAsyncCleanup(client.close)
    return client


async def login_client(test):
    response = await test.client.post('/api/login', json={'user': 'tester', 'password': 'unit-password'})
    test.assertEqual(response.status, 200)
    data = await response.json()
    if data.get('setup_required'):
        setup = await (await test.client.post('/api/security/setup', json={})).json()
        test.auth_secret = setup['secret']
        response = await test.client.post('/api/security/confirm', json={'code': pyotp.TOTP(setup['secret']).now(), 'remember': True})
        test.assertEqual(response.status, 200, await response.text())
        test.recovery_codes = (await response.json())['recovery_codes']
    else:
        response = await test.client.post('/api/login/mfa', json={'challenge': data['challenge'], 'code': test.recovery_codes.pop(), 'remember': True})
        test.assertEqual(response.status, 200, await response.text())
    return response
