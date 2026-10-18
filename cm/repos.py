"""Repositorios remotos al crear proyectos.

- Importar: validar (ls-remote) y clonar con las credenciales SSH del host mediante
  `bin/cm-repo.py`; el contenedor del panel no guarda llaves.
- Crear en GitHub: API REST con un token que el usuario conecta en Ajustes (cifrado
  con la clave del panel) y primer push por SSH desde el host. Después no se hace push
  automático: el resto del servidor mantiene el push bloqueado por defecto.
"""
import base64, hmac, json, re, secrets, shutil, threading, time, urllib.error, urllib.request
from cryptography.fernet import Fernet, InvalidToken
from . import config, tmux
from .util import read_json, write_json

HELPER = f'{config.HOST_APP_DIR}/bin/cm-repo.py'
LIMIT = threading.BoundedSemaphore(2)
URL = re.compile(r'(?:https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/|ssh://(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(?::[0-9]{1,5})?/'
                 r'|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[A-Za-z0-9_./~-]+')
GITHUB = re.compile(r'(?:https://)?(?:www\.)?github\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?')
SHORT = re.compile(r'([A-Za-z0-9-]{1,39})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?')
BRANCH = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}')
TOKEN = re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})')
API = 'https://api.github.com'


class RepoError(Exception):
    pass


def normalize(raw):
    """URL lista para Git y nombre del repositorio. GitHub se usa por SSH: la llave del
    servidor da acceso a repos privados y sirve después para subir cambios."""
    url = str(raw or '').strip()
    if not url: raise RepoError('Pega la URL del repositorio')
    if len(url) > 300 or any(char.isspace() or ord(char) < 32 for char in url): raise RepoError('La URL del repositorio no es válida')
    if re.match(r'https?://[^/]*@', url): raise RepoError('No pongas usuario, contraseña ni tokens dentro de la URL')
    match = GITHUB.fullmatch(url) or SHORT.fullmatch(url)
    if match: url = f'git@github.com:{match[1]}/{match[2]}.git'
    if url.startswith('http://'): raise RepoError('Usa https:// o SSH (git@…)')
    if not URL.fullmatch(url) or '..' in url:
        raise RepoError('URL no válida. Ejemplos: https://github.com/usuario/repo o git@github.com:usuario/repo.git')
    name = re.sub(r'\.git$', '', re.split(r'[/:]', url.rstrip('/'))[-1])
    return url, name


def suggested_name(repo):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9-]', '-', repo.lower())).strip('-')[:40].strip('-')


def valid_branch(branch):
    return not branch or (BRANCH.fullmatch(branch) and '..' not in branch)


def host_op(payload, timeout, helper=HELPER):
    """Ejecuta un helper de bin/ (por defecto cm-repo.py) en el host (tmux) y espera su result.json."""
    if not LIMIT.acquire(timeout=10): raise RepoError('Hay otras operaciones de repositorio en curso; reintenta en unos segundos')
    op_id = time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)
    folder = config.CONFIG / 'repo-ops' / op_id
    session = f'cmj-repo-{op_id}'
    try:
        folder.mkdir(parents=True, mode=0o700)
        write_json(folder / 'request.json', payload)
        ok, error = tmux.new_session(session, config.HOST_PROJECTS, ['/usr/bin/python3', helper, config.host_path(folder)])
        if not ok: raise RepoError(f'No se pudo ejecutar Git en el servidor: {error}')
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            result = read_json(folder / 'result.json', None)
            if result is not None: return result
            if time.monotonic() - started > 5 and not tmux.has_session(session):
                result = read_json(folder / 'result.json', None)
                if result is not None: return result
                raise RepoError('El proceso de Git terminó sin responder')
            time.sleep(0.25)
        tmux.kill_session(session)
        raise RepoError('Git tardó demasiado; reintenta o revisa el repositorio')
    finally:
        LIMIT.release()
        shutil.rmtree(folder, ignore_errors=True)


