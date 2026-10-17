"""Servicio privado de dictado. El audio se procesa en memoria y no se conserva."""
import asyncio
import io
import json
import logging
import os
import re
from collections import Counter
import time
import av
import numpy as np

from aiohttp import web
from faster_whisper import WhisperModel

MAX_BYTES = 12 * 1024 * 1024
MAX_SECONDS = 180
MODEL = None
MODEL_FAST = None
READY = False
LOCK = asyncio.Lock()
LOG = logging.getLogger(__name__)


def transcribe(data, language, prompt, fast=False):
    # PyAV decodifica WebM/Opus, MP4/AAC y WAV sin ffmpeg externo.
    chunks, samples = [], 0
    # Un archivo disfrazado de audio no puede usar listas para abrir red o archivos locales.
    with av.open(io.BytesIO(data), options={'protocol_whitelist': 'pipe',
                                          'format_whitelist': 'matroska,webm,mov,mp3,wav,ogg'}) as container:
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunk = converted.to_ndarray().reshape(-1)
                samples += len(chunk)
                if samples > (MAX_SECONDS + 2) * 16000:
                    raise ValueError('El audio supera los 3 minutos. Divide tu petición en varios dictados.')
                chunks.append(chunk)
    audio = np.concatenate(chunks).astype(np.float32) / 32768 if chunks else np.empty(0, dtype=np.float32)
    duration = len(audio) / 16000
    if duration > MAX_SECONDS + 2: raise ValueError('El audio supera los 3 minutos. Divide tu petición en varios dictados.')
    if duration < .25: raise ValueError('La grabación es demasiado corta. Mantén el micrófono abierto mientras hablas.')
    quick = bool(fast and duration <= 30 and MODEL_FAST is not None)
    model = MODEL_FAST if quick else MODEL
    segments, info = model.transcribe(audio, language=language, task='transcribe', beam_size=1 if fast else 3, best_of=1, temperature=0,
                                     no_repeat_ngram_size=3, repetition_penalty=1.1, max_new_tokens=96 if quick else 448,
                                     initial_prompt=prompt[:900], vad_filter=True,
                                     vad_parameters={'min_silence_duration_ms': 500},
                                     condition_on_previous_text=False, hallucination_silence_threshold=1.5)
    accepted = [s for s in segments if s.no_speech_prob < .6 and getattr(s, 'avg_logprob', 0) > -1.05]
    text = ' '.join(s.text.strip() for s in accepted).strip()
    words = re.findall(r'\w+', text.lower())
    if not words or (len(words) > 12 and Counter(words).most_common(1)[0][1] / len(words) > .45):
        raise ValueError('No entendí el audio con suficiente claridad. Repite la frase o usa voz local precisa.')
    return {'text': text, 'language': info.language, 'duration': round(duration, 2), 'engine': 'whisper-tiny-local' if quick else 'whisper-small-local'}


async def health(request):
    return web.json_response({'ready': READY, 'engine': 'whisper-tiny-local' if quick else 'whisper-small-local'}, status=200 if READY else 503)


async def recognize(request):
    if not READY: return web.json_response({'message': 'El motor de voz se está preparando. Reintenta en unos segundos.'}, status=503)
    if LOCK.locked(): return web.json_response({'message': 'Hay otro dictado procesándose. Conservamos tu audio para que puedas reintentar.'}, status=429)
    language = request.query.get('language', 'es')
    if language not in ('es', 'en', 'pt', 'fr', 'de', 'it', 'auto'):
        return web.json_response({'message': 'Idioma no admitido'}, status=400)
    async with LOCK:
        data = await request.read()
        if not data: return web.json_response({'message': 'No llegó audio'}, status=400)
        try:
            result = await asyncio.to_thread(transcribe, data, None if language == 'auto' else language, request.query.get('prompt', ''), request.query.get('fast') == '1')
            return web.json_response(result)
        except ValueError as error:
            return web.json_response({'message': str(error)}, status=400)
        except Exception:
            LOG.exception('No se pudo decodificar o transcribir el audio')
            return web.json_response({'message': 'No se pudo leer la grabación. Prueba de nuevo o usa otro formato de audio.'}, status=422)


async def startup(app):
    global MODEL, MODEL_FAST, READY
    MODEL = await asyncio.to_thread(WhisperModel, '/opt/model', device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, local_files_only=True)
    MODEL_FAST = await asyncio.to_thread(WhisperModel, '/opt/model-fast', device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, local_files_only=True)
    READY = True


def main():
    logging.basicConfig(level=logging.INFO)
    app = web.Application(client_max_size=MAX_BYTES)
    app.add_routes([web.get('/health', health), web.post('/transcribe', recognize)])
    app.on_startup.append(startup)
    web.run_app(app, host='0.0.0.0', port=3001, access_log=None, print=None)


if __name__ == '__main__': main()
