"""Versiones del proyecto (Git) desde la web: historial, ramas y vuelta atrás.

Cada acción del panel (agente, editor, archivos, despliegue, restauración…)
queda como un commit propio gracias a `vcs.snapshot`. Las operaciones que
cambian los archivos nunca pierden trabajo: antes guardan lo pendiente como
versión y restaurar crea un commit nuevo en lugar de reescribir el historial.
El push sigue bloqueado como en el resto del servidor (CODEX_GIT_PUSH=0).
"""
import re, shutil, threading, time
from pathlib import Path
from . import config, files, vcs
from .util import read_json
from .vcs import VersionError

COMMITS_LOCK = threading.Lock()
COMMITS_CACHE = {'data': [], 'expires': 0.0}
SHA = re.compile(r'[0-9a-f]{4,64}')
BRANCH = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,79}')
FIELDS = ('sha', 'short', 'parents', 'author', 'time', 'subject', 'action', 'provider', 'restores', 'reverts', 'run', 'refs')
TRAILERS = ('Action', 'Provider', 'Restores', 'Reverts', 'Run')
LOG_FORMAT = '%x1e' + '%x1f'.join(['%H', '%h', '%P', '%an', '%at', '%s'] +
                                  [f'%(trailers:key={vcs.PREFIX}-{key},valueonly,separator=%x2C)' for key in TRAILERS] + ['%D'])
DIFF = ('--no-color', '--no-ext-diff', '--no-textconv')
MAX_DIFF = 400000


def root_of(project):
    return files.project_root(project)


def git(project, *args, timeout=15):
    return vcs.git(root_of(project), *args, timeout=timeout)


def enabled():
    from . import runs
    return runs.load_settings().get('auto_commit', 'on') == 'on'


def record(project, subject, action, body='', trailers=None):
    """Guarda una versión tras una acción del panel (si el versionado automático está activo)."""
    if not enabled(): return {'sha': '', 'head': '', 'error': ''}
    result = vcs.snapshot(root_of(project), subject, action, body, trailers)
    if result['sha']: invalidate()
    return result


def versioned(project, subject, action, func):
    """Ejecuta una acción de archivos con su propio commit; lo pendiente de antes va aparte."""
    record(project, f'Cambios pendientes antes de: {subject}'[:110], 'pending')
    result = func()
    record(project, subject, action)
    return result


# ---------------------------------------------------------------- lectura

def _parse_log(text):
    commits = []
    for chunk in text.split('\x1e')[1:]:
        line, _, rest = chunk.partition('\n')
        values = line.split('\x1f')
        if len(values) != len(FIELDS): continue
        row = dict(zip(FIELDS, values))
        row['parents'] = row['parents'].split()
        row['time'] = int(row['time'] or 0)
        refs, row['head'], row['tags'] = [], False, []
        for ref in filter(None, (x.strip() for x in row['refs'].split(', '))):
            if ref == 'HEAD': row['head'] = True
            elif ref.startswith('HEAD -> '): row['head'] = True; refs.append(ref[8:])
            elif ref.startswith('tag: '): row['tags'].append(ref[5:])
            else: refs.append(ref)
        row['refs'] = refs
        for key in ('restores', 'reverts'):
            if not re.fullmatch(r'[0-9a-f]{40,64}', row[key]): row[key] = ''
        stat = re.search(r'(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?', rest)
        row['files'], row['added'], row['deleted'] = (int(stat.group(1)), int(stat.group(2) or 0), int(stat.group(3) or 0)) if stat else (0, 0, 0)
        commits.append(row)
    return commits