def check(raw):
    url, repo = normalize(raw)
    result = host_op({'op': 'check', 'url': url}, 50)
    if not result.get('ok'): raise RepoError(result.get('error') or 'No se pudo acceder al repositorio')
    return {'url': url, 'repo': repo, 'suggested': suggested_name(repo), 'default_branch': result.get('default_branch', ''),
            'branches': result.get('branches', []), 'empty': bool(result.get('empty'))}


def clone(url, staging, name, branch=''):
    if not valid_branch(branch): raise RepoError('Rama inválida')
    result = host_op({'op': 'clone', 'url': url, 'projects_root': config.HOST_PROJECTS, 'name': name, 'staging': staging.name, 'branch': branch}, 620)
    if not result.get('ok'): raise RepoError(result.get('error') or 'No se pudo clonar el repositorio')


def push(name):
    result = host_op({'op': 'push', 'projects_root': config.HOST_PROJECTS, 'name': name}, 200)
    if not result.get('ok'): raise RepoError(result.get('error') or 'No se pudo subir el proyecto')


# ---------------------------------------------------------------- GitHub

def _cipher():
    from . import auth
    return Fernet(base64.urlsafe_b64encode(hmac.digest(auth._secret(), b'cm-github-token-v1', 'sha256')))


def _github_file():
    return config.CONFIG / 'github.json'


def _token():
    data = read_json(_github_file(), {})
    try: return _cipher().decrypt(data['token'].encode()).decode() if data.get('token') else ''
    except (InvalidToken, ValueError, KeyError): return ''


def _api(method, path, token, body=None):
    request = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={
        'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codex-manager', **({'Content-Type': 'application/json'} if body is not None else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read(1_000_000) or b'{}'), response.headers
    except urllib.error.HTTPError as error:
        try: data = json.loads(error.read(100_000) or b'{}')
        except ValueError: data = {}
        return error.code, data, error.headers
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RepoError('No se pudo conectar con GitHub; reintenta en un momento')


def github_status():
    data = read_json(_github_file(), {})
    return {'connected': bool(data.get('token')), 'login': data.get('login', ''), 'connected_at': data.get('connected_at')}


def github_connect(raw):
    token = str(raw or '').strip()
    if not TOKEN.fullmatch(token): raise RepoError('Pega un token de GitHub (empieza por github_pat_ o ghp_)')
    status, data, headers = _api('GET', '/user', token)
    if status == 401: raise RepoError('GitHub rechazó el token: revisa que no haya caducado')
    if status != 200 or not data.get('login'): raise RepoError('GitHub no aceptó el token')
    scopes = headers.get('X-OAuth-Scopes')
    # Los tokens clásicos informan sus scopes; los de grano fino se comprueban al crear el primer repo.
    if scopes is not None and not {'repo', 'public_repo'} & {s.strip() for s in scopes.split(',')}:
        raise RepoError('El token no permite crear repositorios: dale el permiso «repo»')
    write_json(_github_file(), {'token': _cipher().encrypt(token.encode()).decode(), 'login': data['login'], 'connected_at': time.time()})
    return github_status()


def github_disconnect():
    _github_file().unlink(missing_ok=True)
    return github_status()


def github_create(name, description=''):
    token = _token()
    if not token: raise RepoError('Conecta GitHub en Ajustes para crear el repositorio')
    summary = ' '.join(str(description or '').split())[:300]
    status, data, _ = _api('POST', '/user/repos', token, {'name': name, 'description': summary, 'private': True, 'auto_init': False})
    if status == 201 and data.get('ssh_url'): return {'full_name': data['full_name'], 'ssh_url': data['ssh_url'], 'html_url': data.get('html_url', '')}
    if status == 422: raise RepoError(f'Ya existe un repositorio «{name}» en tu GitHub')
    if status == 401: raise RepoError('El token de GitHub caducó: vuelve a conectarlo en Ajustes')
    if status in (403, 404): raise RepoError('El token de GitHub no tiene permiso para crear repositorios')
    raise RepoError(data.get('message') or f'GitHub respondió {status}')
