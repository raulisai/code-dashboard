"""Explorador y editor de archivos de un proyecto.

Toda ruta llega relativa al proyecto y se resuelve (siguiendo enlaces simbólicos)
antes de usarla: si el resultado queda fuera de /srv/projects/<proyecto>, se rechaza.
"""
import os, shutil, tempfile
from pathlib import Path
from . import config

MAX_READ = 2 * 1024 * 1024
MAX_WRITE = 5 * 1024 * 1024
HEAVY_DIRS = {'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache', 'target', '.mypy_cache', '.pytest_cache'}


class FileError(Exception):
    pass


def project_root(project):
    root = (config.PROJECTS / project).resolve()
    if not root.is_dir() or root.parent != config.PROJECTS.resolve():
        raise FileError('Proyecto inválido')
    return root


def resolve(project, relative, must_exist=True):
    root = project_root(project)
    relative = str(relative or '').strip().lstrip('/')
    if '\0' in relative: raise FileError('Ruta inválida')
    target = (root / relative).resolve()
    if target != root and root not in target.parents:
        raise FileError('La ruta sale del proyecto')
    if must_exist and not target.exists():
        raise FileError('No existe')
    return root, target


def rel(root, path):
    return str(path.relative_to(root)) if path != root else ''


def version(stat):
    # El inodo cambia en cada guardado atómico, incluso en sistemas de archivos
    # que asignan la misma fecha a dos escrituras muy próximas.
    return f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_ino}:{stat.st_size}'


def list_dir(project, relative=''):
    root, folder = resolve(project, relative)
    if not folder.is_dir(): raise FileError('No es una carpeta')
    entries = []
    with os.scandir(folder) as iterator:
        for entry in iterator:
            try:
                is_dir = entry.is_dir()
                size = 0 if is_dir else entry.stat().st_size
            except OSError:
                continue
            entries.append({'name': entry.name, 'path': rel(root, folder / entry.name), 'type': 'dir' if is_dir else 'file', 'size': size,
                            'heavy': is_dir and entry.name in HEAVY_DIRS, 'link': entry.is_symlink()})
    entries.sort(key=lambda e: (e['type'] != 'dir', e['name'].lower()))
    return {'path': rel(root, folder), 'entries': entries[:2000], 'truncated': len(entries) > 2000}


def read_file(project, relative):
    root, path = resolve(project, relative)
    if not path.is_file(): raise FileError('No es un archivo')
    size = path.stat().st_size
    with open(path, 'rb') as handle:
        before = os.fstat(handle.fileno())
        data = handle.read(MAX_READ + 1)
        after = os.fstat(handle.fileno())
    if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
        raise FileError('El archivo cambió mientras se leía. Vuelve a abrirlo.')
    binary = b'\0' in data[:8192]
    if binary:
        return {'path': rel(root, path), 'size': size, 'binary': True, 'content': '', 'truncated': False}
    truncated = len(data) > MAX_READ
    return {'path': rel(root, path), 'size': size, 'binary': False, 'truncated': truncated,
            'content': data[:MAX_READ].decode('utf-8', errors='replace'), 'mtime': version(after)}


def write_file(project, relative, content, expected_mtime=None):
    if len(content.encode('utf-8')) > MAX_WRITE: raise FileError('Archivo demasiado grande para el editor web')
    root, path = resolve(project, relative, must_exist=False)
    if path == root or path.is_dir(): raise FileError('Ruta inválida')
    if expected_mtime and (not path.exists() or version(path.stat()) != str(expected_mtime)):
        raise FileError('El archivo cambió en el servidor (¿lo editó el agente?). Recárgalo antes de guardar.')
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            handle.write(content)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    return {'path': rel(root, path), 'size': path.stat().st_size, 'mtime': version(path.stat())}


def operate(project, action, relative, destination=''):
    root, path = resolve(project, relative, must_exist=action not in ('mkdir', 'create'))
    if path == root: raise FileError('No se puede modificar la raíz del proyecto')
    # Para mover o borrar un enlace interno, operar sobre el enlace, no sobre
    # su destino. resolve() ya verificó que no apunta fuera del proyecto.
    original = root / str(relative or '').strip().lstrip('/')
    if action in ('rename', 'delete') and original.is_symlink(): path = original
    if action == 'mkdir':
        path.mkdir(parents=True, exist_ok=False)
        return f'Carpeta {rel(root, path)} creada'
    if action == 'create':
        if path.exists(): raise FileError('Ya existe')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return f'Archivo {rel(root, path)} creado'
    if action == 'rename':
        _, target = resolve(project, destination, must_exist=False)
        if target == root or target.exists(): raise FileError('El destino ya existe o es inválido')
        target.parent.mkdir(parents=True, exist_ok=True)
        path.rename(target)
        return f'Movido a {rel(root, target)}'
    if action == 'delete':
        if path.is_dir() and not path.is_symlink(): shutil.rmtree(path)
        else: path.unlink()
        return f'{rel(root, path)} eliminado'
    raise FileError('Acción inválida')


def save_upload(project, relative_dir, filename, data):
    name = Path(str(filename or 'archivo')).name.replace('\0', '')[:120] or 'archivo'
    root, folder = resolve(project, '.codex-manager/uploads' if relative_dir is None else relative_dir, must_exist=False)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    stem, suffix, n = target.stem, target.suffix, 1
    while True:
        try:
            # O_EXCL evita sobrescribir archivos y seguir enlaces, también si
            # otra carga crea el mismo nombre entre comprobarlo y escribirlo.
            with target.open('xb') as handle: handle.write(data)
            break
        except FileExistsError:
            target = folder / f'{stem}-{n}{suffix}'; n += 1
    return rel(root, target)
