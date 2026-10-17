"""Sesiones web revocables y autenticación TOTP. Ningún token se guarda en claro."""
import base64
from contextlib import contextmanager
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time

from cryptography.fernet import Fernet
import pyotp
import qrcode
import qrcode.image.svg
from . import config

COOKIE = '__Host-cm_session'
OLD_COOKIE = 'cm_session'
SHORT_SECONDS = 12 * 3600
SETUP_SECONDS = 10 * 60
ROTATE_SECONDS = 24 * 3600
GRACE_SECONDS = 60
_INIT_LOCK = threading.RLock()
_SECRET_LOCK = threading.RLock()


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _secret():
    with _SECRET_LOCK:
        try:
            value = config.SECRET_FILE.read_bytes()
        except FileNotFoundError:
            value = secrets.token_bytes(32)
            config.SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(config.SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as handle:
                handle.write(value)
        if len(value) != 32:
            raise ValueError('Clave de autenticación inválida')
        return value


def _hash(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def _password_tag():
    return hmac.new(_secret(), f'credentials:{config.USER}:{config.PASSWORD}'.encode(), hashlib.sha256).hexdigest()


def _cipher():
    return Fernet(base64.urlsafe_b64encode(hmac.digest(_secret(), b'cm-totp-encryption-v1', 'sha256')))


@contextmanager
def _db():
    # SQLite serializa verificaciones y consumos: un código no puede usarse dos veces.
    path = config.CONFIG / 'web-auth.sqlite3'
    with _INIT_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT, 0o600)
        os.close(fd)
        os.chmod(path, 0o600)
        db = sqlite3.connect(path, timeout=10)
        db.row_factory = sqlite3.Row
        db.executescript('''
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, previous_hash TEXT,
                previous_until REAL DEFAULT 0, password_tag TEXT NOT NULL,
                created REAL NOT NULL, expires REAL NOT NULL, rotated REAL NOT NULL,
                last_seen REAL NOT NULL, user_agent TEXT NOT NULL, mfa INTEGER NOT NULL,
                remember INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS challenges (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, session_id TEXT, data TEXT NOT NULL,
                expires REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS recovery (hash TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS failures (scope TEXT NOT NULL, stamp REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS failures_scope ON failures(scope, stamp);
        ''')
    try:
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except AuthError:
        # Un rechazo conserva los intentos fallidos y los códigos ya consumidos.
        db.commit()
        raise
    finally:
        db.close()


def _get(db, key, default=''):
    row = db.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


def _set(db, key, value):
    db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key, str(value)))


def enabled():
    with _db() as db:
        return bool(_get(db, 'totp'))


def check_credentials(user, password):
    if not config.PASSWORD:
        return False
    return (hmac.compare_digest(str(user or '').encode(), config.USER.encode()) &
            hmac.compare_digest(str(password or '').encode(), config.PASSWORD.encode()))


def _limited(db, scope, limit=6):
    db.execute('DELETE FROM failures WHERE stamp<?', (time.time() - 600,))
    return db.execute('SELECT COUNT(*) FROM failures WHERE scope=?', (scope,)).fetchone()[0] >= limit


def _failure(db, scope):
    db.execute('INSERT INTO failures VALUES (?,?)', (scope, time.time()))


def throttled(ip):
    with _db() as db:
        return _limited(db, 'password:' + ip)


def record_failure(ip):
    with _db() as db:
        _failure(db, 'password:' + ip)


def clear_failures(ip):
    with _db() as db:
        db.execute('DELETE FROM failures WHERE scope=?', ('password:' + ip,))


def _new_session(db, user_agent='', mfa=False, remember=False, days=None):
    now = time.time()
    lifetime = (config.SESSION_DAYS * 86400 if remember else SHORT_SECONDS) if mfa else SETUP_SECONDS
    if days is not None:
        lifetime = days * 86400
    sid = secrets.token_hex(16)
    token = f'v2.{sid}.{secrets.token_urlsafe(32)}'
    expires = int(now + lifetime)
    db.execute('DELETE FROM sessions WHERE expires<=? OR password_tag!=?', (now, _password_tag()))
    db.execute('DELETE FROM challenges WHERE expires<=?', (now,))
    db.execute('INSERT INTO sessions (id,token_hash,password_tag,created,expires,rotated,last_seen,user_agent,mfa,remember) VALUES (?,?,?,?,?,?,?,?,?,?)',
               (sid, _hash(token), _password_tag(), now, expires, now, now, str(user_agent)[:300], int(mfa), int(remember)))
    return {'token': token, 'expires': expires, 'remember': bool(remember and mfa), 'id': sid, 'setup_required': not mfa}


def make_token(days=None):
    """Crea una sesión provisional, usada también por las pruebas."""
    with _db() as db:
        session = _new_session(db, days=days)
        return session['token'], session['expires']


