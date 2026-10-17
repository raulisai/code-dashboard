"""Versionado automático: un commit por cada acción hecha desde Codex Manager.

Módulo autocontenido (solo biblioteca estándar) porque lo usan dos procesos:
el panel, dentro del contenedor, y `bin/cm-runner.py`, en el host, antes y
después de cada ejecución de un agente. Ambos se coordinan con un flock en
`.git/codex-manager.lock`, que funciona igual a través del bind mount.

Cada commit automático lleva trailers `Codex-Manager-*` (acción, agente,
ejecución, versión restaurada…) que el historial web usa para mostrar quién
hizo cada cambio y para calcular el «deshacer» rápido.
"""
import fcntl, os, re, subprocess, time
from contextlib import contextmanager
from pathlib import Path

PREFIX = 'Codex-Manager'
LARGE_FILE = 50 * 1024 * 1024
EXCLUDE_MARK = '# Codex Manager: nunca versionar secretos ni dependencias'
LARGE_MARK = '# Codex Manager: archivos de más de 50 MB (no se versionan)'
# Se añaden a .git/info/exclude: no modifican el .gitignore del proyecto y solo
# afectan a archivos sin seguimiento (lo ya versionado sigue versionado).
SAFE_EXCLUDES = ['.env', '.env.*', '!.env.example', '*.pem', '*.key', 'node_modules/', '__pycache__/', '.venv/', 'venv/', '.codex-manager/']
# Solo en repositorios creados por el panel, donde nadie ha decidido aún qué versionar.
NEW_REPO_EXCLUDES = ['dist/', 'build/', '.next/', '.cache/', 'target/', '*.log', '.DS_Store']
IN_PROGRESS = {'MERGE_HEAD': 'una fusión', 'REVERT_HEAD': 'una reversión', 'CHERRY_PICK_HEAD': 'un cherry-pick',
               'rebase-merge': 'un rebase', 'rebase-apply': 'un rebase', 'BISECT_LOG': 'un bisect'}
# Leer o confirmar en un repositorio no ejecuta fsmonitor, hooks ni firmas.
SETTINGS = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat',
            '-c', 'log.showSignature=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false',
            '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'advice.detachedHead=false']
FALLBACK_IDENTITY = ('Codex Manager', 'codex-manager@localhost')


class VersionError(Exception):
    pass


def git(root, *args, timeout=30):
    """Devuelve (código, stdout, stderr). Reintenta si otro proceso tiene el index bloqueado."""
    root = str(root)
    argv = ['git', *SETTINGS, '-c', f'core.worktree={root}', '-C', root, *args]
    for attempt in range(6):
        try:
            result = subprocess.run(argv, text=True, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                                    env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'LC_ALL': 'C.UTF-8'})
        except subprocess.TimeoutExpired:
            return 124, '', f'Git tardó más de {timeout} s'
        except OSError as error:
            return 127, '', str(error)
        if result.returncode and 'index.lock' in result.stderr and attempt < 5:
            time.sleep(0.4 * (attempt + 1)); continue
        return result.returncode, result.stdout, result.stderr
    return 1, '', 'El repositorio está bloqueado por otro proceso'


def ok(root, *args, timeout=30):
    code, out, err = git(root, *args, timeout=timeout)
    if code: raise VersionError((err or out).strip().splitlines()[-1] if (err or out).strip() else f'git {args[0]} falló')
    return out


def is_repo(root):
    return (Path(root) / '.git').exists()


def git_dir(root):
    path = Path(root) / '.git'
    if path.is_dir(): return path
    code, out, _ = git(root, 'rev-parse', '--absolute-git-dir')
    return Path(out.strip()) if code == 0 and out.strip() else None


@contextmanager
def locked(root, wait=60):
    """Exclusión entre hilos del panel y el runner del host (flock por descripción de archivo)."""
    folder = git_dir(root)
    if not folder:
        yield; return
    handle = open(folder / 'codex-manager.lock', 'a')
    try:
        deadline = time.monotonic() + wait
        while True:
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); break
            except BlockingIOError:
                if time.monotonic() > deadline: raise VersionError('Otra operación de versiones sigue en curso; reintenta en unos segundos')
                time.sleep(0.2)
        yield
    finally:
        handle.close()


def operation_in_progress(root):
    folder = git_dir(root)
    if not folder: return ''
    for name, label in IN_PROGRESS.items():
        if (folder / name).exists(): return label
    return ''


def head(root):
    code, out, _ = git(root, 'rev-parse', '--verify', '-q', 'HEAD^{commit}')
    return out.strip() if code == 0 else ''


