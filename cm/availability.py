"""Disponibilidad observada, no saldos inventados. Enrutamiento acotado entre CLI."""
import re, time
from . import config
from .util import read_json, write_json


def failure(info, error=''):
    if (info.get('limits') or {}).get('status') == 'rejected': return 'quota'
    text = ((info.get('result') or {}).get('text', '') + ' ' + error).lower()
    if re.search(r'insufficient_quota|credit balance (?:is )?too low|out of credits|usage limit|rate.limit.exceeded|(?:hit|reached|exceeded).{0,40}(?:limit|quota)|(?:quota|credit).{0,30}(?:exhausted|exceeded|depleted)', text): return 'quota'
    if re.search(r'not logged in|invalid.api.key|authentication (?:failed|required)|unauthorized|login required', text): return 'auth'
    if re.search(r'overloaded|service unavailable|temporarily unavailable|too many requests|\b429\b', text): return 'temporary'
    return ''


def status():
    data = read_json(config.CONFIG / 'provider-availability.json', {})
    now = time.time()
    return {p: {**data.get(p, {}), 'available': data.get(p, {}).get('retry_at', 0) <= now} for p in config.PROVIDERS}


def observe(provider, reason=''):
    data = read_json(config.CONFIG / 'provider-availability.json', {})
    data[provider] = {'reason': reason, 'checked_at': time.time(), 'retry_at': time.time() + (900 if reason in ('quota', 'auth') else 60) if reason else 0}
    write_json(config.CONFIG / 'provider-availability.json', data)


def choose(preferred, tried=()):
    providers = [p for p in (preferred, *config.PROVIDERS) if p in config.PROVIDERS and p not in tried]
    providers = list(dict.fromkeys(providers))
    states = status()
    available = [p for p in providers if states[p]['available']]
    # Si ambos tienen observaciones antiguas negativas, un nuevo mensaje puede comprobarlos una vez.
    return (available or sorted(providers, key=lambda p: states[p].get('checked_at', 0)) or [None])[0]
