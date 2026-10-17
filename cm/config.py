"""Rutas y opciones de Codex Manager.

El panel corre en un contenedor; los agentes y los despliegues corren en el host
(a través del servidor tmux). Por eso varias rutas existen dos veces: la vista
del contenedor (`/config`, `/projects`) y la del host (`HOST_*`).
"""
import os
from pathlib import Path

PROJECTS = Path(os.environ.get('PROJECTS_DIR', '/srv/projects'))
HOST_PROJECTS = os.environ.get('HOST_PROJECTS_DIR', '/srv/projects')
CONFIG = Path(os.environ.get('CONFIG_DIR', '/config'))
HOST_CONFIG = os.environ.get('HOST_CONFIG_DIR', '/home/dv1/.config/codex-automation')
HOST_APP_DIR = os.environ.get('HOST_APP_DIR', '/srv/projects/codex-dashboard')
LOGS = Path(os.environ.get('CODEX_LOG_DIR', '/logs/codex'))

TASKS = Path(os.environ.get('TASKS_FILE', str(CONFIG / 'tasks.tsv')))
USAGE = Path(os.environ.get('USAGE_FILE', str(CONFIG / 'usage.tsv')))
FEATURED = Path(os.environ.get('FEATURED_FILE', str(CONFIG / 'featured.json')))
RUNS = CONFIG / 'runs'
JOBS = CONFIG / 'jobs'
SESSIONS_FILE = CONFIG / 'agent-sessions.json'
SETTINGS_FILE = CONFIG / 'settings.json'
RULES_FILE = CONFIG / 'approval-rules.json'
SECRET_FILE = CONFIG / '.cm-secret'

USER = os.environ.get('MONITOR_USER', 'admin')
PASSWORD = os.environ.get('MONITOR_PASSWORD', '')
PUBLIC_ORIGIN = os.environ.get('PUBLIC_ORIGIN', '').rstrip('/')
TMUX_SOCKET = os.environ.get('TMUX_SOCKET', '/tmux/default')
DOMAIN = os.environ.get('PROJECTS_DOMAIN', 'devdj.lat')
STATE_CACHE_TTL = max(1, int(os.environ.get('STATE_CACHE_TTL', '4')))
QUEUE_TICK = max(1.0, float(os.environ.get('QUEUE_TICK_SECONDS', '2')))
RUN_TIMEOUT_MINUTES = max(5, int(os.environ.get('RUN_TIMEOUT_MINUTES', '180')))
SESSION_DAYS = min(180, max(1, int(os.environ.get('SESSION_DAYS', '180'))))
FRONTEND = Path(os.environ.get('FRONTEND_DIR', '/app/dist'))

# Valores por defecto de los ajustes editables desde la web (settings.json).
DEFAULT_SETTINGS = {
    'default_provider': os.environ.get('DEFAULT_PROVIDER', 'claude'),
    # ask: ediciones aceptadas, el resto se aprueba desde la web · auto: clasificador
    # de Claude · edits: solo lectura y ediciones, sin comandos.
    'claude_permission': os.environ.get('CLAUDE_PERMISSION_MODE', 'ask'),
    # full = equivalente a `codex --yolo` (lo que ya usaba el servidor).
    'codex_sandbox': os.environ.get('CODEX_SANDBOX', 'full'),
    'claude_model': os.environ.get('CLAUDE_MODEL', ''),
    'codex_model': os.environ.get('CODEX_MODEL', ''),
}
CLAUDE_PERMISSIONS = ('ask', 'auto', 'edits')
CODEX_SANDBOXES = ('full', 'workspace', 'read-only')
PROVIDERS = ('claude', 'codex')
PROJECT_NAME = r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?'
# Sesiones tmux internas que no se muestran como "sesiones de agente".
INTERNAL_SESSION_PREFIXES = ('cmr-', 'cmj-', 'cm-keepalive')


def host_path(path):
    """Traduce una ruta vista desde el contenedor a la misma ruta en el host."""
    text = str(path)
    for inside, outside in ((str(CONFIG), HOST_CONFIG), (str(PROJECTS), HOST_PROJECTS)):
        if text == inside or text.startswith(inside + '/'):
            return outside + text[len(inside):]
    return text
