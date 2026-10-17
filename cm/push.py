"""Avisos Web Push: funcionan con la PWA cerrada y se activan por dispositivo."""
import base64
import hashlib
import json
import logging
import os
import threading
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

from . import auth, config, runs, tasks
from .util import read_json, write_json

LOCK = threading.RLock()
LOG = logging.getLogger(__name__)
RETRY_AT = {}


def subscription_file(): return config.CONFIG / 'push-subscriptions.json'
def key_file(): return config.CONFIG / '.push-vapid.pem'
def b64(data): return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def private_key():
    with LOCK:
        path = key_file()
        if not path.exists():
            key = ec.generate_private_key(ec.SECP256R1())
            path.parent.mkdir(parents=True, exist_ok=True)
            data = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as handle: handle.write(data)
        return serialization.load_pem_private_key(path.read_bytes(), password=None)


def public_key():
    return b64(private_key().public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def validate(subscription):
    if not isinstance(subscription, dict): raise ValueError('Suscripción inválida')
    endpoint = subscription.get('endpoint', '')
    if not isinstance(endpoint, str) or len(endpoint) > 4000: raise ValueError('Endpoint inválido')
    url = urlsplit(endpoint)
    host = url.hostname or ''
    # No admitir URLs arbitrarias que pudieran acceder a servicios del VPS.
    allowed = host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com') or host.endswith(('.push.services.mozilla.com', '.notify.windows.com'))
    if url.scheme != 'https' or not allowed or url.username or url.password or url.port not in (None, 443):
        raise ValueError('Proveedor de notificaciones no admitido')
    keys = subscription.get('keys') or {}
    try:
        auth = base64.urlsafe_b64decode(keys['auth'] + '=' * (-len(keys['auth']) % 4))
        dh = base64.urlsafe_b64decode(keys['p256dh'] + '=' * (-len(keys['p256dh']) % 4))
        if len(auth) != 16 or len(dh) != 65: raise ValueError()
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), dh)
    except (KeyError, TypeError, ValueError) as error: raise ValueError('Claves de notificación inválidas') from error
    return {'endpoint': endpoint, 'keys': {'auth': keys['auth'], 'p256dh': keys['p256dh']}}


def finished_markers():
    return [f"task:{t.get('run_id') or t['id']}:{t['status']}" for t in tasks.task_records() if t['status'] in ('terminado', 'error')][-300:]


def subscribe(subscription, session_id=None):
    subscription = validate(subscription)
    sid = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    with LOCK:
        data = read_json(subscription_file(), {})
        if sid not in data and len(data) >= 16: raise ValueError('Máximo de 16 dispositivos; desactiva alguno primero')
        seen = data.get(sid, {}).get('seen', finished_markers())
        data[sid] = {'subscription': subscription, 'seen': seen, 'updated_at': time.time(), 'session_id': session_id}
        write_json(subscription_file(), data)
    return sid


def unsubscribe(endpoint):
    sid = hashlib.sha256(str(endpoint).encode()).hexdigest()
    with LOCK:
        data = read_json(subscription_file(), {}); data.pop(sid, None)
        write_json(subscription_file(), data)


def notifications():
    events = []
    for item in runs.all_pending_approvals():
        events.append((f"approval:{item['run_id']}:{item['id']}", {'title': f"{runs.label(item['provider'])} necesita tu aprobación",
                       'body': f"{item['project']}: {item['tool_name']}", 'url': f"/p/{item['project']}?chat={item.get('chat_id', 'main')}", 'tag': f"approval-{item['id']}"}))
    for task in tasks.task_records()[-300:]:
        if task['status'] not in ('terminado', 'error'): continue
        events.append((f"task:{task.get('run_id') or task['id']}:{task['status']}",
                       {'title': f"{runs.label(task['provider'])} {'terminó' if task['status'] == 'terminado' else 'necesita atención'}",
                        'body': task['project'], 'url': f"/p/{task['project']}?chat={task.get('chat_id', 'main')}", 'tag': f"task-{task['id']}"}))
    return events


def deliver_once():
    with LOCK: subscribers = read_json(subscription_file(), {})
    if not subscribers: return
    events = notifications()
    for sid, entry in subscribers.items():
        if not entry.get('session_id') or not auth.session_active(entry['session_id']):
            unsubscribe(entry['subscription']['endpoint'])
            continue
        if RETRY_AT.get(sid, 0) > time.monotonic(): continue
        for marker, payload in events:
            if marker in entry.get('seen', []): continue
            if not auth.session_active(entry['session_id']): break
            try:
                webpush(subscription_info=entry['subscription'], data=json.dumps(payload, ensure_ascii=False),
                        vapid_private_key=str(key_file()), vapid_claims={'sub': f'https://codex-dashboard.{config.DOMAIN}'}, ttl=3600, timeout=6)
            except WebPushException as error:
                status = getattr(error, 'status_code', None)
                if status is None and error.response is not None: status = error.response.status_code
                if status in (404, 410): unsubscribe(entry['subscription']['endpoint'])
                else: RETRY_AT[sid] = time.monotonic() + 60
                break
            except Exception:
                RETRY_AT[sid] = time.monotonic() + 60
                LOG.warning('No se pudo enviar una notificación; se reintentará')
                break
            with LOCK:
                current = read_json(subscription_file(), {})
                if sid not in current: break
                seen = current[sid].setdefault('seen', [])
                if marker not in seen: seen.append(marker)
                current[sid]['seen'] = seen[-600:]
                write_json(subscription_file(), current)
                entry = current[sid]


def worker():
    while True:
        try: deliver_once()
        except Exception: LOG.exception('Error en los avisos push')
        time.sleep(3)
