"""Catálogo de proyectos, estado del servidor y creación de proyectos nuevos."""
import os, re, shutil, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from . import config, dockerapi, gitops, lifecycle, runs, tasks, tmux
from .util import read_json, run, run_full, write_json

CACHE_LOCK = threading.Lock()
BUILD_LOCK = threading.Lock()
CACHE = {'data': None, 'expires': 0.0}
CPU_LOCK = threading.Lock()
CPU_SAMPLE = {'idle': None, 'total': None, 'percent': 0.0}

STACKS = {
    'auto': ('La IA decide', 'web', 'elige tú el stack más adecuado para la idea (prioriza algo simple y rápido de desplegar)'),
    'web': ('HTML + CSS + JS', 'web', 'HTML, CSS y JavaScript sin framework, servido como sitio estático'),
    'react': ('React + Vite', 'web', 'React con Vite; build multi-stage en el Dockerfile y servir los archivos estáticos en el puerto 3000'),
    'node': ('Node.js + Express', 'node', 'Node.js con Express (API + frontend)'),
    'python': ('Python + FastAPI', 'web', 'Python con FastAPI y uvicorn en el puerto 3000 (API + frontend)'),
    'next': ('Next.js', 'node', 'Next.js (output standalone) escuchando en el puerto 3000'),
    'game': ('Juego web', 'web', 'un juego web con Canvas o Three.js, controles táctiles para celular'),
}


def projects():
    try: entries = list(config.PROJECTS.iterdir())
    except OSError: return []
    return sorted((p for p in entries if not p.is_symlink() and p.is_dir() and
                   re.fullmatch(config.PROJECT_NAME, p.name) and not p.name.startswith(config.INTERNAL_SESSION_PREFIXES)), key=lambda p: p.name)


def project_names():
    return {p.name for p in projects()}


def featured_projects():
    data = read_json(config.FEATURED, [])
    return {x for x in data if isinstance(x, str)} if isinstance(data, list) else set()


def toggle_featured(name):
    selected = featured_projects()
    if name in selected: selected.remove(name); message = 'Quitado de destacados'
    else: selected.add(name); message = 'Añadido a destacados'
    write_json(config.FEATURED, sorted(selected))
    invalidate()
    return message


def invalidate():
    with CACHE_LOCK:
        CACHE['data'] = None
        CACHE['expires'] = 0.0


def cpu_snapshot():
    try:
        values = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
        idle, total = values[3] + values[4], sum(values)
        with CPU_LOCK:
            previous_idle, previous_total = CPU_SAMPLE['idle'], CPU_SAMPLE['total']
            if previous_total is not None and total > previous_total:
                delta_total, delta_idle = total - previous_total, idle - previous_idle
                CPU_SAMPLE['percent'] = round(max(0, min(100, (1 - delta_idle / delta_total) * 100)), 1)
            else:
                CPU_SAMPLE['percent'] = round(min(100, os.getloadavg()[0] / max(1, os.cpu_count() or 1) * 100), 1)
            CPU_SAMPLE['idle'], CPU_SAMPLE['total'] = idle, total
            percent = CPU_SAMPLE['percent']
        return {'percent': percent, 'cores': os.cpu_count() or 1, 'load_1m': round(os.getloadavg()[0], 2)}
    except Exception:
        return {'percent': 0.0, 'cores': os.cpu_count() or 1, 'load_1m': 0.0}


def readme_summary(path):
    try:
        document = path / 'README.md'
        if document.is_symlink(): return ''
        with document.open(errors='replace') as handle:
            contents = handle.read(16384)
        for line in contents.splitlines()[:40]:
            line = line.strip()
            if line and not line.startswith(('#', '```', '<', '|', '!', '-', '*')) and not line.startswith('URL:'):
                return line[:180]
    except OSError:
        pass
    return ''


