"""Ejecuciones de agentes (Claude Code / Codex) y trabajos de despliegue.

Cada petición de la cola se convierte en una *ejecución*: un proceso no
interactivo (`claude -p --output-format stream-json` o `codex exec --json`) que
corre en el host dentro de una sesión tmux `cmr-<id>`. A diferencia del sistema
anterior (escribir en la TUI con send-keys y esperar a que el agente creara un
archivo de confirmación), aquí el final es inequívoco: el proceso termina y deja
`exit.json`. Nada se queda "Atendiendo" para siempre.

La conversación continúa entre peticiones: Claude con `--resume <session_id>` y
Codex con `exec resume <thread_id>`, guardados por proyecto/chat/proveedor en agent-sessions.json.
Claude y Codex comparten cada chat: al cambiar de agente, el elegido recibe un resumen de
las peticiones del chat que no vio (handoff_context), así el trabajo sigue sin repetirlo.
"""
import hashlib, json, re, secrets, threading, time, uuid
from functools import wraps
from pathlib import Path
from . import config, tasks, tmux
from .util import clip, now_text, read_json, tail_text, write_json

WAKE = threading.Event()
STATE_LOCK = threading.RLock()
AUTOMATION = {'last_check': None, 'last_dispatch': None, 'last_message': 'Esperando la primera revisión'}
_events_cache = {}
_change_hooks = []
JOB_ACTIONS = {
    'deploy': (['docker', 'compose', 'up', '-d', '--build', '--remove-orphans'], 'Desplegar (build + up)'),
    'dev': (['docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.dev.yaml', 'up', '-d', '--build'], 'Modo desarrollo en vivo'),
    'restart': (['docker', 'compose', 'restart'], 'Reiniciar servicios'),
    'down': (['docker', 'compose', 'down'], 'Apagar (compose down)'),
    'build': (['docker', 'compose', 'build'], 'Solo construir'),
}
RUNNER = f'{config.HOST_APP_DIR}/bin/cm-runner.py'


def state_locked(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        with STATE_LOCK: return func(*args, **kwargs)
    return wrapped


def on_change(callback):
    _change_hooks.append(callback)


def changed():
    for callback in _change_hooks: callback()
    WAKE.set()


# ---------------------------------------------------------------- ajustes y sesiones

def load_settings():
    data = {**config.DEFAULT_SETTINGS, **read_json(config.SETTINGS_FILE, {})}
    if data['claude_permission'] not in config.CLAUDE_PERMISSIONS: data['claude_permission'] = 'ask'
    if data['codex_sandbox'] not in config.CODEX_SANDBOXES: data['codex_sandbox'] = 'full'
    if data['default_provider'] not in config.PROVIDERS: data['default_provider'] = 'claude'
    if data['auto_commit'] not in ('on', 'off'): data['auto_commit'] = 'on'
    return data


@state_locked
def save_settings(changes):
    current = load_settings()
    for key, value in (changes or {}).items():
        if key not in config.DEFAULT_SETTINGS: continue
        value = str(value or '').strip()
        if key == 'claude_permission' and value not in config.CLAUDE_PERMISSIONS: return False, 'Modo de permisos de Claude inválido'
        if key == 'codex_sandbox' and value not in config.CODEX_SANDBOXES: return False, 'Modo de sandbox de Codex inválido'
        if key == 'default_provider' and value not in config.PROVIDERS: return False, 'Agente por defecto inválido'
        if key == 'auto_commit' and value not in ('on', 'off'): return False, 'Valor de versionado automático inválido'
        if key.endswith('_model') and value and not re.fullmatch(r'[A-Za-z0-9._:\[\]-]{1,80}', value): return False, 'Nombre de modelo inválido'
        current[key] = value
    write_json(config.SETTINGS_FILE, current)
    return True, 'Ajustes guardados'


def agent_sessions():
    return read_json(config.SESSIONS_FILE, {})


@state_locked
def set_agent_session(project, provider, session_id, chat_id='main'):
    data = agent_sessions()
    bucket = data.setdefault(project, {})
    if chat_id != 'main': bucket = bucket.setdefault('_chats', {}).setdefault(chat_id, {})
    if session_id:
        bucket[provider] = {'id': session_id, 'updated_at': time.time()}
    else:
        bucket.pop(provider, None)
    write_json(config.SESSIONS_FILE, data)


def chat_sessions(project, chat_id='main'):
    bucket = agent_sessions().get(project, {})
    if chat_id != 'main': bucket = bucket.get('_chats', {}).get(chat_id, {})
    return {k: v for k, v in bucket.items() if k in config.PROVIDERS}


def context_start(project, chat_id='main'):
    """Desde cuándo cuenta el contexto del chat (0 = desde el principio)."""
    bucket = agent_sessions().get(project, {})
    if chat_id != 'main': bucket = bucket.get('_chats', {}).get(chat_id, {})
    return bucket.get('_reset_at', 0)


@state_locked
def reset_context(project, chat_id='main'):
    data = agent_sessions()
    bucket = data.setdefault(project, {})
    if chat_id != 'main': bucket = bucket.setdefault('_chats', {}).setdefault(chat_id, {})
    for provider in config.PROVIDERS: bucket.pop(provider, None)
    bucket['_reset_at'] = time.time()
    write_json(config.SESSIONS_FILE, data)


def reset_conversation(project, provider, chat_id='main'):
    # El contexto es del chat, no de un agente: se reinician los dos a la vez.
    if provider not in config.PROVIDERS: return False, 'Agente inválido'
    with tasks.LOCK:
        if any(t['project'] == project and t.get('chat_id', 'main') == chat_id and t['status'] in ('working', 'espera') for t in tasks.task_records()):
            return False, 'Detén la petición actual antes de empezar una conversación nueva'
        reset_context(project, chat_id)
    changed()
    return True, 'Contexto reiniciado: Claude y Codex empiezan desde cero en este chat'


def label(provider):
    return 'Claude' if provider == 'claude' else 'Codex'


# ---------------------------------------------------------------- creación de ejecuciones

def new_id():
    return time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)


