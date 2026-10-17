import json, os, subprocess, tempfile, time
from pathlib import Path


def run(*args, timeout=4, cwd=None):
    """Ejecuta un comando y devuelve stdout ('' si falla o tarda demasiado)."""
    try: return subprocess.run(args, text=True, capture_output=True, timeout=timeout, cwd=cwd).stdout.strip()
    except Exception: return ''


def run_full(args, timeout=10, cwd=None, env=None):
    """Como run() pero devuelve (código, stdout, stderr); nunca se queda colgado."""
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, cwd=cwd, env=env)
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 124, '', f'Tiempo de espera agotado ({timeout} s)'
    except OSError as error:
        return 127, '', str(error)


def now_text():
    return time.strftime('%Y-%m-%d %H:%M:%S %Z')


def read_json(path, default):
    try: return json.loads(Path(path).read_text())
    except (OSError, ValueError): return default


def write_json(path, data, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}-', dir=path.parent, text=True)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(data, handle, ensure_ascii=False)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def clip(text, limit):
    text = str(text or '')
    return text if len(text) <= limit else text[:limit] + f'… (+{len(text) - limit} caracteres)'


def tail_text(path, limit):
    try:
        with open(path, 'rb') as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - limit * 4))
            return handle.read().decode('utf-8', errors='replace')[-limit:]
    except OSError:
        return ''