def _snapshot_uncached():
    mem = {}
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1); mem[key] = int(value.split()[0])
    except Exception: pass
    disk_output = run('df', '-h', '/')
    disk = disk_output.splitlines()[-1].split() if disk_output else []
    try: containers = dockerapi.docker(); docker_ok = True
    except Exception: containers, docker_ok = [], False
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(containers)))) as pool:
        memory_rows = list(pool.map(lambda c: dockerapi.container_memory(c.get('Id', '')) if c.get('State') == 'running' else (0, 0), containers))
    for container, memory_row in zip(containers, memory_rows):
        container['MemoryUsage'], container['MemoryLimit'] = memory_row
    session_rows = tmux.sessions()
    session_names = {x['name'] for x in session_rows}
    featured = featured_projects()
    task_rows = tasks.task_records()
    settings = runs.load_settings()
    project_rows = []
    for p in projects():
        mine = [c for c in containers if dockerapi.container_belongs_to(c, p.name)]
        own_tasks = [t for t in task_rows if t['project'] == p.name]
        urls = []
        for c in mine:
            for url in dockerapi.container_urls(c):
                if url not in urls: urls.append(url)
        default_url = f'https://{p.name}.{config.DOMAIN}'
        try: activity = max([p.stat().st_mtime] + [int(t['id']) / 1e9 for t in own_tasks if t['id'].isdigit() and len(t['id']) > 15])
        except (OSError, ValueError): activity = 0
        project_rows.append({
            'name': p.name, 'featured': p.name in featured, 'description': readme_summary(p),
            'deleting': lifecycle.deleting(p.name), 'protected': config.host_path(p) == config.HOST_APP_DIR,
            'url': default_url if not urls or default_url in urls else urls[0], 'urls': urls,
            'compose': any((p / f).exists() for f in ('compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml')),
            'dev_compose': (p / 'compose.dev.yaml').exists(), 'git': (p / '.git').exists(), 'activity': activity,
            'sessions': {'codex': p.name in session_names, 'claude': f'{p.name}-claude' in session_names, 'shell': f'{p.name}-shell' in session_names},
            'session': p.name in session_names or f'{p.name}-claude' in session_names,
            'containers': [dockerapi.container_name(c) for c in mine],
            'running_containers': sum(1 for c in mine if c.get('State') == 'running'),
            'container_details': [{'id': c.get('Id', ''), 'name': dockerapi.container_name(c), 'service': (c.get('Labels') or {}).get('com.docker.compose.service', ''),
                                   'image': c.get('Image', ''), 'status': c.get('Status', ''), 'state': c.get('State', ''), 'protected': dockerapi.is_self_container(c),
                                   'urls': dockerapi.container_urls(c), 'memory_bytes': c.get('MemoryUsage', 0), 'memory_limit_bytes': c.get('MemoryLimit', 0)} for c in mine],
            'memory_bytes': sum(c.get('MemoryUsage', 0) for c in mine),
            'memory_limit_bytes': sum(c.get('MemoryLimit', 0) for c in mine),
            'working': [{'id': t['id'], 'provider': t['provider'], 'title': t['title'], 'chat_id': t.get('chat_id', 'main')} for t in own_tasks if t['status'] == 'working'],
            'queued': sum(1 for t in own_tasks if t['status'] == 'espera'),
        })
    usage_rows = [row for row in (line.split('\t') for line in _read_lines(config.USAGE)) if row]
    totals = {}
    for row in usage_rows:
        if len(row) >= 6:
            try: totals[row[1]] = totals.get(row[1], 0) + float(row[5])
            except ValueError: pass
    working = [x for x in task_rows if x['status'] == 'working']
    automation = {**runs.AUTOMATION, 'enabled': True, 'interval_seconds': config.QUEUE_TICK, 'active_count': len(working),
                  'active_task_ids': [x['id'] for x in working]}
    docker_rows = [{**{key: c.get(key) for key in ('Id', 'Names', 'Image', 'Status', 'State', 'MemoryUsage', 'MemoryLimit')},
                    'Protected': dockerapi.is_self_container(c), 'Urls': dockerapi.container_urls(c),
                    'Project': (c.get('Labels') or {}).get('com.docker.compose.project', '')} for c in containers]
    return {'time': time.strftime('%Y-%m-%d %H:%M:%S %Z'), 'sessions': session_rows, 'agents': session_rows, 'projects': project_rows,
            'docker': docker_rows, 'docker_ok': docker_ok, 'tmux_ok': tmux.host_server_ok(), 'commits': gitops.latest_commits(projects()), 'cpu': cpu_snapshot(),
            'memory': {'total_kb': mem.get('MemTotal', 0), 'available_kb': mem.get('MemAvailable', 0)},
            'disk': {'total': disk[1] if len(disk) > 1 else '?', 'used': disk[2] if len(disk) > 2 else '?', 'free': disk[3] if len(disk) > 3 else '?', 'percent': disk[4] if len(disk) > 4 else '?'},
            'task_records': task_rows[-300:], 'automation': automation, 'approvals': runs.all_pending_approvals(), 'settings': settings,
            'usage': usage_rows[-100:], 'usage_totals': totals, 'domain': config.DOMAIN, 'stacks': {k: v[0] for k, v in STACKS.items()}}