def system_prompt(project):
    return (f'Trabajas en el proyecto «{project}» ({config.HOST_PROJECTS}/{project}), publicado en https://{project}.{config.DOMAIN}. '
            'El usuario te escribe desde Codex Manager, un panel web que suele usar desde el celular: responde en español, '
            'de forma breve y clara, y termina con un resumen corto de lo que hiciste y lo que queda pendiente. '
            'Si cambias código de una app ya desplegada, reconstruye con `docker compose up -d --build` en el directorio '
            'del proyecto y verifica la URL con curl antes de terminar.')


HANDOFF_SCAN, HANDOFF_RUNS, HANDOFF_CHARS = 40, 12, 14000
STATE_TEXT = {'done': 'terminada', 'stopped': 'detenida por el usuario', 'error': 'terminó con error', 'running': 'en curso', 'stopping': 'deteniéndose'}


def request_text(meta):
    """Mensaje del usuario, sin el contexto que añade el panel."""
    folder = config.RUNS / meta['id']
    try: return (folder / 'request.txt').read_text(errors='replace')
    except OSError: pass
    try: prompt = (folder / 'prompt.txt').read_text(errors='replace')
    except OSError: return ''
    if meta['provider'] == 'codex' and prompt.startswith('[Contexto de Codex Manager]'):
        prompt = prompt.split('\n\n', 1)[-1]
    return prompt


def _run_summary(meta):
    events, info = run_events(meta['id'], meta['provider'])
    status = run_status(meta, exit_info(meta['id']), info)
    who = label(meta['provider'])
    when = time.strftime('%d/%m %H:%M UTC', time.gmtime(meta.get('created_at') or 0))
    answer = ((info.get('result') or {}).get('text') or next((e['text'] for e in reversed(events) if e.get('t') == 'text' and not e.get('sub')), '')).strip()
    root, changed_files = f"{meta.get('cwd', '')}/", []
    for event in events:
        if event.get('t') != 'tool': continue
        data = event.get('input') or {}
        paths = [data.get('file_path')] if event.get('name') in ('Write', 'Edit', 'MultiEdit') else [c.get('path') for c in data.get('changes') or [] if isinstance(c, dict)]
        for path in paths:
            path = str(path or '').removeprefix(root)
            if path and path not in changed_files: changed_files.append(path)
    lines = [f'### {who} · {when} · {STATE_TEXT.get(status, status)}', f'Usuario: {clip(request_text(meta).strip(), 1500)}']
    if answer: lines.append(f'{who} respondió: {clip(answer, 2500)}')
    elif status == 'error': lines.append(f"Error: {clip(describe_run(meta, full=False).get('error') or 'sin detalle', 400)}")
    if changed_files: lines.append('Archivos modificados: ' + ', '.join(changed_files[:25]) + (f' y {len(changed_files) - 25} más' if len(changed_files) > 25 else ''))
    version = read_json(config.RUNS / meta['id'] / 'versions.json', None)
    if isinstance(version, dict) and version.get('commit'): lines.append(f"Versión guardada: {str(version['commit'])[:10]}")
    return '\n'.join(lines)


