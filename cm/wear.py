"""Cliente Wear OS: vinculación MFA, acceso limitado y avisos silenciosos por defecto.

Comparte la cola y el chat principal del agente general; no ejecuta otro agente.
Las credenciales se guardan cifradas solo durante la entrega inicial al reloj.
"""
from contextlib import contextmanager
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from . import auth, availability, chats, config, runs, tasks

LOG = logging.getLogger(__name__)
PAIR_SECONDS = 300
NATIVE_PATHS = {'/api/wear/state', '/api/wear/send', '/api/wear/notifications', '/api/wear/disconnect', '/api/wear/view', '/api/wear/action'}
PUBLIC_PATHS = {'/api/wear/pair/start', '/api/wear/pair/poll'}
_oauth = {}
_retry = {}
_push_lock = threading.Lock()


@contextmanager
def database():
    with auth._db() as db:
        # execute(), not executescript(): preserve auth's transaction.
        db.execute('CREATE TABLE IF NOT EXISTS wear_pair (secret_hash TEXT PRIMARY KEY, code TEXT UNIQUE, expires REAL, payload TEXT, session_id TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS wear_devices (session_id TEXT PRIMARY KEY, fcm TEXT DEFAULT \'\', mode TEXT DEFAULT \'attention\', seen TEXT DEFAULT \'[]\')')
        yield db


def start_pair(ip, label='Galaxy Watch'):
    with database() as db:
        scope = 'wear-pair:' + ip
        if auth._limited(db, scope):
            raise auth.AuthError('Espera unos minutos antes de volver a vincular.', 429)
        auth._failure(db, scope)
        db.execute('DELETE FROM sessions WHERE id IN (SELECT session_id FROM wear_pair WHERE expires<=?)', (time.time(),))
        db.execute('DELETE FROM wear_pair WHERE expires<=?', (time.time(),))
        if db.execute('SELECT COUNT(*) FROM wear_pair').fetchone()[0] >= 64:
            raise auth.AuthError('Vinculación ocupada. Reintenta más tarde.', 429)
        secret = secrets.token_urlsafe(32)
        code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))
        expires = int(time.time() + PAIR_SECONDS)
        db.execute('INSERT INTO wear_pair (secret_hash,code,expires,payload) VALUES (?,?,?,?)',
                   (auth._hash(secret), code, expires, json.dumps({'label': str(label)[:60]})))
    return {'secret': secret, 'code': code, 'expires': expires, 'interval': 5}


def approve_pair(code):
    code = re.sub(r'[\s-]', '', str(code or '')).upper()
    with database() as db:
        if auth._limited(db, 'wear-approve', 12):
            raise auth.AuthError('Demasiados códigos incorrectos. Espera diez minutos.', 429)
        row = db.execute('SELECT * FROM wear_pair WHERE code=? AND expires>?', (code, time.time())).fetchone()
        if not row or 'token' in json.loads(row['payload']):
            auth._failure(db, 'wear-approve')
            raise auth.AuthError('Código incorrecto, utilizado o caducado.', 400)
        payload = json.loads(row['payload'])
        count = db.execute('SELECT COUNT(*) FROM wear_devices d JOIN sessions s ON s.id=d.session_id WHERE s.expires>?', (time.time(),)).fetchone()[0]
        if count >= 16: raise auth.AuthError('Ya hay 16 relojes. Revoca uno en Seguridad antes de continuar.', 409)
        session = auth._new_session(db, 'Wear OS · ' + payload['label'], mfa=True, remember=True)
        payload['token'] = auth._cipher().encrypt(session['token'].encode()).decode()
        payload['expires'] = session['expires']
        db.execute('INSERT INTO wear_devices (session_id,seen) VALUES (?,?)', (session['id'], json.dumps(markers())))
        db.execute('UPDATE wear_pair SET payload=?,session_id=? WHERE secret_hash=?', (json.dumps(payload), session['id'], row['secret_hash']))
    return {'ok': True, 'message': 'Reloj vinculado. Ya puedes volver a él.'}


