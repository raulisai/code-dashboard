"""Cabeceras, errores públicos y registro de seguridad sin datos de autenticación."""
import ipaddress
import json
import logging
import re
from datetime import datetime, timezone
from aiohttp import web
from . import config

SESSION_KEY = web.RequestKey('session', dict)
LOG = logging.getLogger('cm.security')
LOG.setLevel(logging.INFO)
LOG.propagate = False
if not LOG.handlers:
    LOG.addHandler(logging.StreamHandler())
EVENT_PATHS = {'/api/login', '/api/login/mfa', '/api/logout', '/api/security/setup', '/api/github',
               '/api/security/confirm', '/api/security/recovery', '/api/security/revoke'}


def expected_origin(request):
    if config.PUBLIC_ORIGIN:
        return config.PUBLIC_ORIGIN
    scheme = 'https' if request.secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'
    return f'{scheme}://{request.host}'


def client_ip(request):
    candidate = request.headers.get('X-Forwarded-For', '').split(',')[-1].strip() or request.remote or ''
    try: return str(ipaddress.ip_address(candidate))
    except ValueError: return 'unknown'


async def prepare(request, response):
    # on_response_prepare cubre también errores tempranos, FileResponse y el 101 de WebSocket.
    if not re.fullmatch(r'[A-Za-z0-9.\-]+(?::[0-9]{1,5})?', request.host):
        host = 'invalid'
    else:
        host = request.host
    csp = ("default-src 'self'; script-src 'self'; script-src-attr 'none'; "
           "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
           "font-src 'self' data:; media-src 'self' blob:; "
           f"connect-src 'self' wss://{host}; worker-src 'self' blob:; "
           "frame-src https:; object-src 'none'; base-uri 'none'; "
           "form-action 'self'; frame-ancestors 'none'")
    for name, value in {
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
    }.items():
        response.headers.setdefault(name, value)
    # La política de privacidad más estricta prevalece sobre el valor anterior.
    response.headers['Referrer-Policy'] = 'no-referrer'
    if expected_origin(request).startswith('https://'):
        response.headers.setdefault('Strict-Transport-Security', 'max-age=31536000')
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'


@web.middleware
async def middleware(request, handler):
    try:
        response = await handler(request)
    except web.HTTPException as error:
        if request.path.startswith('/api/'):
            message = 'Petición demasiado grande' if error.status == 413 else error.reason
            response = web.json_response({'message': message}, status=error.status, headers={'Cache-Control': 'no-store'})
        else:
            response = error
    except Exception:
        LOG.exception('Error interno de una petición; no se registra su contenido')
        response = web.json_response({'message': 'Error interno. Reintenta o revisa los logs del panel.'}, status=500,
                                     headers={'Cache-Control': 'no-store'})
    if request.path in EVENT_PATHS or response.status in (401, 403, 429):
        LOG.info(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'event': request.path[:100],
                             'status': response.status, 'ip': client_ip(request)}, ensure_ascii=True))
    return response