def handoff_context(project, chat_id, provider, stored):
    """Peticiones del chat que el agente elegido no ha visto: las posteriores a su último turno
    en la sesión guardada, o todo el chat (desde el último reinicio) si no tiene sesión.
    Devuelve (texto para anteponer al mensaje, número de peticiones resumidas)."""
    since, unseen = context_start(project, chat_id), []
    for meta in list_runs(project, limit=HANDOFF_SCAN, chat_id=chat_id):
        if meta.get('created_at', 0) <= since: break
        if stored and meta['provider'] == provider:
            session = run_events(meta['id'], provider)[1].get('session_id')
            if session and stored in (session, meta.get('resume_id')): break
        unseen.append(meta)
    unseen.sort(key=lambda meta: meta.get('created_at', 0), reverse=True)
    parts, used = [], 0
    for meta in unseen[:HANDOFF_RUNS]:
        text = _run_summary(meta)
        if parts and used + len(text) > HANDOFF_CHARS: break
        parts.append(text); used += len(text)
    if not parts: return '', 0
    omitted = len(unseen) - len(parts)
    parts.reverse()
    header = (f'[Contexto de Codex Manager: continuidad del chat] Claude y Codex comparten este chat del proyecto «{project}» '
              f'y el usuario puede alternar entre ambos. Antes de este mensaje hubo {len(parts)} petición(es) que no viste'
              + (f' (se omiten {omitted} más antiguas)' if omitted else '') + '. Los archivos del proyecto ya contienen esos cambios; '
              'comprueba el estado real (git status/log, notas del proyecto) si lo necesitas y continúa sin pedir al usuario que repita nada.')
    return f'{header}\n\n' + '\n\n'.join(parts) + '\n\n[Mensaje actual del usuario]\n', len(parts)


def start_run(task):
    """Lanza la petición en el host. Devuelve (ok, mensaje, run_id)."""
    provider, project = task['provider'], task['project']
    project_dir = config.PROJECTS / project
    if provider not in config.PROVIDERS: return False, 'Agente inválido', ''
    if not re.fullmatch(config.PROJECT_NAME, project) or project_dir.resolve().parent != config.PROJECTS.resolve() or not project_dir.is_dir():
        return False, f'El proyecto {project} no existe', ''
    settings = load_settings()
    run_id = new_id()
    run_dir = config.RUNS / run_id
    run_dir.mkdir(parents=True, mode=0o700)
    chat_id = task.get('chat_id') or 'main'
    stored = chat_sessions(project, chat_id).get(provider, {}).get('id', '')
    request = tasks.task_prompt(task)
    handoff, handed = handoff_context(project, chat_id, provider, stored)
    prompt = handoff + request
    meta = {'id': run_id, 'kind': 'agent', 'provider': provider, 'project': project, 'task_id': task['id'], 'chat_id': chat_id,
            'cwd': f'{config.HOST_PROJECTS}/{project}', 'created_at': time.time(), 'resume_id': stored, 'origin': task.get('origin', 'task'),
            # El runner guarda una versión antes y otra después del agente (bin/cm-runner.py).
            'title': ' '.join(str(task.get('title') or '').split())[:100], 'versioning': settings['auto_commit'] == 'on'}
    if handed: meta['handoff'] = handed
    if provider == 'claude':
        if not stored: meta['session_id'] = str(uuid.uuid4())
        meta.update({'model': settings['claude_model'], 'permission': settings['claude_permission'], 'system_prompt': system_prompt(project)})
    else:
        meta.update({'model': settings['codex_model'], 'sandbox': settings['codex_sandbox']})
        if not stored:
            # Codex no tiene --append-system-prompt: el contexto va al inicio del primer mensaje.
            prompt = f'[Contexto de Codex Manager] {system_prompt(project)}\n\n{prompt}'
    (run_dir / 'prompt.txt').write_text(prompt)
    (run_dir / 'request.txt').write_text(request)
    write_json(run_dir / 'meta.json', meta)
    ok, error = tmux.new_session(f'cmr-{run_id}', meta['cwd'], ['/usr/bin/python3', RUNNER, config.host_path(run_dir)])
    if not ok:
        write_json(run_dir / 'exit.json', {'code': 127, 'stopped': False, 'finished_at': time.time(), 'launch_error': error})
        return False, f'No se pudo iniciar {label(provider)}: {error}', run_id
    if provider == 'claude' and meta.get('session_id'):
        set_agent_session(project, 'claude', meta['session_id'], chat_id)
    return True, f'{label(provider)} está trabajando en {project}', run_id


