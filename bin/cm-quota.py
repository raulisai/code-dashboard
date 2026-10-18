#!/usr/bin/env python3
"""Cupo de Claude y Codex leído con las credenciales del host (el contenedor del panel no las tiene).

Basado en raulisai/utilizetokens. Recibe un directorio y deja `result.json` con
{claude: {...}, codex: {...}}. Los tokens solo se usan en memoria: ni se imprimen ni se guardan.
- Claude: token OAuth del CLI → endpoint de uso de Anthropic (ventanas de 5 h y semanal).
- Codex: `codex app-server --stdio` → `account/rateLimits/read` (con sesión de ChatGPT).
"""
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

BIN = Path.home() / '.local' / 'bin'
USAGE_API = 'https://api.anthropic.com/api/oauth/usage'
TIMEOUT = 20


def tool(name):
    return str(BIN / name) if (BIN / name).exists() else shutil.which(name)


def run(argv, timeout):
    try:
        done = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
        return done.returncode, done.stdout, done.stderr
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, '', str(error)


# ---------------------------------------------------------------- Claude

def oauth_token():
    base = Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude').expanduser()
    try: oauth = json.loads((base / '.credentials.json').read_text()).get('claudeAiOauth') or {}
    except (OSError, ValueError, AttributeError): raise RuntimeError('Sin sesión de Claude en el servidor (claude auth login)') from None
    token = oauth.get('accessToken')
    if not token: raise RuntimeError('Sin sesión de Claude en el servidor (claude auth login)')
    expires = oauth.get('expiresAt')
    if isinstance(expires, (int, float)) and 0 < expires / 1000 < time.time(): raise RuntimeError('token vencido')
    return token


def usage_request():
    request = urllib.request.Request(USAGE_API, headers={'Authorization': f'Bearer {oauth_token()}', 'anthropic-beta': 'oauth-2025-04-20',
                                                       'Accept': 'application/json', 'User-Agent': 'codex-manager-quota/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response: return json.loads(response.read().decode())
    except urllib.error.HTTPError as error: raise RuntimeError(f'HTTP {error.code}') from None
    except (urllib.error.URLError, OSError, ValueError) as error: raise RuntimeError(str(getattr(error, 'reason', error))) from None


def claude_quota():
    if not tool('claude'): return {'state': 'not_installed'}
    try:
        try: data = usage_request()
        except RuntimeError as error:
            if 'vencido' not in str(error) and 'HTTP 401' not in str(error): raise
            run([tool('claude'), 'auth', 'status', '--json'], 30)  # el CLI renueva su token al ejecutarse
            data = usage_request()
        windows = []
        for key, minutes in (('five_hour', 300), ('seven_day', 10080)):
            window = data.get(key) or {}
            if isinstance(window, dict): windows.append({'minutes': minutes, 'used': float(window.get('utilization') or 0), 'resets_at': window.get('resets_at')})
        if len(windows) < 2: raise RuntimeError('respuesta de uso inesperada')
        return {'state': 'ok', 'windows': windows}
    except RuntimeError as error:
        return {'state': 'error', 'error': str(error)[:200]}


# ---------------------------------------------------------------- Codex

def reader(stream, messages):
    try:
        for line in stream:
            try: messages.put(json.loads(line))
            except ValueError: continue
    finally: messages.put(None)


def rpc(process, messages, number, method, params):
    process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': number, 'method': method, 'params': params}) + '\n'); process.stdin.flush()
    deadline = time.monotonic() + TIMEOUT
    while True:
        try: message = messages.get(timeout=max(0.1, deadline - time.monotonic()))
        except queue.Empty: raise RuntimeError(f'Sin respuesta de {method}') from None
        if message is None: raise RuntimeError('El servidor de Codex terminó')
        if isinstance(message, dict) and message.get('id') == number:
            if 'error' in message: raise RuntimeError(str(message['error'])[:200])
            return message.get('result', {})


def codex_quota():
    binary = tool('codex')
    if not binary: return {'state': 'not_installed'}
    code, output, error = run([binary, 'login', 'status'], TIMEOUT)
    text = output + '\n' + error
    if code != 0: return {'state': 'logged_out'}
    if 'ChatGPT' not in text: return {'state': 'api_key'}
    process = subprocess.Popen([binary, 'app-server', '--stdio'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    messages = queue.Queue()
    threading.Thread(target=reader, args=(process.stdout, messages), daemon=True).start()
    try:
        rpc(process, messages, 1, 'initialize', {'clientInfo': {'name': 'codex-manager', 'version': '1.0'}, 'capabilities': None})
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'initialized'}) + '\n'); process.stdin.flush()
        snapshot = (rpc(process, messages, 2, 'account/rateLimits/read', {}) or {}).get('rateLimits')
        if not isinstance(snapshot, dict): raise RuntimeError('respuesta de límites inesperada')
        windows = [{'minutes': w.get('windowDurationMins'), 'used': float(w.get('usedPercent') or 0), 'resets_at': w.get('resetsAt')}
                   for w in (snapshot.get('primary'), snapshot.get('secondary')) if isinstance(w, dict)]
        credits = snapshot.get('credits') if isinstance(snapshot.get('credits'), dict) else {}
        return {'state': 'ok', 'plan': snapshot.get('planType'), 'windows': windows,
                'credits': {'has': bool(credits.get('hasCredits')), 'unlimited': bool(credits.get('unlimited')), 'balance': str(credits.get('balance') or '')}}
    except (RuntimeError, OSError) as failure:
        return {'state': 'error', 'error': str(failure)[:200]}
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=2)
            except subprocess.TimeoutExpired: process.kill()


def main():
    folder = Path(sys.argv[1]).resolve()
    results = {}
    def work(name, function):
        try: results[name] = function()
        except Exception as error: results[name] = {'state': 'error', 'error': str(error)[:200]}
    threads = [threading.Thread(target=work, args=item) for item in (('claude', claude_quota), ('codex', codex_quota))]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    temporary = folder / 'result.json.tmp'
    temporary.write_text(json.dumps({'ok': True, **results}, ensure_ascii=False))
    os.replace(temporary, folder / 'result.json')


if __name__ == '__main__':
    main()
