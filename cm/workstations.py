"""Cola para equipos de confianza: tokens propios, asignación exclusiva y leases.

No comparte credenciales ni trabajos con la cola que ejecuta el VPS.
Un lease perdido se interrumpe: nunca se vuelve a ejecutar automáticamente.
"""
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid

from . import auth, config

PUBLIC_PATHS = {'/api/workstation/enroll'}
NATIVE_PATHS = {'/api/workstation/poll', '/api/workstation/heartbeat', '/api/workstation/finish'}
LEASE_SECONDS = 120
TOKEN_SECONDS = 90 * 86400
MAX_PROMPT = 20000


def reject(message, status=400):
    raise auth.AuthError(message, status)


def digest(text):
    return hashlib.sha256(str(text).encode()).hexdigest()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
        reject('Identificador de equipo o tarea inválido')
    return value


@contextmanager
def database():
    config.CONFIG.mkdir(parents=True, exist_ok=True)
    path = config.CONFIG / 'workstations.sqlite3'
    fd = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript('''
          CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY, label TEXT NOT NULL, projects TEXT NOT NULL,
            pair_hash TEXT NOT NULL, pair_expires REAL NOT NULL,
            token_hash TEXT, token_expires REAL, password_tag TEXT NOT NULL,
            created REAL NOT NULL, seen REAL DEFAULT 0, revoked INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, device TEXT NOT NULL, project TEXT NOT NULL,
            provider TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
            created REAL NOT NULL, updated REAL NOT NULL, lease TEXT DEFAULT '',
            lease_until REAL DEFAULT 0, cancel INTEGER DEFAULT 0,
            result TEXT DEFAULT '{}', request_key TEXT NOT NULL,
            UNIQUE(device, request_key));
          CREATE INDEX IF NOT EXISTS device_jobs ON jobs(device,status,created);
        ''')
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    finally:
        db.close()


def expire(db):
    db.execute("UPDATE jobs SET status='interrupted',updated=? WHERE status='running' AND lease_until<?",
               (time.time(), time.time()))


def create_enrollment(label, project_names):
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= 80:
        reject('Escribe un nombre de equipo de hasta 80 caracteres')
    if (not isinstance(project_names, list) or not 1 <= len(project_names) <= 50
            or any(not isinstance(p, str) or not re.fullmatch(config.PROJECT_NAME, p) for p in project_names)):
        reject('Selecciona entre 1 y 50 proyectos válidos')
    code = secrets.token_urlsafe(32)
    device = uuid.uuid4().hex
    expires = time.time() + 600
    with database() as db:
        db.execute('INSERT INTO devices (id,label,projects,pair_hash,pair_expires,password_tag,created) VALUES (?,?,?,?,?,?,?)',
                   (device, label.strip(), json.dumps(sorted(set(project_names))), digest(code), expires,
                    auth._password_tag(), time.time()))
    return {'device_id': device, 'code': code, 'expires': expires}


def enroll(code, token):
    # El cliente genera el token para poder repetir un alta cuya respuesta se perdió.
    if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', code):
        reject('Código de vinculación inválido o vencido', 401)
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        reject('Credencial de equipo inválida', 400)
    with database() as db:
        row = db.execute('SELECT * FROM devices WHERE pair_hash=?', (digest(code),)).fetchone()
        if (not row or row['revoked'] or row['pair_expires'] <= time.time()
                or not hmac.compare_digest(row['password_tag'], auth._password_tag())):
            reject('Código de vinculación inválido o vencido', 401)
        if row['token_hash'] and not hmac.compare_digest(row['token_hash'], digest(token)):
            reject('El código de vinculación ya se utilizó', 409)
        expires = row['token_expires'] or time.time() + TOKEN_SECONDS
        db.execute('UPDATE devices SET token_hash=?,token_expires=?,seen=? WHERE id=?',
                   (digest(token), expires, time.time(), row['id']))
        return {'device_id': row['id'], 'label': row['label'], 'projects': json.loads(row['projects']), 'expires': expires}


def _authenticate(db, token):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        reject('Vuelve a vincular este equipo', 401)
    row = db.execute('SELECT * FROM devices WHERE token_hash=?', (digest(token),)).fetchone()
    if (not row or row['revoked'] or row['token_expires'] <= time.time()
            or not hmac.compare_digest(row['password_tag'], auth._password_tag())):
        reject('Vuelve a vincular este equipo', 401)
    return row


def authenticate(token):
    with database() as db:
        row = _authenticate(db, token)
        return {'id': row['id'], 'token': None, 'mfa': True, 'kind': 'workstation'}