def request_stop(run_id):
    if not run_meta(run_id): return False, 'Ejecución no encontrada'
    run_dir = config.RUNS / run_id
    if not (run_dir / 'meta.json').exists(): return False, 'Ejecución no encontrada'
    if (run_dir / 'exit.json').exists(): return False, 'La ejecución ya había terminado'
    (run_dir / 'stop').write_text(now_text())
    WAKE.set()
    return True, 'Deteniendo la ejecución…'


# ---------------------------------------------------------------- estado y eventos

def run_meta(run_id):
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[0-9a-f]{6}', str(run_id or '')): return None
    return read_json(config.RUNS / run_id / 'meta.json', None)


def exit_info(run_id):
    return read_json(config.RUNS / run_id / 'exit.json', None)


def _parse_lines(path):
    rows = []
    try:
        with open(path, 'rb') as handle:
            for raw in handle:
                raw = raw.strip()
                if not raw: continue
                try: rows.append(json.loads(raw))
                except ValueError: rows.append({'type': '_raw', 'text': raw.decode(errors='replace')})
    except OSError:
        pass
    return rows


def _tool_input(value):
    if isinstance(value, dict):
        return {k: _tool_input(v) for k, v in list(value.items())[:30]}
    if isinstance(value, list):
        return [_tool_input(v) for v in value[:50]]
    if isinstance(value, str):
        return clip(value, 6000)
    return value


def _tool_output(content):
    if isinstance(content, list):
        content = '\n'.join(str(part.get('text', '')) if isinstance(part, dict) else str(part) for part in content)
    return clip(content, 8000)


def normalize_claude(rows):
    events, tools, info = [], {}, {}
    for row in rows:
        kind = row.get('type')
        nested = bool(row.get('parent_tool_use_id'))
        if kind == 'system' and row.get('subtype') == 'init':
            info.update({'session_id': row.get('session_id'), 'model': row.get('model'), 'permission_mode': row.get('permissionMode')})
        elif kind == 'system' and row.get('subtype') == 'api_retry':
            events.append({'t': 'notice', 'text': f"Reintentando la API (intento {row.get('attempt', '?')})…"})
        elif kind == 'assistant':
            for block in (row.get('message') or {}).get('content') or []:
                btype = block.get('type')
                if btype == 'text' and block.get('text', '').strip():
                    events.append({'t': 'text', 'text': block['text'], 'sub': nested})
                elif btype == 'thinking' and block.get('thinking', '').strip():
                    events.append({'t': 'thinking', 'text': clip(block['thinking'], 4000), 'sub': nested})
                elif btype == 'tool_use':
                    event = {'t': 'tool', 'id': block.get('id'), 'name': block.get('name'), 'input': _tool_input(block.get('input') or {}),
                             'status': 'running', 'output': '', 'sub': nested}
                    tools[block.get('id')] = event
                    events.append(event)
        elif kind == 'user':
            content = (row.get('message') or {}).get('content')
            for block in content if isinstance(content, list) else []:
                if block.get('type') == 'tool_result' and block.get('tool_use_id') in tools:
                    event = tools[block['tool_use_id']]
                    event['output'] = _tool_output(block.get('content'))
                    event['status'] = 'error' if block.get('is_error') else 'done'
        elif kind == 'result':
            info['result'] = {'ok': not row.get('is_error') and row.get('subtype') == 'success', 'text': row.get('result') or '',
                              'cost': row.get('total_cost_usd'), 'duration_ms': row.get('duration_ms'), 'turns': row.get('num_turns'),
                              'denials': len(row.get('permission_denials') or []), 'subtype': row.get('subtype')}
        elif kind == 'rate_limit_event':
            info['limits'] = row.get('rate_limit_info')
        elif kind == '_raw':
            events.append({'t': 'notice', 'text': clip(row['text'], 2000)})
    return events, info