def authenticate(token, rotate=False):
    parts = str(token or '').split('.')
    if len(parts) != 3 or parts[0] != 'v2' or len(str(token)) > 160:
        return None
    with _db() as db:
        row = db.execute('SELECT * FROM sessions WHERE id=?', (parts[1],)).fetchone()
        now = time.time()
        if not row or row['expires'] <= now or not hmac.compare_digest(row['password_tag'], _password_tag()):
            return None
        digest = _hash(token)
        current = hmac.compare_digest(digest, row['token_hash'])
        previous = row['previous_until'] > now and hmac.compare_digest(digest, row['previous_hash'] or '')
        if not current and not previous:
            return None
        if not row['mfa'] and _get(db, 'totp'):
            return None
        session = dict(row)
        session['token'] = None
        if rotate and current and row['mfa'] and now - row['rotated'] >= ROTATE_SECONDS:
            replacement = f'v2.{row["id"]}.{secrets.token_urlsafe(32)}'
            db.execute('UPDATE sessions SET token_hash=?, previous_hash=?, previous_until=?, rotated=? WHERE id=?',
                       (_hash(replacement), row['token_hash'], now + GRACE_SECONDS, now, row['id']))
            session['token'] = replacement
        if now - row['last_seen'] >= 60:
            db.execute('UPDATE sessions SET last_seen=? WHERE id=?', (now, row['id']))
        return session


def valid_token(token):
    return authenticate(token) is not None


def session_active(session_id):
    with _db() as db:
        row = db.execute('SELECT expires,password_tag,mfa FROM sessions WHERE id=?', (session_id,)).fetchone()
        return bool(row and row['expires'] > time.time() and row['mfa'] and
                    hmac.compare_digest(row['password_tag'], _password_tag()))


def revoke_token(token):
    session = authenticate(token)
    if session:
        with _db() as db:
            db.execute('DELETE FROM sessions WHERE id=?', (session['id'],))
            db.execute('DELETE FROM challenges WHERE session_id=?', (session['id'],))


def begin_login(user, password, ip, user_agent, remember=False):
    with _db() as db:
        if _limited(db, 'password:' + ip):
            raise AuthError('Demasiados intentos. Espera diez minutos.', 429)
        if not check_credentials(user, password):
            _failure(db, 'password:' + ip)
            raise AuthError('Usuario o contraseña incorrectos', 401)
        db.execute('DELETE FROM failures WHERE scope=?', ('password:' + ip,))
        if not _get(db, 'totp'):
            return _new_session(db, user_agent)
        db.execute('DELETE FROM challenges WHERE expires<=?', (time.time(),))
        challenge = secrets.token_urlsafe(32)
        data = {'remember': remember is True, 'user_agent': str(user_agent)[:300], 'password_tag': _password_tag()}
        db.execute('INSERT INTO challenges (id,kind,data,expires) VALUES (?,?,?,?)',
                   (_hash(challenge), 'login', json.dumps(data), time.time() + 300))
        return {'mfa_required': True, 'challenge': challenge}


def _counter(secret, code, last=-1):
    value = str(code or '').strip()
    if not re.fullmatch(r'[0-9]{6}', value):
        return None
    now = int(time.time() // 30)
    totp = pyotp.TOTP(secret)
    for counter in (now, now - 1, now + 1):
        if counter > last and hmac.compare_digest(totp.at(counter * 30), value):
            return counter
    return None


def _require_factor(db, code, ip):
    if _limited(db, 'otp:' + ip) or _limited(db, 'otp:account', 30):
        raise AuthError('Demasiados códigos incorrectos. Espera diez minutos.', 429)
    encrypted = _get(db, 'totp')
    if encrypted:
        secret = _cipher().decrypt(encrypted.encode()).decode()
        counter = _counter(secret, code, int(_get(db, 'last_counter', '-1')))
        if counter is not None:
            _set(db, 'last_counter', counter)
            return
        recovery = re.sub(r'[\s-]', '', str(code or '')).upper()
        if re.fullmatch(r'[0-9A-F]{20}', recovery):
            used = db.execute('DELETE FROM recovery WHERE hash=?', (_hash('recovery:' + recovery),)).rowcount
            if used:
                return
    _failure(db, 'otp:' + ip)
    _failure(db, 'otp:account')
    raise AuthError('Código incorrecto o ya utilizado. Prueba el siguiente código de tu app.', 400)


def finish_login(challenge, code, ip, user_agent):
    with _db() as db:
        key = _hash(challenge)
        row = db.execute('SELECT * FROM challenges WHERE id=? AND kind=?', (key, 'login')).fetchone()
        if not row or row['expires'] <= time.time() or row['attempts'] >= 6:
            raise AuthError('La verificación caducó. Vuelve a introducir tu contraseña.', 400)
        data = json.loads(row['data'])
        if data['password_tag'] != _password_tag() or data['user_agent'] != str(user_agent)[:300]:
            raise AuthError('La verificación caducó. Vuelve a iniciar sesión.', 400)
        db.execute('UPDATE challenges SET attempts=attempts+1 WHERE id=?', (key,))
        _require_factor(db, code, ip)
        db.execute('DELETE FROM challenges WHERE id=?', (key,))
        return _new_session(db, user_agent, True, data['remember'])


def _require_owner(db, password, code, ip):
    if _limited(db, 'password:' + ip):
        raise AuthError('Demasiados intentos. Espera diez minutos.', 429)
    if not check_credentials(config.USER, password):
        _failure(db, 'password:' + ip)
        raise AuthError('Contraseña incorrecta', 400)
    _require_factor(db, code, ip)


def begin_setup(session_id, password='', code='', ip='?'):
    with _db() as db:
        row = db.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
        if not row or row['expires'] <= time.time():
            raise AuthError('Vuelve a iniciar sesión para configurar el autenticador.', 401)
        if _get(db, 'totp'):
            _require_owner(db, password, code, ip)
        secret = pyotp.random_base32()
        db.execute('DELETE FROM challenges WHERE session_id=? AND kind=?', (session_id, 'setup'))
        db.execute('INSERT INTO challenges (id,kind,session_id,data,expires) VALUES (?,?,?,?,?)',
                   (secrets.token_hex(16), 'setup', session_id, _cipher().encrypt(secret.encode()).decode(), time.time() + SETUP_SECONDS))
    uri = pyotp.TOTP(secret).provisioning_uri(name=config.USER, issuer_name='Codex Manager')
    output = io.BytesIO()
    qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).save(output)
    return {'secret': secret, 'uri': uri, 'qr': 'data:image/svg+xml;base64,' + base64.b64encode(output.getvalue()).decode()}


