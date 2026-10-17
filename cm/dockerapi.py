import json, re, socket, threading
from concurrent.futures import ThreadPoolExecutor

DOCKER_SOCKET = '/var/run/docker.sock'
DOCKER_ACTIONS = {'stop': 'detenido', 'start': 'iniciado', 'restart': 'reiniciado'}
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')
MAX_RESPONSE = 8 * 1024 * 1024
_invalidate_hooks = []


def on_change(callback):
    _invalidate_hooks.append(callback)


def _changed():
    for callback in _invalidate_hooks: callback()


def docker_call(method, path, timeout=3):
    """Petición cruda a la API de Docker. Devuelve (código HTTP, cuerpo ya sin chunked)."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(DOCKER_SOCKET)
        sock.sendall(f'{method} {path} HTTP/1.1\r\nHost: docker\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'.encode())
        data = b''
        while True:
            chunk = sock.recv(65536)
            if not chunk: break
            data += chunk
            if len(data) > MAX_RESPONSE:
                raise OSError('La respuesta de Docker supera el límite de 8 MB; reduce las líneas solicitadas')
    finally:
        sock.close()
    head, _, body = data.partition(b'\r\n\r\n')
    try: status = int(head.split(b' ', 2)[1])
    except (IndexError, ValueError): status = 0
    if b'transfer-encoding: chunked' in head.lower():
        decoded = b''
        while body:
            size_end = body.find(b'\r\n')
            if size_end < 0: break
            size = int(body[:size_end].split(b';', 1)[0], 16)
            if size == 0: break
            start = size_end + 2
            decoded += body[start:start + size]
            body = body[start + size + 2:]
        body = decoded
    return status, body


def docker_request(path, timeout=3):
    return json.loads(docker_call('GET', path, timeout)[1].decode())


def docker():
    # all=1 para que los contenedores detenidos sigan visibles y se puedan volver a iniciar.
    return docker_request('/containers/json?all=1')


def container_belongs_to(container, project):
    """Si el contenedor viene de Compose, solo cuenta su etiqueta de proyecto: así
    `poleana` no se apropia de `poleana-game-*`. Sin etiqueta se usa el prefijo del nombre."""
    compose_project = (container.get('Labels') or {}).get('com.docker.compose.project')
    if compose_project: return compose_project == project
    return any(n.lstrip('/').startswith(project + '-') or n.lstrip('/') == project for n in container.get('Names', []))


def is_self_container(container):
    """El contenedor del propio dashboard: detenerlo dejaría la web sin forma de volver a iniciarlo."""
    hostname = socket.gethostname()
    return bool(hostname) and str(container.get('Id', '')).startswith(hostname)


def container_name(container):
    return (container.get('Names') or [''])[0].lstrip('/') or str(container.get('Id', ''))[:12]


def project_containers(project):
    return [c for c in docker() if container_belongs_to(c, project)]


def container_urls(container):
    """Dominios publicados por Traefik para el contenedor (etiquetas Host(`…`))."""
    urls = []
    for key, value in (container.get('Labels') or {}).items():
        if key.startswith('traefik.http.routers.') and key.endswith('.rule'):
            for host in re.findall(r'Host\(`([^`]+)`\)', value):
                if f'https://{host}' not in urls: urls.append(f'https://{host}')
    return urls


def start_order(containers):
    """Ordena por dependencias de Compose (etiqueta depends_on) para que la base de datos
    arranque antes que la API que la necesita."""
    services = {(c.get('Labels') or {}).get('com.docker.compose.service', ''): c for c in containers}
    def depth(container, seen=()):
        deps = (container.get('Labels') or {}).get('com.docker.compose.depends_on', '')
        names = [d.split(':', 1)[0] for d in deps.split(',') if d]
        return max((1 + depth(services[n], seen + (n,)) for n in names if n in services and n not in seen), default=0)
    return sorted(containers, key=depth)


def container_action(container, action):
    query = '' if action == 'start' else '?t=10'
    try: status, body = docker_call('POST', f"/containers/{container['Id']}/{action}{query}", timeout=40)
    except Exception as error: return False, f'{container_name(container)}: {error}'
    if status in (204, 304): return True, container_name(container)
    try: detail = json.loads(body.decode()).get('message', '')
    except Exception: detail = ''
    return False, f'{container_name(container)}: {detail or f"error {status}"}'


def docker_action(project, action, container_id=''):
    """Detiene, inicia o reinicia un contenedor del proyecto o el proyecto completo."""
    if action not in DOCKER_ACTIONS: return False, 'Acción inválida'
    try: containers = project_containers(project)
    except Exception: return False, 'Docker no está disponible'
    if container_id:
        containers = [c for c in containers if c.get('Id') == container_id]
        if not containers: return False, 'Ese contenedor no pertenece al proyecto'
    if not containers: return False, 'El proyecto no tiene contenedores'
    if action == 'stop' and any(is_self_container(c) for c in containers):
        return False, 'No se puede detener el contenedor del propio dashboard desde aquí; usa reiniciar'
    if action == 'stop': targets = [c for c in containers if c.get('State') == 'running']
    elif action == 'start': targets = [c for c in containers if c.get('State') != 'running']
    else: targets = containers
    if not targets: return True, 'No había nada que hacer: ' + ('ya estaban detenidos' if action == 'stop' else 'ya estaban en ejecución')
    if action == 'stop':
        with ThreadPoolExecutor(max_workers=min(10, len(targets))) as pool:
            results = list(pool.map(lambda c: container_action(c, 'stop'), targets))
    elif action == 'start' or len(targets) == 1:
        results = [container_action(c, action) for c in start_order(targets)]
    else:
        # Reiniciar varios: se detienen en paralelo y se levantan respetando dependencias.
        with ThreadPoolExecutor(max_workers=min(10, len(targets))) as pool:
            stopped = list(pool.map(lambda c: container_action(c, 'stop'), [c for c in targets if c.get('State') == 'running']))
        results = [r for r in stopped if not r[0]] + [container_action(c, 'start') for c in start_order(targets)]
    _changed()
    failed = [message for ok, message in results if not ok]
    if failed: return False, 'Algunos contenedores fallaron: ' + '; '.join(failed)
    label = DOCKER_ACTIONS[action]
    if len(targets) == 1: return True, f'Contenedor {container_name(targets[0])} {label}'
    return True, f'{len(targets)} contenedores de {project} {label}s'


def demux_logs(raw):
    """Separa el flujo multiplexado de Docker (cabecera de 8 bytes por trama) cuando el
    contenedor no usa TTY; con TTY el flujo llega tal cual y se trata como stdout."""
    if len(raw) < 8 or raw[0] not in (0, 1, 2) or raw[1:4] != b'\0\0\0':
        return [('stdout', raw.decode(errors='replace'))]
    frames, position = [], 0
    while position + 8 <= len(raw):
        stream, size = raw[position], int.from_bytes(raw[position + 4:position + 8], 'big')
        frames.append(('stderr' if stream == 2 else 'stdout', raw[position + 8:position + 8 + size].decode(errors='replace')))
        position += 8 + size
    return frames


def container_logs(container, tail):
    status, raw = docker_call('GET', f"/containers/{container['Id']}/logs?stdout=1&stderr=1&timestamps=1&tail={tail}", timeout=8)
    if status != 200: raise OSError(f'Docker respondió {status}')
    name = container_name(container)
    service = (container.get('Labels') or {}).get('com.docker.compose.service') or name
    entries = []
    for stream, text in demux_logs(raw):
        for line in text.splitlines():
            stamp, _, message = line.partition(' ')
            if not re.match(r'\d{4}-\d\d-\d\dT', stamp): stamp, message = '', line
            entries.append({'time': stamp, 'container': name, 'service': service, 'stream': stream, 'text': ANSI.sub('', message).rstrip('\r')})
    return entries


def project_logs(project, container_id='', tail=200):
    tail = max(10, min(2000, int(tail)))
    containers = project_containers(project)
    if container_id:
        containers = [c for c in containers if c.get('Id') == container_id]
        if not containers: raise LookupError('Ese contenedor no pertenece al proyecto')
    entries = []
    with ThreadPoolExecutor(max_workers=max(1, min(10, len(containers)))) as pool:
        for rows in pool.map(lambda c: container_logs(c, tail), containers): entries.extend(rows)
    # Las marcas RFC3339 de Docker están todas en UTC, así que ordenar el texto ordena el tiempo.
    entries.sort(key=lambda entry: entry['time'])
    return entries[-tail:] if not container_id else entries


def container_memory(container_id):
    try:
        stats = docker_request(f'/containers/{container_id}/stats?stream=false&one-shot=true', timeout=2)
        memory = stats.get('memory_stats', {})
        return int(memory.get('usage', 0)), int(memory.get('limit', 0))
    except Exception:
        return 0, 0