def normalize_codex(rows):
    events, items, info = [], {}, {}
    def upsert(item, final):
        item_id, itype = item.get('id'), item.get('type')
        if itype == 'agent_message':
            event = {'t': 'text', 'text': item.get('text', '')}
        elif itype == 'reasoning':
            event = {'t': 'thinking', 'text': clip(item.get('text', ''), 4000)}
        elif itype == 'command_execution':
            status = item.get('status') or ('done' if final else 'running')
            failed = status == 'failed' or (item.get('exit_code') not in (None, 0))
            event = {'t': 'tool', 'name': 'Bash', 'input': {'command': clip(item.get('command', ''), 6000)}, 'output': clip(item.get('aggregated_output', ''), 8000),
                     'status': 'error' if failed and final else ('done' if final else 'running'), 'exit_code': item.get('exit_code')}
        elif itype == 'file_change':
            event = {'t': 'tool', 'name': 'FileChange', 'input': {'changes': item.get('changes') or []}, 'output': '',
                     'status': 'error' if item.get('status') == 'failed' else ('done' if final else 'running')}
        elif itype == 'mcp_tool_call':
            event = {'t': 'tool', 'name': f"mcp:{item.get('server', '')}/{item.get('tool', '')}", 'input': _tool_input(item.get('arguments') or {}),
                     'output': _tool_output(json.dumps(item.get('result') or item.get('error') or '', ensure_ascii=False)),
                     'status': 'error' if item.get('error') else ('done' if final else 'running')}
        elif itype == 'web_search':
            event = {'t': 'tool', 'name': 'WebSearch', 'input': {'query': item.get('query', '')}, 'output': '', 'status': 'done' if final else 'running'}
        elif itype == 'todo_list':
            event = {'t': 'todo', 'items': [{'content': x.get('text', ''), 'status': 'completed' if x.get('completed') else 'pending'} for x in item.get('items') or []]}
        elif itype == 'error':
            event = {'t': 'error', 'text': item.get('message', '')}
        else:
            return
        if item_id in items:
            items[item_id].clear(); items[item_id].update(event)
        else:
            items[item_id] = event; events.append(event)
    for row in rows:
        kind = row.get('type')
        if kind == 'thread.started':
            info['session_id'] = row.get('thread_id')
        elif kind in ('item.started', 'item.updated', 'item.completed'):
            upsert(row.get('item') or {}, kind == 'item.completed')
        elif kind == 'turn.completed':
            last = next((e['text'] for e in reversed(events) if e.get('t') == 'text'), '')
            info['result'] = {'ok': True, 'text': last, 'usage': row.get('usage'), 'subtype': 'success'}
        elif kind == 'turn.failed':
            message = (row.get('error') or {}).get('message', 'El turno falló')
            info['result'] = {'ok': False, 'text': message, 'subtype': 'error'}
            events.append({'t': 'error', 'text': message})
        elif kind == 'error':
            events.append({'t': 'error', 'text': row.get('message', '')})
        elif kind == '_raw':
            events.append({'t': 'notice', 'text': clip(row['text'], 2000)})
    return events, info


def run_events(run_id, provider):
    """Eventos normalizados de una ejecución, con caché por tamaño del archivo."""
    path = config.RUNS / run_id / 'events.jsonl'
    try: stat = path.stat(); key = (stat.st_size, stat.st_mtime_ns)
    except OSError: key = (0, 0)
    cached = _events_cache.get(run_id)
    if cached and cached[0] == key: return cached[1], cached[2]
    rows = _parse_lines(path) if key[0] else []
    events, info = normalize_claude(rows) if provider == 'claude' else normalize_codex(rows)
    if len(_events_cache) > 200: _events_cache.clear()
    _events_cache[run_id] = (key, events, info)
    return events, info


def stderr_tail(run_id, limit=3000):
    return tail_text(config.RUNS / run_id / 'stderr.log', limit)


def run_status(meta, exit_data, info):
    if not exit_data:
        return 'stopping' if (config.RUNS / meta['id'] / 'stop').exists() else 'running'
    if exit_data.get('stopped'): return 'stopped'
    result = info.get('result')
    if exit_data.get('code') == 0 and (result is None or result.get('ok')): return 'done'
    return 'error'


def pending_approvals(run_id, meta=None):
    folder = config.RUNS / run_id / 'approvals'
    if not folder.is_dir() or (config.RUNS / run_id / 'exit.json').exists(): return []
    rows = []
    for req in sorted(folder.glob('*.req.json')):
        request_id = req.name[:-len('.req.json')]
        if (folder / f'{request_id}.ans.json').exists(): continue
        data = read_json(req, None)
        if not data: continue
        data['input'] = _tool_input(data.get('input') or {})
        data['run_id'] = run_id
        if meta: data.update({'project': meta['project'], 'provider': meta['provider'], 'chat_id': meta.get('chat_id', 'main')})
        rows.append(data)
    return rows


@state_locked
def answer_approval(run_id, request_id, decision, remember=False, message=''):
    meta = run_meta(run_id)
    if not meta: return False, 'Ejecución no encontrada'
    if exit_info(run_id) or (config.RUNS / run_id / 'stop').exists(): return False, 'La ejecución ya no acepta aprobaciones'
    if not re.fullmatch(r'[0-9]+-[0-9a-f]{6}', str(request_id or '')): return False, 'Solicitud inválida'
    folder = config.RUNS / run_id / 'approvals'
    request = read_json(folder / f'{request_id}.req.json', None)
    if not request: return False, 'Solicitud no encontrada'
    if (folder / f'{request_id}.ans.json').exists(): return False, 'Esa solicitud ya fue respondida'
    if decision not in ('allow', 'deny'): return False, 'Decisión inválida'
    if decision == 'allow' and remember and request.get('rule'):
        rules = read_json(config.RULES_FILE, {})
        project_rules = rules.setdefault(meta['project'], [])
        if request['rule'] not in project_rules: project_rules.append(request['rule'])
        write_json(config.RULES_FILE, rules)
    write_json(folder / f'{request_id}.ans.json', {'decision': decision, 'message': str(message or '')[:500], 'answered_at': time.time()})
    changed()
    return True, 'Permitido' if decision == 'allow' else 'Denegado'