def _read_lines(path):
    try: return [line for line in Path(path).read_text().splitlines() if line and not line.startswith('#')]
    except OSError: return []


def snapshot():
    now = time.monotonic()
    with CACHE_LOCK:
        if CACHE['data'] is not None and CACHE['expires'] > now: return CACHE['data']
    with BUILD_LOCK:
        now = time.monotonic()
        with CACHE_LOCK:
            if CACHE['data'] is not None and CACHE['expires'] > now: return CACHE['data']
        data = _snapshot_uncached()
        with CACHE_LOCK:
            CACHE['data'] = data
            CACHE['expires'] = time.monotonic() + config.STATE_CACHE_TTL
        return data


# ---------------------------------------------------------------- creación

def compose_yaml(name, healthcheck):
    return f'''name: {name}
services:
  {name}:
    build: .
    init: true
    restart: unless-stopped
    expose: ["3000"]
    networks: [internal, proxy]
    labels:
      traefik.enable: "true"
      traefik.docker.network: proxy
      traefik.http.routers.{name}.rule: Host(`{name}.{config.DOMAIN}`)
      traefik.http.routers.{name}.entrypoints: websecure
      traefik.http.routers.{name}.tls: "true"
      traefik.http.routers.{name}.tls.certresolver: letsencrypt
      traefik.http.services.{name}.loadbalancer.server.port: "3000"
    healthcheck:
      test: {healthcheck}
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    mem_limit: 256m
    cpus: 0.5
    pids_limit: 100
    security_opt: [no-new-privileges:true]
networks:
  internal: {{internal: true}}
  proxy: {{external: true}}
'''


def starter_page(name, description):
    safe = lambda text: str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return f'''<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe(name)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <p class="badge">Proyecto nuevo</p>
    <h1>{safe(name)}</h1>
    <p>{safe(description) or 'Listo para empezar a construir.'}</p>
    <p class="hint">El agente está preparando la aplicación. Recarga en unos minutos.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
'''


STARTER_CSS = '''*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#0e1525;color:#f5f9fc;padding:24px}
main{max-width:560px}h1{font-size:clamp(2rem,8vw,3.2rem);margin:.2em 0}p{color:#c2c8d0;line-height:1.6}.badge{display:inline-block;background:#2b3245;color:#f5a35c;border-radius:99px;padding:4px 12px;font-size:.8rem}.hint{font-size:.9rem;color:#8b93a1}
'''


