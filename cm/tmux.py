"""Acceso al servidor tmux del host a través del socket compartido.

Todo lo que el panel ejecuta en el host (agentes, despliegues, terminales) pasa
por aquí. Antes de crear nada se comprueba que el servidor sea el del host: si
no hubiera ninguno, `tmux new-session` arrancaría uno dentro del contenedor,
donde no existen codex ni claude.
"""
import re
from . import config
from .util import run, run_full

SESSION_NAME = re.compile(r'^[A-Za-z0-9_.-]{1,80}$')


def tmux(*args, timeout=5):
    return run_full(['tmux', '-S', config.TMUX_SOCKET, *args], timeout=timeout)


def sessions(include_internal=False):
    raw = run('tmux', '-S', config.TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}|#{session_attached}|#{session_windows}|#{session_created}|#{pane_current_command}')
    rows = []
    for line in raw.splitlines():
        parts = line.split('|')
        if len(parts) != 5: continue
        name = parts[0]
        if not include_internal and name.startswith(config.INTERNAL_SESSION_PREFIXES): continue
        rows.append({'name': name, 'attached': parts[1] not in ('', '0'), 'windows': int(parts[2] or 0), 'created': int(parts[3] or 0), 'command': parts[4]})
    return rows


def has_session(name):
    return tmux('has-session', '-t', f'={name}', timeout=3)[0] == 0


def pane_state(name):
    if not SESSION_NAME.fullmatch(str(name or '')) or str(name).startswith(config.INTERNAL_SESSION_PREFIXES):
        return {'exists': False, 'dead': False, 'copy_mode': False}
    code, out, _ = tmux('list-panes', '-t', f'={name}', '-F', '#{pane_active}|#{pane_dead}|#{pane_in_mode}', timeout=3)
    rows = [line.split('|') for line in out.splitlines() if len(line.split('|')) == 3]
    selected = next((row for row in rows if row[0] == '1'), rows[0] if rows else ['0','0','0'])
    return {'exists': code == 0 and bool(rows), 'dead': selected[1] == '1', 'copy_mode': selected[2] == '1'}


def host_server_ok():
    """True si hay un servidor tmux y pertenece al host (no al contenedor)."""
    code, out, _ = tmux('show-environment', '-g', 'HOME', timeout=3)
    return code == 0 and out.strip() != '' and not out.strip().endswith('/home/monitor')


def server_error():
    return ('El servidor tmux del host no está activo. En el servidor ejecuta: '
            'sudo systemctl restart codex-tmux')


def new_session(name, cwd, argv):
    """Crea una sesión desacoplada en el host ejecutando argv (lista, sin shell)."""
    if not SESSION_NAME.match(name): return False, 'Nombre de sesión inválido'
    if not host_server_ok(): return False, server_error()
    code, _, err = tmux('new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, *argv, timeout=8)
    return code == 0, err.strip()


def kill_session(name):
    return tmux('kill-session', '-t', f'={name}', timeout=4)[0] == 0


def scroll(name, direction):
    """Entra en modo copia y desplaza media pantalla (para leer historial desde el celular)."""
    if direction == 'exit':
        return tmux('send-keys', '-t', f'={name}:', '-X', 'cancel', timeout=3)[0] == 0
    tmux('copy-mode', '-e', '-t', f'={name}:', timeout=3)
    return tmux('send-keys', '-t', f'={name}:', '-X', 'halfpage-up' if direction == 'up' else 'halfpage-down', timeout=3)[0] == 0
