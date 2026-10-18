"""Cupo de Claude y Codex (ventanas de 5 h y semanal) leído en el host con bin/cm-quota.py.

Se guarda en memoria unos minutos: las lecturas llaman a Anthropic y a Codex, y varias pestañas no deben repetirlas.
"""
import threading, time
from datetime import datetime
from . import config, repos

HELPER = f'{config.HOST_APP_DIR}/bin/cm-quota.py'
TTL = 120
LOCK = threading.Lock()
_cache = {'at': 0, 'data': None}


def _epoch(value):
    if isinstance(value, (int, float)): return float(value)
    try: return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError: return None


def _provider(raw):
    raw = raw if isinstance(raw, dict) else {'state': 'error', 'error': 'sin datos'}
    windows = [{'minutes': w.get('minutes'), 'used': max(0.0, min(100.0, float(w.get('used') or 0))), 'resets_at': _epoch(w.get('resets_at'))}
               for w in raw.get('windows') or [] if isinstance(w, dict)]
    out = {'state': raw.get('state', 'error'), 'windows': windows}
    for key in ('plan', 'credits', 'error'):
        if raw.get(key) is not None: out[key] = raw[key]
    return out


def read(refresh=False):
    """Devuelve el último cupo; si es viejo (o se pide) lo vuelve a leer. Ante un fallo conserva la lectura anterior marcada como vieja."""
    with LOCK:
        if _cache['data'] and not refresh and time.time() - _cache['at'] < TTL: return _cache['data']
        try:
            result = repos.host_op({}, 60, HELPER)
            data = {'claude': _provider(result.get('claude')), 'codex': _provider(result.get('codex')), 'checked_at': time.time(), 'stale': False}
        except repos.RepoError as error:
            if not _cache['data']: return {'claude': {'state': 'error', 'windows': [], 'error': str(error)}, 'codex': {'state': 'error', 'windows': [], 'error': str(error)},
                                           'checked_at': None, 'stale': True}
            return {**_cache['data'], 'stale': True}
        _cache.update(at=time.time(), data=data)
        return data