def firebase_client():
    path = config.CONFIG / 'wear-firebase-client.json'
    try:
        data = json.loads(path.read_text())
        return {key: str(data[key]) for key in ('project_id', 'application_id', 'api_key', 'sender_id')}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def poll_pair(secret):
    if not isinstance(secret, str) or not 32 <= len(secret) <= 100:
        raise auth.AuthError('Vinculación caducada. Genera otro código.', 410)
    with database() as db:
        row = db.execute('SELECT * FROM wear_pair WHERE secret_hash=?', (auth._hash(secret),)).fetchone()
        if not row or row['expires'] <= time.time():
            raise auth.AuthError('Vinculación caducada. Genera otro código.', 410)
        payload = json.loads(row['payload'])
        if 'token' not in payload:
            return {'status': 'pending'}
        token = auth._cipher().decrypt(payload['token'].encode()).decode()
        # Permite recuperar una respuesta perdida hasta el primer uso autenticado.
        # La aprobación es de un solo uso; el secreto de 256 bits caduca a los 5 min.
        return {'status': 'linked', 'token': token, 'expires': payload['expires'], 'firebase': firebase_client()}


def authenticate(token):
    session = auth.authenticate(token, rotate=False)
    if not session or not session['mfa']:
        return None
    with database() as db:
        device = db.execute('SELECT session_id FROM wear_devices WHERE session_id=?', (session['id'],)).fetchone()
        if device: db.execute('DELETE FROM wear_pair WHERE session_id=?', (session['id'],))
    return session if device else None


def is_device(session_id):
    with database() as db:
        return db.execute('SELECT 1 FROM wear_devices WHERE session_id=?', (session_id,)).fetchone() is not None


def plain(text, limit=1600):
    text = re.sub(r'```[\s\S]*?(?:```|$)', '', str(text or ''))
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return re.sub(r'[*#`_]', '', text).strip()[:limit]


def compact_task(task):
    return {key: task.get(key, 'main' if key == 'chat_id' else '') for key in ('id', 'project', 'chat_id', 'title', 'status', 'run_id', 'finished_at')}


def stamp(text):
    """Epoch de una marca `YYYY-MM-DD HH:MM:SS TZ` del servidor (escrita con su propia hora local)."""
    try: return int(time.mktime(time.strptime(str(text or '')[:19], '%Y-%m-%d %H:%M:%S')))
    except (ValueError, OverflowError): return 0


def recent(records, approvals, limit=6):
    """Avisos para la pantalla principal del reloj: aprobaciones pendientes y después lo último que terminó o falló."""
    rows = [{'kind': 'approval', 'project': str(row.get('project', '')), 'provider': str(row.get('provider', '')),
             'title': 'Pide tu aprobación', 'at': int(time.time())} for row in approvals[:3]]
    done = [task for task in reversed(records) if task['status'] in ('terminado', 'error')]
    for task in sorted(done, key=lambda row: stamp(row.get('finished_at')), reverse=True):
        rows.append({'kind': task['status'], 'project': task['project'], 'provider': task.get('provider', ''),
                     'title': plain(task.get('title'), 80), 'at': stamp(task.get('finished_at'))})
    return rows[:limit]


def snapshot(session_id):
    records = tasks.task_records()
    own = [task for task in records if task['project'] == config.GENERAL and task.get('chat_id', 'main') == 'main']
    latest = own[-1] if own else None
    active = [task for task in own if task['status'] in ('espera', 'working')]
    state = 'working' if any(task['status'] == 'working' for task in active) else 'queued' if active else 'idle'
    response, activity, run_id = '', '', ''
    if latest:
        run_id = latest.get('run_id') or ''
        meta = runs.run_meta(run_id)
        if meta:
            run = runs.describe_run(meta)
            response = plain((run.get('result') or {}).get('text') or run.get('error'))
            if latest['status'] == 'error': state = 'error'
            if run.get('approvals'): state = 'attention'
            tool = next((event for event in reversed(run.get('events', [])) if event.get('t') == 'tool'), None)
            if tool:
                name = str(tool.get('name', '')).lower()
                activity = ('Buscando' if 'search' in name else 'Leyendo' if 'read' in name else
                            'Editando' if any(word in name for word in ('write', 'edit', 'change')) else 'Trabajando')
        elif latest['status'] == 'error':
            state, response = 'error', plain(latest.get('result'))
    # Un resumen acotado, nunca logs, reglas, credenciales o comandos del servidor.
    real = [task for task in records if task['project'] != config.GENERAL]
    with database() as db:
        device = db.execute('SELECT mode FROM wear_devices WHERE session_id=?', (session_id,)).fetchone()
    return {'state': state, 'activity': activity, 'reply': response, 'run_id': run_id,
            'task': compact_task(latest) if latest else None,
            'last_task': compact_task(real[-1]) if real else None,
            'updated_at': int(time.time()), 'notifications': device['mode'] if device else 'off',
            'firebase': firebase_client()}


