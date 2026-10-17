#!/usr/bin/env python3
"""Operaciones Git con las credenciales del host (el contenedor del panel no las tiene).

Recibe un directorio con `request.json` y deja `result.json`:
- check: comprueba que el repositorio existe y es accesible (ls-remote) y lista sus ramas.
- clone: clona en el directorio temporal de creación de un proyecto (vacío).
- push:  sube la rama actual de un proyecto a su `origin` (solo al crearlo con su repo).

Solo admite URLs https/ssh, sin pedir contraseñas, sin transportes externos ni submódulos.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

URL = re.compile(r'(?:https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/|ssh://(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(?::[0-9]{1,5})?/'
                 r'|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[A-Za-z0-9_./~-]+')
PROJECT = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?')
BRANCH = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}')
ERRORS = (
    ('Remote branch', 'Esa rama no existe en el repositorio'),
    ('Repository not found', 'El repositorio no existe o esta cuenta no tiene acceso'),
    ('not found', 'El repositorio no existe o esta cuenta no tiene acceso'),
    ('Permission denied', 'Sin permiso: la llave SSH del servidor no tiene acceso a ese repositorio'),
    ('could not read Username', 'No existe o es privado: si es privado, usa la URL SSH (git@…)'),
    ('Authentication failed', 'No existe o es privado: si es privado, usa la URL SSH (git@…)'),
    ('Could not resolve host', 'No se encuentra el servidor de ese repositorio'),
    ('Host key verification failed', 'No se pudo verificar la identidad del servidor Git'),
    ('timed out', 'El servidor Git no respondió a tiempo'),
    ('rejected', 'El repositorio remoto rechazó la subida (¿ya tenía commits?)'),
)


def git_env():
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    ssh = subprocess.run(['git', 'config', '--global', '--get', 'core.sshCommand'], text=True, capture_output=True).stdout.strip() or 'ssh'
    env.update(GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='https:ssh', GCM_INTERACTIVE='never', LC_ALL='C.UTF-8',
               GIT_SSH_COMMAND=f'{ssh} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15')
    return env


def explain(stderr):
    text = ' '.join(str(stderr or '').split())
    for needle, message in ERRORS:
        if needle.lower() in text.lower(): return message
    return text[-300:] or 'Git falló sin dar detalles'


def git(args, timeout):
    try:
        result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args], text=True,
                                capture_output=True, timeout=timeout, env=git_env(), stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return 124, '', 'timed out'
    return result.returncode, result.stdout, result.stderr


def parse_refs(text):
    default, branches = '', []
    for line in text.splitlines():
        ref, _, name = line.partition('\t')
        if ref.startswith('ref: refs/heads/') and name == 'HEAD': default = ref[len('ref: refs/heads/'):]
        elif name.startswith('refs/heads/'): branches.append(name[len('refs/heads/'):])
    if default in branches: branches.remove(default); branches.insert(0, default)
    return default or (branches[0] if branches else ''), branches


def valid_url(url):
    return isinstance(url, str) and len(url) <= 300 and URL.fullmatch(url) and '..' not in url


def safe_dir(root, name, staging):
    """Ruta dentro de la carpeta de proyectos, sin enlaces: el proyecto o su temporal de creación."""
    root = Path(root).resolve()
    if not PROJECT.fullmatch(str(name or '')) or str(name).startswith(('cmr-', 'cmj-', 'cm-keepalive')): raise ValueError('Proyecto inválido')
    path = root / (staging if staging else name)
    if staging and not re.fullmatch(rf'\.{re.escape(name)}-creating-[A-Za-z0-9_]+', str(staging)): raise ValueError('Directorio temporal inválido')
    if path.is_symlink() or path.resolve().parent != root or not path.is_dir(): raise ValueError('Ruta inválida')
    return path


def handle(request):
    op, url = request.get('op'), request.get('url')
    if op in ('check', 'clone') and not valid_url(url): return {'ok': False, 'error': 'URL de repositorio no válida'}
    if op == 'check':
        code, out, err = git(['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*'], 40)
        if code: return {'ok': False, 'error': explain(err)}
        default, branches = parse_refs(out)
        return {'ok': True, 'default_branch': default, 'branches': branches[:200], 'empty': not branches}
    if op == 'clone':
        target = safe_dir(request['projects_root'], request['name'], request['staging'])
        if any(target.iterdir()): return {'ok': False, 'error': 'El directorio temporal no está vacío'}
        branch = str(request.get('branch') or '')
        if branch and (not BRANCH.fullmatch(branch) or '..' in branch): return {'ok': False, 'error': 'Rama inválida'}
        code, _, err = git(['clone', '--quiet', *(['--branch', branch] if branch else []), '--', url, str(target)], 600)
        return {'ok': True} if code == 0 else {'ok': False, 'error': explain(err)}
    if op == 'push':
        target = safe_dir(request['projects_root'], request['name'], '')
        code, _, err = git(['-C', str(target), 'push', '--quiet', '-u', 'origin', 'HEAD'], 180)
        return {'ok': True} if code == 0 else {'ok': False, 'error': explain(err)}
    return {'ok': False, 'error': 'Operación desconocida'}


def main():
    # Permisos normales en el código clonado: Docker copia los modos y la app no suele correr como root.
    os.umask(0o022)
    folder = Path(sys.argv[1]).resolve()
    try: result = handle(json.loads((folder / 'request.json').read_text()))
    except Exception as error: result = {'ok': False, 'error': str(error)[:300] or 'Error inesperado'}
    temporary = folder / 'result.json.tmp'
    temporary.write_text(json.dumps(result, ensure_ascii=False))
    os.replace(temporary, folder / 'result.json')


if __name__ == '__main__':
    main()