def approval_rules(project):
    return read_json(config.RULES_FILE, {}).get(project, [])


@state_locked
def remove_rule(project, rule):
    rules = read_json(config.RULES_FILE, {})
    if rule in rules.get(project, []):
        rules[project].remove(rule)
        write_json(config.RULES_FILE, rules)
    changed()
    return True, 'Regla eliminada'


def describe_run(meta, full=True):
    run_id = meta['id']
    exit_data = exit_info(run_id)
    events, info = run_events(run_id, meta['provider'])
    prompt = request_text(meta)
    status = run_status(meta, exit_data, info)
    data = {'id': run_id, 'provider': meta['provider'], 'project': meta['project'], 'task_id': meta.get('task_id'), 'origin': meta.get('origin'), 'chat_id': meta.get('chat_id', 'main'),
            'created_at': meta.get('created_at'), 'finished_at': (exit_data or {}).get('finished_at'), 'status': status,
            'prompt': clip(prompt, 8000), 'model': info.get('model') or meta.get('model') or '', 'result': info.get('result'),
            'event_count': len(events), 'permission': meta.get('permission') or meta.get('sandbox'), 'resumed': bool(meta.get('resume_id')), 'handoff': meta.get('handoff', 0)}
    if info.get('limits'): data['limits'] = info['limits']
    version = read_json(config.RUNS / run_id / 'versions.json', None)
    if isinstance(version, dict): data['version'] = {k: version.get(k) or '' for k in ('base', 'commit', 'error')}
    if full:
        data['events'] = events[-400:]
        data['approvals'] = pending_approvals(run_id, meta)
    if status == 'error':
        data['error'] = (exit_data or {}).get('launch_error') or (exit_data or {}).get('lost') and 'El proceso del agente terminó inesperadamente' or ''
        if not data['error'] and not (info.get('result') or {}).get('text'):
            data['error'] = stderr_tail(run_id, 1500) or f"El agente terminó con código {(exit_data or {}).get('code')}"
        if (info.get('limits') or {}).get('status') == 'rejected':
            data['error'] = 'Claude alcanzó su límite de uso. Puedes usar Codex o reintentar cuando se restablezca el cupo.'
    return data


def list_runs(project=None, kind='agent', limit=30, chat_id=None):
    folder = config.RUNS if kind == 'agent' else config.JOBS
    try: names = sorted((p.name for p in folder.iterdir() if p.is_dir()), reverse=True)
    except OSError: return []
    rows, since = [], 0
    if chat_id == 'main' and project and kind == 'agent':
        from . import chats
        since = chats.cleared_at(project)
    for name in names:
        meta = read_json(folder / name / 'meta.json', None)
        if not meta or (project and meta.get('project') != project): continue
        if chat_id is not None and meta.get('chat_id', 'main') != chat_id: continue
        # Los nombres son marcas de tiempo: lo anterior al vaciado del chat principal ya no se muestra.
        if since and meta.get('created_at', 0) <= since: break
        rows.append(meta)
        if limit and len(rows) >= limit: break
    return rows


def conversation(project, full_runs=6, limit=25, chat_id='main'):
    metas = list_runs(project, limit=limit, chat_id=chat_id)
    runs = [describe_run(meta, full=index < full_runs) for index, meta in enumerate(metas)]
    runs.reverse()
    return runs


def conversation_revision(project, chat_id='main'):
    parts = [chat_id]
    for path in (config.TASKS, config.SESSIONS_FILE, config.SETTINGS_FILE, config.RULES_FILE):
        try: parts.append(str(path.stat().st_mtime_ns))
        except OSError: parts.append('0')
    for meta in list_runs(project, limit=25, chat_id=chat_id):
        folder = config.RUNS / meta['id']
        for name in ('events.jsonl', 'exit.json', 'approvals', 'stop'):
            try: stat = (folder / name).stat(); parts.append(f'{stat.st_size}:{stat.st_mtime_ns}')
            except OSError: parts.append('-')
    return hashlib.sha1('|'.join(parts).encode()).hexdigest()[:16]