def send(session_id, request_id, text, project=config.GENERAL, chat_id='main', provider='', model='', effort=''):
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
        raise auth.AuthError('Identificador de petición inválido.')
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise auth.AuthError('Escribe una petición de entre 1 y 4000 caracteres.')
    text = text.strip()
    from . import projects, lifecycle, modelcatalog
    if not isinstance(project, str) or not isinstance(chat_id, str) or not isinstance(provider, str) or not isinstance(effort, str):
        raise auth.AuthError('Destino de conversación inválido.')
    if project != config.GENERAL and (project not in projects.project_names() or lifecycle.deleting(project)):
        raise auth.AuthError('Proyecto no disponible.', 404)
    if provider and provider not in config.PROVIDERS: raise auth.AuthError('Agente inválido.')
    if not isinstance(model, str) or (model and not re.fullmatch(r'[A-Za-z0-9._:\[\]-]{1,80}', model)):
        raise auth.AuthError('Modelo inválido.')
    selected = provider or runs.load_settings()['default_provider']
    if effort and effort not in modelcatalog.supported_efforts(selected, model): raise auth.AuthError('Esfuerzo incompatible.')
    if project == config.GENERAL and (model or effort or provider): raise auth.AuthError('El agente general usa los ajustes predeterminados.')
    # ID determinista: incluso un corte entre guardar TSV y responder no duplica trabajo.
    task_id = 'wear-' + hashlib.sha256(f'{session_id}:{request_id}'.encode()).hexdigest()[:32]
    with tasks.LOCK:
        records = tasks.task_records()
        previous = next((task for task in records if task['id'] == task_id), None)
        if previous:
            if (previous['details'] != text or previous['project'] != project or previous.get('chat_id', 'main') != chat_id
                    or previous.get('model', '') != model or previous.get('effort', '') != effort
                    or (project != config.GENERAL and provider and previous['provider'] != provider)):
                raise auth.AuthError('Ese identificador ya se utilizó para otro mensaje.', 409)
            return {'task': compact_task(previous), 'duplicate': True}
        if sum(task['project'] == project and task['status'] in ('espera', 'working') for task in records) >= 8:
            raise auth.AuthError('El agente tiene varias peticiones pendientes. Espera a que avance.', 429)
        try: chats.require(project, chat_id)
        except ValueError as error: raise auth.AuthError(str(error), 404) from None
        if project != config.GENERAL and (project not in projects.project_names() or lifecycle.deleting(project)):
            raise auth.AuthError('El proyecto ya no está disponible.', 409)
        if project == config.GENERAL: selected = availability.choose(selected) or selected
        task = tasks.new_task(project, selected, text.splitlines()[0], text, origin='wear', chat_id=chat_id, model=model, effort=effort)
        task['id'] = task_id
        tasks.save_tasks(records + [task])
    runs.changed()
    return {'task': compact_task(task), 'duplicate': False}


def preferences(session_id, mode, token=''):
    if mode not in ('off', 'attention', 'all'):
        raise auth.AuthError('Modo de avisos inválido.')
    if not isinstance(token, str) or len(token) > 4096 or (token and not re.fullmatch(r'[A-Za-z0-9_:.-]+', token)):
        raise auth.AuthError('Registro de notificaciones inválido.')
    with database() as db:
        db.execute('UPDATE wear_devices SET mode=?,fcm=?,seen=? WHERE session_id=?',
                   (mode, token, json.dumps(markers()), session_id))
    return {'ok': True, 'ready': bool(firebase_client() and token and service_account_path().is_file())}


