import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import app
from cm import speech
from test_core import IsolatedConfig
from http_support import start_client, login_client


class SpeechHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); self.client = await start_client(self)

    async def login(self):
        return await login_client(self)

    async def test_voice_requires_auth_and_same_origin(self):
        self.assertEqual((await self.client.post('/api/voice/transcribe', data=b'a' * 100)).status, 401)
        await self.login()
        self.assertEqual((await self.client.post('/api/voice/transcribe', data=b'a' * 100, headers={'Origin': 'https://other.devdj.lat'})).status, 403)

    async def test_rejects_bad_format_empty_audio_and_language(self):
        await self.login()
        self.assertEqual((await self.client.post('/api/voice/transcribe', data=b'abc', headers={'Content-Type': 'text/html'})).status, 415)
        self.assertEqual((await self.client.post('/api/voice/transcribe', data=b'abc', headers={'Content-Type': 'audio/webm'})).status, 400)
        self.assertEqual((await self.client.post('/api/voice/transcribe?language=bad', data=b'a' * 100, headers={'Content-Type': 'audio/webm'})).status, 400)

    async def test_proxy_passes_binary_audio_and_vocabulary(self):
        async def transcribe(request):
            self.assertEqual(await request.read(), b'valid-audio' * 20)
            self.assertEqual(request.query['language'], 'es')
            self.assertEqual(request.query['fast'], '1')
            self.assertIn('Codex', request.query['prompt']); self.assertIn('taquería', request.query['prompt'])
            return web.json_response({'text': 'Crea una aplicación.', 'duration': 3, 'language': 'es'})
        service = web.Application(); service.router.add_post('/transcribe', transcribe)
        server = TestServer(service); await server.start_server(); self.addAsyncCleanup(server.close)
        await self.login()
        with patch.object(speech, 'SPEECH_URL', str(server.make_url('')).rstrip('/')):
            response = await self.client.post('/api/voice/transcribe?language=es&fast=1&vocabulary=taquer%C3%ADa', data=b'valid-audio' * 20, headers={'Content-Type': 'audio/webm'})
        self.assertEqual(response.status, 200); self.assertEqual((await response.json())['text'], 'Crea una aplicación.')

    async def test_unavailable_engine_returns_actionable_error(self):
        await self.login()
        with patch.object(speech, 'SPEECH_URL', 'http://127.0.0.1:1'):
            response = await self.client.post('/api/voice/transcribe', data=b'a' * 100, headers={'Content-Type': 'audio/webm'})
        self.assertEqual(response.status, 503); self.assertIn('grabación', (await response.json())['message'])