def active_runs():
    rows = []
    for task in tasks.task_records():
        if task['status'] != 'working' or not task.get('run_id'): continue
        meta = run_meta(task['run_id'])
        if meta: rows.append(meta)
    return rows


def all_pending_approvals():
    rows = []
    for meta in active_runs():
        rows.extend(pending_approvals(meta['id'], meta))
    return rows


# ---------------------------------------------------------------- trabajos (deploy)

@state_locked
def start_job(project, action):
    from . import lifecycle
    if lifecycle.deleting(project): return False, 'El proyecto se está eliminando', ''
    if action not in JOB_ACTIONS: return False, 'Acción inválida', ''
    project_dir = config.PROJECTS / project
    if not re.fullmatch(config.PROJECT_NAME, project) or project_dir.resolve().parent != config.PROJECTS.resolve():
        return False, 'Proyecto inválido', ''
    if action == 'down' and f'{config.HOST_PROJECTS}/{project}' == config.HOST_APP_DIR:
        return False, 'No se puede apagar el propio dashboard desde la web', ''
    if not any((project_dir / name).exists() for name in ('compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml')):
        return False, 'El proyecto no tiene compose.yaml', ''
    if action == 'dev' and not (project_dir / 'compose.dev.yaml').exists():
        return False, 'Este proyecto no tiene compose.dev.yaml (modo desarrollo)', ''
    for meta in list_runs(project, kind='job', limit=5):
        if not (config.JOBS / meta['id'] / 'exit.json').exists() and time.time() - meta.get('created_at', 0) < 3600:
            if tmux.has_session(f"cmj-{meta['id']}"):
                return False, 'Ya hay un despliegue en curso para este proyecto', meta['id']
    job_id = new_id()
    job_dir = config.JOBS / job_id
    job_dir.mkdir(parents=True, mode=0o700)
    argv, title = JOB_ACTIONS[action]
    meta = {'id': job_id, 'kind': 'job', 'project': project, 'action': action, 'title': title, 'argv': argv,
            'cwd': f'{config.HOST_PROJECTS}/{project}', 'created_at': time.time()}
    if action in ('deploy', 'dev', 'build'):
        # Lo que se publica queda como versión: el historial marca qué commit está en producción.
        from . import gitops
        version = gitops.record(project, f'Cambios pendientes antes de: {title.lower()}', 'pending', trailers={'Job': job_id})
        if version['head']: meta['commit'] = version['head']
    write_json(job_dir / 'meta.json', meta)
    ok, error = tmux.new_session(f'cmj-{job_id}', meta['cwd'], ['/usr/bin/python3', RUNNER, config.host_path(job_dir)])
    if not ok:
        write_json(job_dir / 'exit.json', {'code': 127, 'stopped': False, 'finished_at': time.time(), 'launch_error': error})
        return False, f'No se pudo iniciar: {error}', job_id
    changed()
    return True, f'{title}: en curso', job_id


def describe_job(meta, tail=12000):
    job_dir = config.JOBS / meta['id']
    exit_data = read_json(job_dir / 'exit.json', None)
    output = tail_text(job_dir / 'output.log', tail)
    status = 'running' if not exit_data else ('stopped' if exit_data.get('stopped') else 'done' if exit_data.get('code') == 0 else 'error')
    if exit_data and (exit_data.get('launch_error') or exit_data.get('lost')):
        output += '\n' + (exit_data.get('launch_error') or 'El proceso de despliegue terminó inesperadamente')
    return {'id': meta['id'], 'project': meta['project'], 'action': meta['action'], 'title': meta.get('title', meta['action']),
            'created_at': meta.get('created_at'), 'finished_at': (exit_data or {}).get('finished_at'), 'status': status,
            'code': (exit_data or {}).get('code'), 'output': output[-tail:], 'commit': meta.get('commit', '')}


def job_meta(job_id):
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[0-9a-f]{6}', str(job_id or '')): return None
    return read_json(config.JOBS / job_id / 'meta.json', None)


# ---------------------------------------------------------------- planificador