def events():
    result = []
    for task in tasks.task_records()[-300:]:
        if task['status'] not in ('terminado', 'error'): continue
        marker = f"task:{task.get('run_id') or task['id']}:{task['status']}"
        result.append((marker, task['status'] == 'error', 'El agente necesita atención' if task['status'] == 'error' else 'Respuesta lista'))
    for approval in runs.all_pending_approvals():
        result.append((f"approval:{approval['run_id']}:{approval['id']}", True, 'El agente necesita tu aprobación'))
    return result


def markers():
    return [marker for marker, _, _ in events()][-600:]


def service_account_path():
    from pathlib import Path
    return Path(os.environ.get('WEAR_FCM_CREDENTIALS', str(config.CONFIG / 'wear-firebase-service-account.json')))


def _post(url, payload, headers=None):
    request = urllib.request.Request(url, data=payload, headers=headers or {}, method='POST')
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def _b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def fcm_send(token, marker, title):
    credentials = json.loads(service_account_path().read_text())
    project = credentials['project_id']
    if not re.fullmatch(r'[a-z][a-z0-9-]{3,62}', project): raise ValueError('Proyecto FCM inválido')
    now = int(time.time())
    if _oauth.get('project') != project or _oauth.get('until', 0) < now + 60:
        header = _b64(b'{"alg":"RS256","typ":"JWT"}')
        claims = _b64(json.dumps({'iss': credentials['client_email'], 'scope': 'https://www.googleapis.com/auth/firebase.messaging',
                                 'aud': 'https://oauth2.googleapis.com/token', 'iat': now, 'exp': now + 3600}).encode())
        unsigned = f'{header}.{claims}'.encode()
        key = serialization.load_pem_private_key(credentials['private_key'].encode(), password=None)
        assertion = unsigned.decode() + '.' + _b64(key.sign(unsigned, padding.PKCS1v15(), hashes.SHA256()))
        result = _post('https://oauth2.googleapis.com/token', urllib.parse.urlencode({
            'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode(),
            {'Content-Type': 'application/x-www-form-urlencoded'})
        _oauth.update(project=project, token=result['access_token'], until=now + int(result['expires_in']))
    # Solo aviso genérico: ningún texto de conversación pasa por Firebase.
    payload = {'message': {'token': token, 'data': {'event_id': marker, 'title': title},
                          'android': {'priority': 'high', 'ttl': '3600s', 'collapse_key': 'general-attention'}}}
    try:
        _post(f'https://fcm.googleapis.com/v1/projects/{project}/messages:send', json.dumps(payload).encode(),
              {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _oauth['token']})
    except urllib.error.HTTPError as error:
        if error.code == 401: _oauth.clear()
        # Solo UNREGISTERED elimina un token; un 404 de proyecto mal configurado no.
        raw = error.read(16384)
        if b'UNREGISTERED' in raw: return False
        raise RuntimeError('FCM rechazó el aviso') from None
    return True


def deliver_once():
    if not service_account_path().is_file(): return
    with _push_lock:
        with database() as db:
            db.execute('DELETE FROM wear_devices WHERE session_id NOT IN (SELECT id FROM sessions)')
            devices = [dict(row) for row in db.execute('SELECT * FROM wear_devices WHERE mode!=? AND fcm!=?', ('off', ''))]
        pending = events()
        for device in devices:
            sid = device['session_id']
            if not auth.session_active(sid) or _retry.get(sid, 0) > time.monotonic(): continue
            seen = json.loads(device['seen'])
            new = [event for event in pending if event[0] not in seen]
            eligible = [event for event in new if event[1] or device['mode'] == 'all']
            # Un solo aviso con el último evento relevante, sin ráfagas al reconectar.
            if eligible:
                marker, _, title = eligible[-1]
                try:
                    if not fcm_send(device['fcm'], marker, title):
                        with database() as db: db.execute('UPDATE wear_devices SET fcm=? WHERE session_id=?', ('', sid))
                        continue
                except Exception:
                    _retry[sid] = time.monotonic() + 60
                    LOG.warning('No se pudo entregar un aviso al reloj; se reintentará')
                    continue
            with database() as db:
                db.execute('UPDATE wear_devices SET seen=? WHERE session_id=?', (json.dumps((seen + [event[0] for event in new])[-600:]), sid))


def worker():
    while True:
        try: deliver_once()
        except Exception: LOG.warning('Avisos Wear OS no disponibles; se reintentará')
        time.sleep(5)
