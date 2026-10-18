"""Imágenes del agente general para la interfaz viva: carpeta propia y lectura acotada, sin seguir enlaces simbólicos."""
import os, re, stat, time
from . import config

TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'avif': 'image/avif'}
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(%s)' % '|'.join(TYPES), re.IGNORECASE)
LIMIT = 15 * 1024 * 1024
KEEP_DAYS = 30


def folder():
    # Dentro de la raíz de proyectos (el directorio de trabajo del agente general), oculta como .cm-trash.
    return config.PROJECTS / '.cm-media'


def prepare():
    """Crea la carpeta y borra imágenes de más de 30 días; nunca impide arrancar el panel."""
    try:
        folder().mkdir(mode=0o700, exist_ok=True)
        limit = time.time() - KEEP_DAYS * 86400
        for entry in os.scandir(folder()):
            if entry.is_file(follow_symlinks=False) and entry.stat(follow_symlinks=False).st_mtime < limit:
                os.unlink(entry.path)
    except OSError:
        pass


def read(name):
    """(tipo, bytes) de una imagen de la carpeta, o None si el nombre, el tipo o el archivo no valen."""
    match = NAME.fullmatch(name or '')
    if not match: return None
    try: fd = os.open(folder() / name, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError: return None
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT: return None
        return TYPES[match.group(1).lower()], handle.read(LIMIT)