def _finalize(task, meta):
    """Pasa la petición a terminada/error según el resultado real de la ejecución."""
    run_id = meta['id']
    exit_data = exit_info(run_id)
    events, info = run_events(run_id, meta['provider'])
    status = run_status(meta, exit_data, info)
    result = (info.get('result') or {}).get('text', '').strip()
    if meta['provider'] == 'codex' and info.get('session_id'):
        set_agent_session(meta['project'], 'codex', info['session_id'], meta.get('chat_id', 'main'))
    if meta['provider'] == 'claude':
        problem = stderr_tail(run_id, 4000) + ' ' + result
        if 'No conversation found' in problem or (status == 'error' and not info.get('session_id')):
            # La sesión no llegó a existir (o se perdió): la próxima petición empieza una nueva.
            stored = chat_sessions(meta['project'], meta.get('chat_id', 'main')).get('claude', {}).get('id')
            if stored in (meta.get('resume_id'), meta.get('session_id')): set_agent_session(meta['project'], 'claude', '', meta.get('chat_id', 'main'))
    task['finished_at'] = now_text()
    if status == 'done':
        task['status'], task['result'] = 'terminado', clip(result or 'Completada', 600)
    elif status == 'stopped':
        task['status'], task['result'] = 'terminado', 'Detenida manualmente'
    else:
        detail = describe_run(meta, full=False).get('error') or result
        task['status'], task['result'] = 'error', clip(' '.join(str(detail or 'Error desconocido').split()), 600)


def tick():
    """Una vuelta del planificador: cierra ejecuciones terminadas y envía las pendientes.
    Se ejecuta cada QUEUE_TICK segundos o al instante cuando algo la despierta."""
    dirty = False
    # Los trabajos también necesitan reconciliación si tmux o el runner mueren.
    for meta in list_runs(kind='job', limit=None):
        folder = config.JOBS / meta['id']
        if (folder / 'exit.json').exists(): continue
        age = time.time() - meta.get('created_at', time.time())
        if age > 20 and not tmux.has_session(f"cmj-{meta['id']}"):
            write_json(folder / 'exit.json', {'code': -1, 'lost': True, 'finished_at': time.time()})
            dirty = True
        elif age > 3600 and not (folder / 'stop').exists():
            (folder / 'stop').write_text('timeout')
            dirty = True
    with tasks.LOCK:
        records = tasks.task_records()
        for task in records:
            if task['status'] != 'working': continue
            meta = run_meta(task.get('run_id'))
            if not meta:
                # Petición del sistema anterior (enviada por send-keys): ya no hay forma
                # fiable de saber si terminó, así que se libera el turno del proyecto.
                task.update({'status': 'error', 'finished_at': now_text(), 'result': 'Petición del sistema anterior sin seguimiento; vuelve a enviarla si hace falta'})
                dirty = True
                continue
            run_dir = config.RUNS / meta['id']
            if not (run_dir / 'exit.json').exists():
                age = time.time() - meta.get('created_at', time.time())
                if age > 20 and not tmux.has_session(f"cmr-{meta['id']}"):
                    write_json(run_dir / 'exit.json', {'code': -1, 'stopped': (run_dir / 'stop').exists(), 'lost': True, 'finished_at': time.time()})
                elif age > config.RUN_TIMEOUT_MINUTES * 60 and not (run_dir / 'stop').exists():
                    (run_dir / 'stop').write_text('timeout')
                    task['result'] = f'Superó el límite de {config.RUN_TIMEOUT_MINUTES} min; deteniendo'
                    dirty = True
            if (run_dir / 'exit.json').exists():
                _finalize(task, meta)
                dirty = True
        # Un chat atiende un mensaje a la vez aunque cambie de agente: el siguiente necesita el resultado anterior.
        busy = {(x['project'], x.get('chat_id', 'main')) for x in records if x['status'] == 'working'}
        dispatched = 0
        for task in tasks.pending_in_order(records):
            key = (task['project'], task.get('chat_id', 'main'))
            if key in busy: continue
            from . import lifecycle
            if lifecycle.deleting(task['project']): continue
            if not tmux.host_server_ok():
                AUTOMATION['last_message'] = tmux.server_error()
                break
            ok, message, run_id = start_run(task)
            task['run_id'] = run_id
            if ok:
                task.update({'status': 'working', 'started_at': now_text(), 'finished_at': '', 'result': message})
                busy.add(key); dispatched += 1
                AUTOMATION['last_dispatch'] = now_text()
            else:
                task.update({'status': 'error', 'finished_at': now_text(), 'result': message})
            AUTOMATION['last_message'] = message
            dirty = True
        if dirty: tasks.save_tasks(records)
        working = sum(1 for x in records if x['status'] == 'working')
        AUTOMATION['last_check'] = now_text()
        if not dispatched and AUTOMATION['last_message'] != tmux.server_error():
            AUTOMATION['last_message'] = (f'Los agentes están atendiendo {working} petición' + ('es' if working != 1 else '')) if working else 'Cola al día: no hay peticiones pendientes'
    if dirty:
        for callback in _change_hooks: callback()
    return dirty


def scheduler_loop():
    while True:
        WAKE.wait(config.QUEUE_TICK)
        WAKE.clear()
        try:
            tick()
        except Exception as error:
            AUTOMATION['last_message'] = f'Error al revisar la cola: {error}'
