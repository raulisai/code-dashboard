"""Git del proyecto: estado, diferencias, historial y commit desde la web.

El push sigue bloqueado como en el resto del servidor (CODEX_GIT_PUSH=0).
"""
import threading, time
from . import config, files
from .util import run_full

COMMITS_LOCK = threading.Lock()
COMMITS_CACHE = {'data': [], 'expires': 0.0}


def git(project, *args, timeout=15):
    root = files.project_root(project)
    # Leer un repositorio importado no ejecuta fsmonitor, hooks ni herramientas externas.
    settings = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
                '-c', f'core.worktree={root}', '-c', 'core.pager=cat',
                '-c', 'log.showSignature=false', '-c', 'commit.gpgSign=false',
                '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']
    return run_full(['git', *settings, '-C', str(root), *args], timeout=timeout)


def status(project):
    if not (config.PROJECTS / project / '.git').exists():
        return {'repo': False}
    _, branch, _ = git(project, 'rev-parse', '--abbrev-ref', 'HEAD')
    _, porcelain, _ = git(project, 'status', '--porcelain=v1', '-uall')
    files = []
    for line in porcelain.splitlines()[:500]:
        code, path = line[:2], line[3:]
        if ' -> ' in path: path = path.split(' -> ', 1)[1]
        files.append({'code': code, 'path': path.strip('"')})
    _, log, _ = git(project, 'log', '-15', '--pretty=%h%x1f%an%x1f%ar%x1f%s')
    commits = [dict(zip(('sha', 'author', 'when', 'subject'), line.split('\x1f'))) for line in log.splitlines() if line.count('\x1f') == 3]
    return {'repo': True, 'branch': branch.strip() or '(sin commits)', 'files': files, 'commits': commits}


def diff(project, path=''):
    args = ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', '--stat=120']
    _, stat, _ = git(project, *args)
    target = ['--', path] if path else []
    code, text, err = git(project, 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', *target)
    if code != 0:  # repositorio sin commits todavía
        code, text, err = git(project, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', *target)
    if path and not text:
        # Archivo nuevo sin seguimiento: se muestra completo como añadido.
        _, text, _ = git(project, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '/dev/null', path)
    return {'stat': stat, 'diff': text[:400000], 'truncated': len(text) > 400000}


def commit(project, message):
    message = ' '.join(str(message or '').split())[:300]
    if not message: return False, 'Escribe un mensaje para el commit'
    if not (config.PROJECTS / project / '.git').exists():
        code, _, err = git(project, 'init', '-q', '-b', 'main')
        if code != 0: return False, err.strip() or 'No se pudo inicializar el repositorio'
    code, _, err = git(project, 'add', '-A', timeout=60)
    if code != 0: return False, err.strip()
    code, out, err = git(project, 'commit', '-q', '-m', message, timeout=60)
    if code != 0: return False, (err or out).strip() or 'Nada que confirmar'
    invalidate()
    _, sha, _ = git(project, 'rev-parse', '--short', 'HEAD')
    return True, f'Commit {sha.strip()} creado'


def latest_commits(projects):
    now = time.monotonic()
    with COMMITS_LOCK:
        if COMMITS_CACHE['expires'] > now: return COMMITS_CACHE['data']
        out = []
        for p in projects:
            if (p / '.git').exists():
                _, line, _ = git(p.name, 'log', '-1', '--pretty=%h|%ad|%s', '--date=short', timeout=4)
                if line.strip():
                    sha, date, subject = (line.strip().split('|', 2) + ['', '', ''])[:3]
                    out.append({'project': p.name, 'sha': sha, 'date': date, 'subject': subject})
        COMMITS_CACHE.update({'data': out, 'expires': now + 60})
        return out


def invalidate():
    with COMMITS_LOCK: COMMITS_CACHE['expires'] = 0.0