def _new_recovery(db):
    codes = [secrets.token_hex(10).upper() for _ in range(10)]
    db.execute('DELETE FROM recovery')
    db.executemany('INSERT INTO recovery VALUES (?)', [(_hash('recovery:' + code),) for code in codes])
    return ['-'.join(code[i:i + 4] for i in range(0, 20, 4)) for code in codes]


def confirm_setup(session_id, code, ip, remember=False):
    with _db() as db:
        session = db.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
        row = db.execute('SELECT * FROM challenges WHERE kind=? AND session_id=?', ('setup', session_id)).fetchone()
        if not session or session['expires'] <= time.time() or not row or row['expires'] <= time.time() or row['attempts'] >= 6:
            raise AuthError('La configuración caducó. Vuelve a empezar.', 400)
        if _limited(db, 'otp:' + ip) or _limited(db, 'otp:account', 30):
            raise AuthError('Demasiados intentos. Espera diez minutos.', 429)
        secret = _cipher().decrypt(row['data'].encode()).decode()
        counter = _counter(secret, code)
        db.execute('UPDATE challenges SET attempts=attempts+1 WHERE id=?', (row['id'],))
        if counter is None:
            _failure(db, 'otp:' + ip)
            _failure(db, 'otp:account')
            raise AuthError('Código incorrecto. Comprueba la hora automática del celular y reintenta.', 400)
        _set(db, 'totp', row['data'])
        _set(db, 'last_counter', counter)
        codes = _new_recovery(db)
        db.execute('DELETE FROM sessions')
        db.execute('DELETE FROM challenges')
        result = _new_session(db, session['user_agent'], True, remember is True)
        result['recovery_codes'] = codes
        return result


def security_status(session_id):
    with _db() as db:
        rows = db.execute('SELECT id,created,expires,last_seen,user_agent,remember FROM sessions WHERE expires>? AND password_tag=? AND mfa=1 ORDER BY last_seen DESC',
                          (time.time(), _password_tag())).fetchall()
        return {'enabled': bool(_get(db, 'totp')), 'remember_days': config.SESSION_DAYS,
                'recovery_remaining': db.execute('SELECT COUNT(*) FROM recovery').fetchone()[0],
                'sessions': [{**dict(row), 'current': row['id'] == session_id} for row in rows]}


def regenerate_recovery(session_id, password, code, ip):
    with _db() as db:
        _require_owner(db, password, code, ip)
        db.execute('DELETE FROM sessions WHERE id!=?', (session_id,))
        db.execute('DELETE FROM challenges')
        return {'recovery_codes': _new_recovery(db)}


def revoke_sessions(session_id, target):
    with _db() as db:
        if target == 'others':
            db.execute('DELETE FROM challenges WHERE session_id IS NULL OR session_id!=?', (session_id,))
            db.execute('DELETE FROM sessions WHERE id!=?', (session_id,))
        else:
            db.execute('DELETE FROM challenges WHERE session_id=?', (str(target),))
            db.execute('DELETE FROM sessions WHERE id=?', (str(target),))
