"""Proxy autenticado al reconocedor privado; no persiste audio ni texto dictado."""
import asyncio
import os
import re
import aiohttp
from aiohttp import web

SPEECH_URL = os.environ.get('SPEECH_URL', 'http://speech:3001').rstrip('/')
MAX_AUDIO = 12 * 1024 * 1024
ALLOWED = {'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'video/webm', 'video/mp4'}


async def recognize(request):
    if request.content_type not in ALLOWED:
        return web.json_response({'message': 'Formato de audio no admitido'}, status=415)
    if request.content_length and request.content_length > MAX_AUDIO:
        return web.json_response({'message': 'La grabación es demasiado grande (máximo 12 MB)'}, status=413)
    data = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        data.extend(chunk)
        if len(data) > MAX_AUDIO: return web.json_response({'message': 'La grabación supera los 12 MB'}, status=413)
    if len(data) < 64: return web.json_response({'message': 'No se recibió una grabación válida'}, status=400)
    language = request.query.get('language', 'es')
    if language not in ('es', 'en', 'pt', 'fr', 'de', 'it', 'auto'):
        return web.json_response({'message': 'Idioma no admitido'}, status=400)
    vocabulary = ' '.join(request.query.get('vocabulary', '').split())[:600]
    params = {'fast': '1' if request.query.get('fast') == '1' else '0', 'language': language, 'prompt': 'Codex, Claude, Docker, Git, React, TypeScript, API, despliegue, proyecto. ' + vocabulary}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300, connect=5)) as session:
            async with session.post(SPEECH_URL + '/transcribe', params=params, data=data, headers={'Content-Type': request.content_type}) as response:
                result = await response.json()
                if response.status >= 400:
                    return web.json_response({'message': result.get('message', 'No se pudo transcribir el audio')}, status=response.status)
                return web.json_response({'text': str(result.get('text', ''))[:100000], 'language': result.get('language'),
                                          'duration': result.get('duration'), 'engine': 'whisper-small-local'})
    except asyncio.TimeoutError:
        return web.json_response({'message': 'La transcripción tardó demasiado. Tu audio sigue disponible: puedes reintentar.'}, status=504)
    except (aiohttp.ClientError, ValueError):
        return web.json_response({'message': 'El motor de voz no está disponible. Tu grabación se conserva para reintentar.'}, status=503)


async def status(request):
    ready = False
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as session:
            async with session.get(SPEECH_URL + '/health') as response: ready = response.status == 200
    except (aiohttp.ClientError, asyncio.TimeoutError): pass
    return web.json_response({'ready': ready, 'engine': 'whisper-small-local', 'max_seconds': 180,
                              'local': True, 'cost_per_minute': 0, 'retains_audio': False})