def branch(root):
    code, out, _ = git(root, 'symbolic-ref', '-q', '--short', 'HEAD')
    return out.strip() if code == 0 else ''


def _exclude_file(root):
    folder = git_dir(root)
    if not folder: return None
    (folder / 'info').mkdir(parents=True, exist_ok=True)
    return folder / 'info' / 'exclude'


def _append_excludes(root, mark, patterns):
    path = _exclude_file(root)
    if not path: return
    try: current = path.read_text()
    except OSError: current = ''
    lines = set(current.splitlines())
    missing = [p for p in patterns if p not in lines]
    if not missing: return
    block = ('' if not current or current.endswith('\n') else '\n') + ('' if mark in lines else mark + '\n') + '\n'.join(missing) + '\n'
    with open(path, 'a') as handle: handle.write(block)


def _escape_pattern(path):
    escaped = re.sub(r'([*?\[\]\\])', r'\\\1', path)
    return '/' + ('\\' + escaped if escaped[:1] in ('#', '!') else escaped)


def ensure_repo(root):
    """Inicializa el repositorio si falta. Devuelve True si lo acaba de crear."""
    created = False
    if not is_repo(root):
        code, _, err = git(root, 'init', '-q', '-b', 'main')
        if code: raise VersionError(err.strip() or 'No se pudo inicializar el repositorio')
        created = True
    _append_excludes(root, EXCLUDE_MARK, SAFE_EXCLUDES + (NEW_REPO_EXCLUDES if created else []))
    if git(root, 'var', 'GIT_COMMITTER_IDENT')[0]:
        # Sin identidad global ni local: una de respaldo solo para este repositorio.
        for key, value in zip(('user.name', 'user.email'), FALLBACK_IDENTITY): git(root, 'config', key, value)
    return created


def _exclude_large(root):
    code, out, _ = git(root, 'ls-files', '-z', '--others', '--exclude-standard', timeout=60)
    if code: return []
    large = []
    for relative in filter(None, out.split('\0')):
        try:
            if os.lstat(Path(root) / relative).st_size > LARGE_FILE: large.append(relative)
        except OSError: pass
    if large: _append_excludes(root, LARGE_MARK, [_escape_pattern(p) for p in large])
    return large


def message(subject, action, body='', trailers=None):
    subject = ' '.join(str(subject or '').split())[:120] or 'Cambios'
    body = str(body or '').strip()
    if len(body) > 3000: body = body[:3000] + '…'
    lines = [f'{PREFIX}-Action: {action}'] + [f'{PREFIX}-{key}: {" ".join(str(value).split())}' for key, value in (trailers or {}).items() if value]
    return '\n\n'.join(part for part in (subject, body, '\n'.join(lines)) if part)


def staged_empty(root):
    return git(root, 'diff', '--cached', '--quiet', '--no-ext-diff', '--no-textconv')[0] == 0


def commit_staged(root, subject, action, body='', trailers=None, allow_empty=False):
    if not allow_empty and staged_empty(root): return ''
    ok(root, 'commit', '-q', '--no-verify', '--cleanup=whitespace', *(['--allow-empty'] if allow_empty else []),
       '-m', message(subject, action, body, trailers), timeout=120)
    return head(root)


def snapshot_locked(root, subject, action, body='', trailers=None):
    """Confirma todo lo pendiente. Devuelve el sha nuevo o '' si no había cambios."""
    busy = operation_in_progress(root)
    if busy: raise VersionError(f'Hay {busy} a medias en el repositorio; termínala o cancélala antes de guardar versiones')
    large = _exclude_large(root)
    ok(root, 'add', '-A', timeout=180)
    if not head(root):
        if staged_empty(root): return ''
        subject, action, body = 'Versión inicial del proyecto', 'init', f'Primera instantánea guardada automáticamente antes de: {subject}'
    if large: body = (body + '\n\n' if body else '') + 'No versionados por tamaño: ' + ', '.join(large[:20])
    return commit_staged(root, subject, action, body, trailers)


def snapshot(root, subject, action='manual', body='', trailers=None, create=True):
    """Guarda una versión si hay cambios. Nunca lanza: devuelve {'sha', 'head', 'error'}."""
    root = Path(root)
    try:
        if not is_repo(root) and not create: return {'sha': '', 'head': '', 'error': ''}
        ensure_repo(root)
        with locked(root):
            sha = snapshot_locked(root, subject, action, body, trailers)
            return {'sha': sha, 'head': head(root), 'error': ''}
    except (VersionError, OSError) as error:
        return {'sha': '', 'head': head(root) if is_repo(root) else '', 'error': str(error)}
