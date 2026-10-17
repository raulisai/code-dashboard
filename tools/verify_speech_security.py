"""Decodifica formatos reales y rechaza listas de red/archivo. Ejecutar en imagen speech.
No ejecuta inferencia ni usa grabaciones del usuario.
"""
import io
import math
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
import av
import numpy as np
sys.path.insert(0, "/speech")
import server

class Model:
    def __init__(self): self.calls = 0
    def transcribe(self, audio, **kwargs):
        self.calls += 1
        assert len(audio) >= 12000
        return iter([SimpleNamespace(text='Audio de prueba', no_speech_prob=.1, avg_logprob=-.1)]), SimpleNamespace(language='es')
server.MODEL = Model()
rate=48000
samples=(np.sin(np.arange(rate)*2*math.pi*440/rate)*0.1).astype(np.float32)
wav=io.BytesIO()
with wave.open(wav,'wb') as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate);out.writeframes((samples*32767).astype(np.int16).tobytes())
server.transcribe(wav.getvalue(),'es','')
for format,codec in [('webm','libopus'),('mp4','aac')]:
    encoded=io.BytesIO()
    with av.open(encoded,'w',format=format) as container:
        stream=container.add_stream(codec,rate=rate);stream.layout='mono'
        frame=av.AudioFrame.from_ndarray(samples.reshape(1,-1),format='fltp',layout='mono');frame.sample_rate=rate
        for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode(None):container.mux(packet)
    server.transcribe(encoded.getvalue(),'es','')

server.MODEL_FAST = Model()
normal_calls = server.MODEL.calls
assert server.transcribe(wav.getvalue(),'es','',True)['engine'] == 'whisper-tiny-local'
assert server.MODEL_FAST.calls == 1 and server.MODEL.calls == normal_calls
long_wav=io.BytesIO()
with wave.open(long_wav,'wb') as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate);out.writeframes((np.tile(samples,31)*32767).astype(np.int16).tobytes())
assert server.transcribe(long_wav.getvalue(),'es','',True)['engine'] == 'whisper-small-local'
assert server.MODEL_FAST.calls == 1 and server.MODEL.calls == normal_calls + 1

class RepeatingModel:
    def transcribe(self,*args,**kwargs):
        return iter([SimpleNamespace(text='repite '*50,no_speech_prob=.1,avg_logprob=-.1)]),SimpleNamespace(language='es')
server.MODEL_FAST = RepeatingModel()
try:server.transcribe(wav.getvalue(),'es','',True)
except ValueError:pass
else:raise AssertionError('No rechazó una alucinación repetitiva')

hits=[]
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        hits.append(self.path);self.send_response(200);self.end_headers();self.wfile.write(wav.getvalue())
    def log_message(self,*args):pass
http=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
try:
    for data in [f'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.0,\nhttp://127.0.0.1:{http.server_port}/audio.ts\n#EXT-X-ENDLIST\n'.encode(),b"ffconcat version 1.0\nfile '/etc/passwd'\n"]:
        try:server.transcribe(data,'es','')
        except Exception:pass
        else:raise AssertionError('Se aceptó una lista de reproducción con recursos externos')
    assert not hits,'El decodificador abrió una URL de una lista'
finally:
    http.shutdown();http.server_close();thread.join(timeout=2)
print('SPEECH_SECURITY_OK: WAV, WebM/Opus, MP4/AAC reales; HLS/concat rechazados sin conexiones de red. Selección tiny/small según duración verificada. Sin inferencia.')