def scaffold_files(name, description, base):
    files = {
        'README.md': f'# {name}\n\n{description or "Proyecto creado desde Codex Manager."}\n\nURL: https://{name}.{config.DOMAIN}\n\n'
                     '## Desplegar\n\n```bash\ndocker compose up -d --build\n```\n',
        '.env.example': '# Variables de entorno del proyecto\n',
        '.gitignore': '.env\nnode_modules/\n__pycache__/\n.codex-manager/\ndist/\n',
        '.dockerignore': '.git\n.env\nnode_modules\n.codex-manager\n',
    }
    if base == 'node':
        files.update({
            'package.json': '{\n  "name": "%s",\n  "private": true,\n  "type": "module",\n  "scripts": {"start": "node server.js"}\n}\n' % name,
            'server.js': '''import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';

const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'};
const root = join(process.cwd(), 'public');

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') { res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"ok":true}'); }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(file); res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream'}); res.end(body); }
  catch { res.writeHead(404); res.end('No encontrado'); }
}).listen(3000, () => console.log('Escuchando en el puerto 3000'));
''',
            'public/index.html': starter_page(name, description), 'public/styles.css': STARTER_CSS, 'public/app.js': "console.log('Listo');\n",
            'Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\nCOPY server.js ./\nCOPY public/ public/\nUSER node\nEXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1\nCMD ["node", "server.js"]\n',
            'compose.yaml': compose_yaml(name, '["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]'),
        })
    else:
        files.update({
            'public/index.html': starter_page(name, description), 'public/styles.css': STARTER_CSS, 'public/app.js': "console.log('Listo');\n",
            'Dockerfile': 'FROM python:3.12-slim\nWORKDIR /app\nCOPY public/ public/\nRUN useradd --create-home web\nUSER web\nEXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:3000/\', timeout=3)"\nCMD ["python", "-m", "http.server", "3000", "--directory", "public"]\n',
            'compose.yaml': compose_yaml(name, '["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:3000/\', timeout=3)"]'),
        })
    return files


def build_prompt(name, description, stack):
    stack_text = STACKS.get(stack, STACKS['auto'])[2]
    return f'''Construye este proyecto a partir de la idea del usuario:

«{description}»

Stack preferido: {stack_text}.

Contexto:
- Directorio: {config.HOST_PROJECTS}/{name}. URL pública: https://{name}.{config.DOMAIN} (Traefik y HTTPS ya configurados).
- Ya hay un scaffold mínimo desplegado (Dockerfile, compose.yaml, README.md, .env.example). Puedes reemplazar el código y el Dockerfile según el stack, pero conserva en compose.yaml el nombre de proyecto/router/servicio `{name}`, la red externa `proxy`, el puerto interno 3000 en la etiqueta de Traefik, el healthcheck y los límites de CPU, memoria y procesos.
- Diseño responsive pensado primero para celular.
- Cuando termines: ejecuta `docker compose up -d --build` en el directorio del proyecto, comprueba que https://{name}.{config.DOMAIN} responde 200 y haz un commit con git.
- Al final resume en pocas líneas qué construiste y cómo se usa.'''


def create_project(name, description='', stack='auto'):
    """Crea el scaffold de forma atómica (todo o nada) y su primer commit."""
    if not re.fullmatch(config.PROJECT_NAME, name or ''): return False, 'Nombre inválido: usa minúsculas, números y guiones; no termines con guion'
    if name.startswith(config.INTERNAL_SESSION_PREFIXES): return False, 'Ese nombre está reservado para las sesiones del sistema'
    if name in ('app', 'api', 'backend', 'www', 'traefik') : return False, 'Ese nombre es demasiado genérico para un subdominio; elige otro'
    target = config.PROJECTS / name
    if target.exists(): return False, 'Ese proyecto ya existe'
    base = STACKS.get(stack, STACKS['auto'])[1]
    config.PROJECTS.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f'.{name}-creating-', dir=config.PROJECTS))
    try:
        for relative, content in scaffold_files(name, description, base).items():
            path = staging / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        commands = [['init', '-q', '-b', 'main'], ['add', '-A']]
        for args in commands:
            code, _, error = run_full(['git', '-C', str(staging), *args], timeout=15)
            if code: raise RuntimeError(error)
        for key, fallback in (('user.name', 'Codex Manager'), ('user.email', 'codex-manager@localhost')):
            if not run('git', '-C', str(staging), 'config', '--get', key):
                code, _, error = run_full(['git', '-C', str(staging), 'config', key, fallback], timeout=15)
                if code: raise RuntimeError(error)
        code, _, error = run_full(['git', '-C', str(staging), 'commit', '-q', '-m', 'Scaffold inicial desde Codex Manager'], timeout=15)
        if code: raise RuntimeError(error)
        os.chmod(staging, 0o750)
        os.replace(staging, target)
        invalidate()
        return True, f'Proyecto {name} creado; se publicará en https://{name}.{config.DOMAIN}'
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        return False, 'No se pudo crear el proyecto; no se guardaron archivos incompletos'