def overview():
    with database() as db:
        expire(db)
        devices = []
        for row in db.execute('SELECT * FROM devices ORDER BY created DESC'):
            devices.append({'id': row['id'], 'label': row['label'], 'projects': json.loads(row['projects']),
                            'seen': row['seen'], 'revoked': bool(row['revoked']),
                            'paired': bool(row['token_hash']), 'expires': row['token_expires'],
                            'online': bool(row['token_hash'] and not row['revoked'] and row['token_expires'] > time.time()
                                           and row['seen'] > time.time() - 90)})
        jobs = [{k: row[k] for k in ('id', 'device', 'project', 'provider', 'prompt', 'status', 'created', 'updated', 'cancel')}
                | {'result': json.loads(row['result'])}
                for row in db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 100')]
        return {'devices': devices, 'jobs': jobs}


def enqueue(device, project, provider, prompt, request_key):
    identifier(device)
    if provider not in config.PROVIDERS:
        reject('Agente inválido')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= MAX_PROMPT:
        reject('La tarea debe tener entre 1 y 20000 caracteres')
    if not isinstance(request_key, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_key):
        reject('Falta la clave de idempotencia de la tarea')
    with database() as db:
        row = db.execute('SELECT * FROM devices WHERE id=?', (device,)).fetchone()
        if not row or row['revoked'] or not row['token_hash'] or row['token_expires'] <= time.time():
            reject('El equipo no está vinculado o su credencial venció', 409)
        if project not in json.loads(row['projects']):
            reject('Proyecto no autorizado para este equipo', 403)
        existing = db.execute('SELECT * FROM jobs WHERE device=? AND request_key=?', (device, request_key)).fetchone()
        if existing:
            if (existing['project'], existing['provider'], existing['prompt']) != (project, provider, prompt.strip()):
                reject('La clave de idempotencia ya pertenece a otra tarea', 409)
            return {'id': existing['id'], 'status': existing['status']}
        if db.execute("SELECT COUNT(*) FROM jobs WHERE device=? AND status IN ('queued','running')", (device,)).fetchone()[0] >= 100:
            reject('La cola de este equipo está llena', 429)
        job = uuid.uuid4().hex
        db.execute('INSERT INTO jobs (id,device,project,provider,prompt,status,created,updated,request_key) VALUES (?,?,?,?,?,?,?,?,?)',
                   (job, device, project, provider, prompt.strip(), 'queued', time.time(), time.time(), request_key))
        return {'id': job, 'status': 'queued'}


def poll(token, projects):
    if not isinstance(projects, list) or len(projects) > 50 or any(not isinstance(p, str) for p in projects):
        reject('Lista de proyectos inválida')
    with database() as db:
        device = _authenticate(db, token)
        expire(db)
        db.execute('UPDATE devices SET seen=? WHERE id=?', (time.time(), device['id']))
        if db.execute("SELECT 1 FROM jobs WHERE device=? AND status='running'", (device['id'],)).fetchone():
            return {'job': None}
        allowed = set(projects) & set(json.loads(device['projects']))
        row = next((row for row in db.execute("SELECT * FROM jobs WHERE device=? AND status='queued' ORDER BY created", (device['id'],))
                    if row['project'] in allowed), None)
        if not row:
            return {'job': None}
        lease = secrets.token_urlsafe(32)
        db.execute("UPDATE jobs SET status='running',lease=?,lease_until=?,updated=? WHERE id=?",
                   (digest(lease), time.time() + LEASE_SECONDS, time.time(), row['id']))
        return {'job': {k: row[k] for k in ('id', 'project', 'provider', 'prompt')}
                | {'lease': lease, 'lease_seconds': LEASE_SECONDS}}


def _leased(db, token, job, lease, finished=False):
    identifier(job)
    device = _authenticate(db, token)
    row = db.execute('SELECT * FROM jobs WHERE id=? AND device=?', (job, device['id'])).fetchone()
    if not row or not isinstance(lease, str) or not hmac.compare_digest(row['lease'], digest(lease)):
        reject('La tarea no pertenece a este equipo o la asignación cambió', 409)
    if finished and row['status'] in ('completed', 'failed', 'cancelled', 'rejected'):
        return row
    if row['status'] != 'running' or row['lease_until'] <= time.time():
        reject('La asignación de la tarea venció; no se debe volver a ejecutarla', 409)
    return row


def heartbeat(token, job, lease):
    with database() as db:
        row = _leased(db, token, job, lease)
        db.execute('UPDATE jobs SET lease_until=?,updated=? WHERE id=?', (time.time() + LEASE_SECONDS, time.time(), job))
        db.execute('UPDATE devices SET seen=? WHERE id=?', (time.time(), row['device']))
        return {'cancel': bool(row['cancel']), 'lease_seconds': LEASE_SECONDS}


def finish(token, job, lease, result):
    if (not isinstance(result, dict) or set(result) - {'status', 'summary', 'branch', 'commit', 'files', 'validation'}
            or result.get('status') not in ('completed', 'failed', 'cancelled', 'rejected')):
        reject('Resultado inválido')
    for field in ('summary', 'branch', 'commit', 'validation'):
        if not isinstance(result.get(field, ''), str) or len(result.get(field, '')) > (24000 if field == 'summary' else 1000):
            reject('Resultado demasiado grande o inválido')
    paths = result.get('files', [])
    if not isinstance(paths, list) or len(paths) > 100 or any(not isinstance(p, str) or len(p) > 512 for p in paths):
        reject('Lista de archivos inválida')
    with database() as db:
        row = _leased(db, token, job, lease, finished=True)
        if row['status'] != 'running':
            if json.loads(row['result']) != result:
                reject('Esta tarea ya tiene otro resultado', 409)
            return {'ok': True}
        status = 'cancelled' if row['cancel'] else result['status']
        db.execute('UPDATE jobs SET status=?,result=?,updated=? WHERE id=?',
                   (status, json.dumps(result, ensure_ascii=False), time.time(), job))
        return {'ok': True}


def cancel(job):
    identifier(job)
    with database() as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        if not row:
            reject('Tarea no encontrada', 404)
        if row['status'] in ('queued', 'running'):
            db.execute("UPDATE jobs SET cancel=1,status=?,updated=? WHERE id=?",
                       ('cancelled' if row['status'] == 'queued' else 'running', time.time(), job))
        return {'ok': True}


def revoke(device):
    identifier(device)
    with database() as db:
        db.execute('UPDATE devices SET revoked=1 WHERE id=?', (device,))
        db.execute("UPDATE jobs SET status='cancelled',cancel=1,updated=? WHERE device=? AND status IN ('queued','running')",
                   (time.time(), device))
        return {'ok': True}
