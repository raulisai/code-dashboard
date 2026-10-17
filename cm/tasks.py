"""Cola de peticiones (`tasks.tsv`).

Se conserva el formato TSV para seguir siendo compatible con `codex-task` y con
la cola existente. Los saltos de línea y tabuladores se guardan escapados (\\n,
\\t): antes se aplanaban a espacios y un mensaje con código llegaba roto al agente.
"""
import os, tempfile, threading, time
from . import config

LOCK = threading.RLock()
FIELDS = ('id', 'status', 'provider', 'project', 'priority', 'date', 'title', 'details', 'started_at', 'finished_at', 'result', 'run_id', 'origin', 'chat_id')
LEGACY_STATUS = {'pendiente': 'espera', 'enviada': 'working', 'en_progreso': 'working', 'completada': 'terminado'}
PRIORITY_ORDER = {'alta': 0, 'media': 1, 'baja': 2}
STATUSES = ('espera', 'working', 'terminado', 'error')


def encode(value):
    return str(value or '').replace('\\', '\\\\').replace('\t', '\\t').replace('\r', '').replace('\n', '\\n')


def decode(value):
    out, index = [], 0
    while index < len(value):
        char = value[index]
        if char == '\\' and index + 1 < len(value):
            out.append({'n': '\n', 't': '\t', '\\': '\\'}.get(value[index + 1], '\\' + value[index + 1]))
            index += 2
        else:
            out.append(char); index += 1
    return ''.join(out)


def _rows():
    try: text = config.TASKS.read_text()
    except OSError: return []
    return [line.split('\t') for line in text.splitlines() if line and not line.startswith('#')]


def task_records():
    records = []
    for n, row in enumerate(_rows(), 1):
        if len(row) >= 8:
            # Las filas antiguas no escapaban las barras: no convertir un literal
            # como C:\\new ni un ejemplo de código en saltos de línea.
            values = [decode(x) if len(row) >= 13 else x for x in row[:len(FIELDS)]]
            record = dict(zip(FIELDS, values + [''] * (len(FIELDS) - len(values))))
        elif len(row) >= 5:
            # Formato antiguo de `codex-task add`: estado, proyecto, prioridad, fecha, descripción.
            record = dict.fromkeys(FIELDS, '')
            record.update({'id': str(n), 'status': row[0], 'provider': 'codex', 'project': row[1], 'priority': row[2], 'date': row[3], 'title': row[4]})
        else:
            continue
        record['chat_id'] = record.get('chat_id') or 'main'
        record['status'] = LEGACY_STATUS.get(record['status'], record['status'])
        records.append(record)
    return records


def save_tasks(records):
    config.TASKS.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.tasks-', dir=config.TASKS.parent, text=True)
    try:
        with os.fdopen(fd, 'w') as handle:
            for record in records:
                handle.write('\t'.join(encode(record.get(key, '')) for key in FIELDS) + '\n')
        os.chmod(tmp, 0o600)
        os.replace(tmp, config.TASKS)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def new_task(project, provider, title, details='', priority='media', origin='task', chat_id='main'):
    title = ' '.join(str(title or '').split())[:200]
    return {'id': str(time.time_ns()), 'status': 'espera', 'provider': provider, 'project': project, 'priority': priority if priority in PRIORITY_ORDER else 'media',
            'date': time.strftime('%Y-%m-%d'), 'title': title, 'details': str(details or '').strip(), 'started_at': '', 'finished_at': '', 'result': '',
            'run_id': '', 'origin': origin, 'chat_id': chat_id}


def task_prompt(task):
    """Texto que recibe el agente. Un mensaje de chat va tal cual; una petición de la
    cola lleva el título como instrucción y los detalles como contexto."""
    if task.get('origin') in ('chat', 'create') and task.get('details'):
        return task['details']
    details = str(task.get('details') or '').strip()
    return f"{task['title']}\n\n{details}" if details else task['title']


def pending_in_order(records):
    # sorted() es estable: entre peticiones de la misma prioridad se respeta el orden de llegada.
    return sorted((x for x in records if x['status'] == 'espera'), key=lambda x: PRIORITY_ORDER.get(x['priority'], 1))