def branch_names(root):
    code, out, _ = vcs.git(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/')
    return out.split() if code == 0 else []


def resolve(root, rev):
    """Sha completo de una versión o rama conocida; nada de opciones ni expresiones arbitrarias."""
    rev = str(rev or '').strip()
    if rev == 'HEAD': ref = 'HEAD'
    elif rev in branch_names(root): ref = f'refs/heads/{rev}'
    elif SHA.fullmatch(rev): ref = rev
    else: raise VersionError('Versión o rama inválida')
    code, out, _ = vcs.git(root, 'rev-parse', '--verify', '-q', f'{ref}^{{commit}}')
    if code or not out.strip(): raise VersionError('No existe esa versión')
    return out.strip()


def _trailer(root, sha, key):
    code, out, _ = vcs.git(root, 'log', '-1', f'--format=%(trailers:key={vcs.PREFIX}-{key},valueonly,separator=%x2C)', sha)
    value = out.strip().split(',')[0] if code == 0 else ''
    return value if re.fullmatch(r'[0-9a-f]{40,64}', value) else ''


def effective(root, sha):
    """La versión de contenido que representa un commit (sigue cadenas de restauraciones)."""
    for _ in range(50):
        target = _trailer(root, sha, 'Restores')
        if not target: break
        sha = target
    return sha


def _parent(root, sha):
    code, out, _ = vcs.git(root, 'rev-parse', '--verify', '-q', f'{sha}^1')
    return out.strip() if code == 0 else ''


def _commit_row(root, sha):
    code, out, _ = vcs.git(root, 'log', '-1', '--decorate-refs=refs/heads/', '--decorate-refs=refs/tags/', f'--format={LOG_FORMAT}', sha)
    rows = _parse_log(out) if code == 0 else []
    return rows[0] if rows else None


def undo_target(root, dirty=False):
    """A dónde lleva «Deshacer»: con cambios sin guardar, a la versión actual; si no, a la anterior."""
    current = vcs.head(root)
    if not current: return None
    if dirty: return {**_commit_row(root, current), 'pending': True}
    parent = _parent(root, effective(root, current))
    return _commit_row(root, parent) if parent else None


def deployments(project):
    """Versiones publicadas desde el panel (trabajos deploy/dev terminados con éxito)."""
    from . import runs
    rows = []
    for meta in runs.list_runs(project, kind='job', limit=40):
        if meta.get('action') not in ('deploy', 'dev') or not re.fullmatch(r'[0-9a-f]{40,64}', str(meta.get('commit', ''))): continue
        exit_data = read_json(config.JOBS / meta['id'] / 'exit.json', None)
        if exit_data and exit_data.get('code') == 0:
            rows.append({'sha': meta['commit'], 'at': exit_data.get('finished_at') or meta.get('created_at'), 'job': meta['id']})
    return rows


def busy(project):
    """Motivo por el que no conviene cambiar los archivos ahora mismo ('' si se puede)."""
    from . import lifecycle, runs, tasks
    if lifecycle.deleting(project): return 'El proyecto se está eliminando'
    if any(t['project'] == project and t['status'] == 'working' for t in tasks.task_records()):
        return 'Hay un agente trabajando en este proyecto. Espera a que termine o detenlo antes de cambiar de versión.'
    for meta in runs.list_runs(project, kind='job', limit=5):
        if not (config.JOBS / meta['id'] / 'exit.json').exists() and time.time() - meta.get('created_at', 0) < 3600:
            return 'Hay un despliegue en curso. Espera a que termine antes de cambiar de versión.'
    return ''


def status(project):
    root = root_of(project)
    if not vcs.is_repo(root):
        return {'repo': False, 'auto_commit': enabled(), 'blocked': busy(project)}
    current = vcs.head(root)
    _, porcelain, _ = vcs.git(root, 'status', '--porcelain=v1', '-uall', timeout=30)
    changes = []
    for line in porcelain.splitlines()[:500]:
        code, path = line[:2], line[3:]
        if ' -> ' in path: path = path.split(' -> ', 1)[1]
        changes.append({'code': code, 'path': path.strip('"')})
    deployed = deployments(project)
    names = branch_names(root)
    data = {'repo': True, 'auto_commit': enabled(), 'branch': vcs.branch(root), 'head': current, 'short': current[:7],
            'detached': bool(current) and not vcs.branch(root), 'operation': vcs.operation_in_progress(root),
            'files': changes, 'branches': len(names), 'blocked': busy(project),
            'undo': undo_target(root, bool(changes)) if current else None,
            'deployed': deployed[0] if deployed else None}
    return data


def log(project, ref='', skip=0, limit=40):
    root = root_of(project)
    if not vcs.is_repo(root) or not vcs.head(root): return {'commits': [], 'more': False, 'ref': ref}
    target = resolve(root, ref) if ref else 'HEAD'
    limit, skip = max(1, min(100, int(limit))), max(0, int(skip))
    code, out, err = vcs.git(root, 'log', *DIFF, '--decorate-refs=refs/heads/', '--decorate-refs=refs/tags/', f'--format={LOG_FORMAT}', '--shortstat',
                             f'--max-count={limit + 1}', f'--skip={skip}', target, timeout=30)
    if code: raise VersionError(err.strip() or 'No se pudo leer el historial')
    commits = _parse_log(out)
    current = vcs.head(root)
    deployed = {}
    for row in deployments(project): deployed.setdefault(row['sha'], row['at'])
    production = next(iter(deployed), '')
    only = set()
    if ref and target != current:
        # Versiones que solo existen en esa rama (las «alternativas» respecto a la actual).
        code, out, _ = vcs.git(root, 'rev-list', '--max-count=500', target, '--not', 'HEAD')
        only = set(out.split()) if code == 0 else set()
    for row in commits:
        row['current'] = row['sha'] == current
        row['deployed_at'] = deployed.get(row['sha'])
        row['production'] = row['sha'] == production
        row['only_here'] = row['sha'] in only
    return {'commits': commits[:limit], 'more': len(commits) > limit, 'ref': ref, 'skip': skip}


def show(project, rev):
    root = root_of(project)
    sha = resolve(root, rev)
    row = _commit_row(root, sha)
    _, body, _ = vcs.git(root, 'log', '-1', '--format=%b', sha)
    # Sin los trailers técnicos: solo la descripción legible.
    row['body'] = '\n'.join(line for line in body.strip().splitlines() if not line.startswith(f'{vcs.PREFIX}-')).strip()
    parent = _parent(root, sha)
    base = parent or vcs.ok(root, 'hash-object', '-t', 'tree', '/dev/null').strip()
    _, names, _ = vcs.git(root, 'diff', '--name-status', '-z', '-M', *DIFF, base, sha, timeout=30)
    _, numstat, _ = vcs.git(root, 'diff', '--numstat', '-z', '-M', *DIFF, base, sha, timeout=30)
    tokens = names.split('\0')
    changes, index = [], 0
    while index < len(tokens) and tokens[index]:
        code = tokens[index]
        if code[:1] in ('R', 'C'):
            changes.append({'code': code[0], 'from': tokens[index + 1], 'path': tokens[index + 2]}); index += 3
        else:
            changes.append({'code': code[0], 'path': tokens[index + 1]}); index += 2
    counts = {}
    parts = numstat.split('\0')
    index = 0
    while index < len(parts) and parts[index]:
        added, deleted, path = (parts[index].split('\t', 2) + ['', '', ''])[:3]
        if not path: path = parts[index + 2] if index + 2 < len(parts) else ''; index += 2
        counts[path] = (added, deleted); index += 1
    for change in changes:
        added, deleted = counts.get(change['path'], ('', ''))
        change['added'], change['deleted'] = (int(added), int(deleted)) if added.isdigit() and deleted.isdigit() else (None, None)
    current = vcs.head(root)
    deployed = {}
    for item in deployments(project): deployed.setdefault(item['sha'], item['at'])
    row.update({'changes': changes[:1000], 'parent': parent, 'current': sha == current, 'deployed_at': deployed.get(sha),
                'same_as_current': bool(current) and _tree(root, sha) == _tree(root, current),
                'contained': bool(current) and vcs.git(root, 'merge-base', '--is-ancestor', sha, current)[0] == 0})
    return row


def diff(project, path='', rev='', compare=False):
    """Diferencias: pendientes (sin rev), de una versión (rev) o de la actual a esa versión (compare)."""
    root = root_of(project)
    target = ['--', path] if path else []
    if rev:
        sha = resolve(root, rev)
        if compare: base, tip = 'HEAD', sha
        else: base, tip = _parent(root, sha) or vcs.ok(root, 'hash-object', '-t', 'tree', '/dev/null').strip(), sha
        _, stat, _ = vcs.git(root, 'diff', *DIFF, '-M', '--stat=120', base, tip, *target, timeout=30)
        _, text, _ = vcs.git(root, 'diff', *DIFF, '-M', base, tip, *target, timeout=30)
        return {'stat': stat, 'diff': text[:MAX_DIFF], 'truncated': len(text) > MAX_DIFF}
    _, stat, _ = vcs.git(root, 'diff', 'HEAD', *DIFF, '--stat=120')
    code, text, _ = vcs.git(root, 'diff', 'HEAD', *DIFF, *target)
    if code != 0:  # repositorio sin commits todavía
        code, text, _ = vcs.git(root, 'diff', *DIFF, *target)
    if path and not text:
        # Archivo nuevo sin seguimiento: se muestra completo como añadido.
        _, text, _ = vcs.git(root, 'diff', *DIFF, '--no-index', '/dev/null', path)
    return {'stat': stat, 'diff': text[:MAX_DIFF], 'truncated': len(text) > MAX_DIFF}


def branches(project):
    root = root_of(project)
    if not vcs.is_repo(root) or not vcs.head(root): return {'branches': [], 'current': vcs.branch(root) if vcs.is_repo(root) else ''}
    code, out, _ = vcs.git(root, 'for-each-ref', '--sort=-committerdate',
                           '--format=%(refname:short)%1f%(objectname)%1f%(committerdate:unix)%1f%(contents:subject)', 'refs/heads/')
    current, rows = vcs.branch(root), []
    deployed = deployments(project)
    production = deployed[0]['sha'] if deployed else ''
    for line in out.splitlines() if code == 0 else []:
        name, sha, when, subject = (line.split('\x1f') + ['', '', '', ''])[:4]
        row = {'name': name, 'sha': sha, 'short': sha[:7], 'time': int(when or 0), 'subject': subject, 'current': name == current,
               'production': bool(production) and production == sha}
        if name != current:
            _, counts, _ = vcs.git(root, 'rev-list', '--left-right', '--count', f'HEAD...refs/heads/{name}')
            behind, ahead = (counts.split() + ['0', '0'])[:2]
            row['ahead'], row['behind'] = int(ahead or 0), int(behind or 0)
        rows.append(row)
    rows.sort(key=lambda r: (not r['current'], -r['time']))
    return {'branches': rows[:200], 'current': current}


def latest_commits(projects):
    now = time.monotonic()
    with COMMITS_LOCK:
        if COMMITS_CACHE['expires'] > now: return COMMITS_CACHE['data']
        out = []
        for p in projects:
            if (p / '.git').exists():
                _, line, _ = vcs.git(p, 'log', '-1', '--pretty=%h|%ad|%s', '--date=short', timeout=4)
                if line.strip():
                    sha, date, subject = (line.strip().split('|', 2) + ['', '', ''])[:3]
                    out.append({'project': p.name, 'sha': sha, 'date': date, 'subject': subject})
        COMMITS_CACHE.update({'data': out, 'expires': now + 60})
        return out


def invalidate():
    with COMMITS_LOCK: COMMITS_CACHE['expires'] = 0.0


# ---------------------------------------------------------------- acciones

def _tree(root, rev):
    return vcs.ok(root, 'rev-parse', f'{rev}^{{tree}}').strip()


def _protect(root, target):
    """Copia archivos ignorados (p. ej. .env) que la otra versión sobrescribiría."""
    _, out, _ = vcs.git(root, 'diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', 'HEAD', target)
    saved, folder = [], None
    for relative in filter(None, out.split('\0')):
        path = root / relative
        if path.is_symlink() or path.is_file():
            folder = folder or vcs.git_dir(root) / 'codex-manager' / 'respaldos' / time.strftime('%Y%m%d-%H%M%S')
            (folder / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, folder / relative, follow_symlinks=False)
            saved.append(relative)
    return saved, folder


def _protected_note(saved, folder, root):
    if not saved: return ''
    return f" Se guardó copia de {len(saved)} archivo(s) no versionado(s) en {folder.relative_to(root)}."


def _prepare(project, root, subject):
    """Antes de cambiar archivos: nada en curso y todo lo pendiente guardado como versión."""
    reason = busy(project)
    if reason: raise VersionError(reason)
    if not vcs.is_repo(root) or not vcs.head(root): raise VersionError('Este proyecto todavía no tiene versiones')
    vcs.ensure_repo(root)
    return vcs.snapshot_locked(root, f'Cambios pendientes antes de: {subject}'[:110], 'pending')


def _restore_locked(root, target, subject, action, body='', trailers=None):
    if _tree(root, target) == _tree(root, 'HEAD'): return '', ([], None)
    protected = _protect(root, target)
    vcs.ok(root, 'read-tree', '-u', '--reset', target, timeout=180)
    return vcs.commit_staged(root, subject, action, body, trailers), protected


def _label(row):
    return f"{row['short']} · {row['subject'][:60]}"


def restore(project, rev):
    root = root_of(project)
    with vcs.locked(root):
        _prepare(project, root, 'restaurar una versión')
        sha = resolve(root, rev)
        row = _commit_row(root, sha)
        new, protected = _restore_locked(root, sha, f'Restaurar versión {_label(row)}', 'restore',
                                         f'Los archivos vuelven a quedar como en la versión {sha[:7]}. Las versiones posteriores siguen en el historial.',
                                         {'Restores': effective(root, sha)})
    invalidate()
    if not new: return True, 'El proyecto ya estaba en esa versión', ''
    return True, f'Restaurada la versión {row["short"]}. Puedes volver atrás desde el historial.' + _protected_note(*protected, root), new


def undo(project):
    root = root_of(project)
    with vcs.locked(root):
        before = vcs.head(root)
        saved = _prepare(project, root, 'deshacer el último cambio')
        if saved:
            # Lo último eran cambios sin guardar: quedan como versión y se vuelve a la anterior a ellos.
            current, parent, what = saved, before, 'cambios sin guardar'
        else:
            current = effective(root, before)
            parent = _parent(root, current)
            if not parent: raise VersionError('No hay una versión anterior a la que volver')
            what = f'«{_commit_row(root, current)["subject"][:60]}»'
        row = _commit_row(root, parent)
        new, protected = _restore_locked(root, parent, f'Deshacer {what}', 'undo',
                                         f'Vuelve a la versión {_label(row)}. Lo deshecho sigue en el historial ({current[:7]}).',
                                         {'Restores': effective(root, parent)})
    invalidate()
    if not new: return True, 'No había cambios que deshacer', ''
    return True, f'Deshecho: ahora estás en la versión {row["short"]} ({row["subject"][:60]}).' + _protected_note(*protected, root), new


def revert(project, rev):
    """Deshace solo los cambios de una versión concreta, conservando los posteriores."""
    root = root_of(project)
    with vcs.locked(root):
        _prepare(project, root, 'revertir un cambio')
        sha = resolve(root, rev)
        row = _commit_row(root, sha)
        merge = ['-m', '1'] if len(row['parents']) > 1 else []
        if not row['parents']: raise VersionError('No se puede revertir la primera versión; usa «Restaurar» con otra versión')
        code, out, err = vcs.git(root, 'revert', '--no-edit', '--no-commit', *merge, sha, timeout=120)
        if code:
            _, conflicts, _ = vcs.git(root, 'diff', '--name-only', '--diff-filter=U')
            vcs.git(root, 'revert', '--abort')
            names = ', '.join(conflicts.split()[:8])
            raise VersionError('Ese cambio choca con versiones posteriores' + (f' ({names})' if names else '') +
                               '. Usa «Restaurar esta versión» o pide al agente que lo deshaga.')
        new = vcs.commit_staged(root, f'Revertir {_label(row)}', 'revert',
                                f'Deshace solo los cambios de {sha[:7]}; las versiones posteriores se conservan.', {'Reverts': sha})
        if not new:
            vcs.git(root, 'revert', '--quit')
            vcs.git(root, 'reset', '-q')
    invalidate()
    if not new: return True, 'Esos cambios ya no están en la versión actual', ''
    return True, f'Revertidos los cambios de {row["short"]}', new


def valid_branch(root, name):
    name = str(name or '').strip()
    if not BRANCH.fullmatch(name) or '..' in name or name.endswith(('/', '.', '.lock')) or '//' in name or '/.' in name or name == 'HEAD':
        raise VersionError('Nombre de rama inválido: usa letras, números, guiones, puntos o /')
    if vcs.git(root, 'check-ref-format', '--branch', name)[0]: raise VersionError('Nombre de rama inválido')
    return name


def create_branch(project, name, rev='', switch=True):
    root = root_of(project)
    with vcs.locked(root):
        name = valid_branch(root, name)
        if name in branch_names(root): raise VersionError('Ya existe una rama con ese nombre')
        if switch: _prepare(project, root, f'crear la rama {name}')
        elif not vcs.head(root): raise VersionError('Este proyecto todavía no tiene versiones')
        start = resolve(root, rev) if rev else vcs.head(root)
        protected = _protect(root, start) if switch else ([], None)
        vcs.ok(root, 'branch', name, start)
        if switch: vcs.ok(root, 'switch', '-q', name, timeout=120)
    invalidate()
    return True, (f'Rama {name} creada' + (' y activada' if switch else '') + f' desde {start[:7]}.') + _protected_note(*protected, root)


def switch(project, name):
    root = root_of(project)
    with vcs.locked(root):
        if name not in branch_names(root): raise VersionError('Esa rama no existe')
        if name == vcs.branch(root): return True, f'Ya estás en {name}'
        _prepare(project, root, f'cambiar a la rama {name}')
        protected = _protect(root, f'refs/heads/{name}')
        code, out, err = vcs.git(root, 'switch', '-q', name, timeout=120)
        if code: raise VersionError((err or out).strip().splitlines()[-1] if (err or out).strip() else 'No se pudo cambiar de rama')
    invalidate()
    return True, f'Ahora trabajas en la rama {name}. Despliega para publicarla.' + _protected_note(*protected, root)


def merge(project, name):
    root = root_of(project)
    with vcs.locked(root):
        if name not in branch_names(root): raise VersionError('Esa rama no existe')
        current = vcs.branch(root)
        if not current: raise VersionError('Crea o elige una rama antes de integrar otra')
        if name == current: raise VersionError('No puedes integrar una rama en sí misma')
        _prepare(project, root, f'integrar la rama {name}')
        before = vcs.head(root)
        protected = _protect(root, f'refs/heads/{name}')
        code, out, err = vcs.git(root, 'merge', '--no-ff', '--no-edit', '-m',
                                 vcs.message(f'Integrar la rama {name} en {current}', 'merge', '', {'Branch': name}), f'refs/heads/{name}', timeout=180)
        if code:
            _, conflicts, _ = vcs.git(root, 'diff', '--name-only', '--diff-filter=U')
            vcs.git(root, 'merge', '--abort')
            names = ', '.join(conflicts.split()[:8])
            raise VersionError(f'Las dos ramas cambian las mismas líneas' + (f' ({names})' if names else '') +
                               '. No se integró nada; pide al agente que combine los cambios.')
    invalidate()
    if vcs.head(root) == before: return True, f'{name} ya estaba integrada en {current}'
    return True, f'La rama {name} se integró en {current}.' + _protected_note(*protected, root)


def delete_branch(project, name):
    root = root_of(project)
    with vcs.locked(root):
        if name not in branch_names(root): raise VersionError('Esa rama no existe')
        if name == vcs.branch(root): raise VersionError('No puedes eliminar la rama en la que estás')
        sha = resolve(root, name)
        # La rama desaparece de la lista, pero sus versiones quedan archivadas por si acaso.
        vcs.ok(root, 'update-ref', f"refs/codex-manager/archivadas/{time.strftime('%Y%m%d-%H%M%S')}-{name.replace('/', '-')}", sha)
        vcs.ok(root, 'branch', '-D', name)
    invalidate()
    return True, f'Rama {name} eliminada (sus versiones quedan archivadas en el repositorio)'


def commit(project, message):
    message = ' '.join(str(message or '').split())[:300]
    if not message: return False, 'Escribe un mensaje para el commit'
    result = vcs.snapshot(root_of(project), message, 'manual')
    if result['error']: return False, result['error']
    if not result['sha']: return False, 'Nada que confirmar'
    invalidate()
    return True, f"Commit {result['sha'][:7]} creado"


def act(project, data):
    """Punto de entrada de POST /api/git. Devuelve (ok, mensaje, extra)."""
    action = str(data.get('action', ''))
    try:
        if action == 'commit': return (*commit(project, data.get('message')), {})
        if action == 'init':
            result = vcs.snapshot(root_of(project), 'Versión inicial del proyecto', 'init')
            if result['error']: return False, result['error'], {}
            invalidate()
            return True, 'Versiones activadas para este proyecto', {'sha': result['head']}
        if action == 'restore': ok, text, sha = restore(project, data.get('rev')); return ok, text, {'sha': sha}
        if action == 'undo': ok, text, sha = undo(project); return ok, text, {'sha': sha}
        if action == 'revert': ok, text, sha = revert(project, data.get('rev')); return ok, text, {'sha': sha}
        if action == 'branch-create': return (*create_branch(project, data.get('name'), data.get('rev') or '', data.get('switch', True) is not False), {})
        if action == 'switch': return (*switch(project, str(data.get('name', ''))), {})
        if action == 'merge': return (*merge(project, str(data.get('name', ''))), {})
        if action == 'branch-delete': return (*delete_branch(project, str(data.get('name', ''))), {})
    except VersionError as error:
        return False, str(error), {}
    return False, 'Acción inválida', {}
