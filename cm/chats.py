"""Persistent, project-scoped conversation catalog. Legacy history belongs to main."""
import secrets
import time
from . import config, tasks
from .util import now_text, read_json, write_json


def catalog():
    return read_json(config.CONFIG / 'chats.json', {})


def archive():
    # Chats eliminados y vaciados del principal: el historial de ejecuciones sigue en disco.
    return read_json(config.CONFIG / 'chats-archive.json', {})


def cleared_at(project):
    """Momento en que se vació el chat principal; sus ejecuciones anteriores no se muestran."""
    return max((row.get('deleted_at', 0) for row in archive().get(project, []) if row.get('id') == 'main'), default=0)


def list_chats(project):
    rows = [{'id': 'main', 'title': 'Chat principal', 'created_at': 0}, *catalog().get(project, [])]
    records = [t for t in tasks.task_records() if t['project'] == project]
    return [{**row, 'working': sum(t['status'] == 'working' and t.get('chat_id', 'main') == row['id'] for t in records),
             'queued': sum(t['status'] == 'espera' and t.get('chat_id', 'main') == row['id'] for t in records)} for row in rows]


def require(project, chat_id):
    if not isinstance(chat_id, str) or not any(c['id'] == chat_id for c in list_chats(project)):
        raise ValueError('Chat no encontrado en este proyecto')
    return chat_id


def create(project, title=''):
    # Use the same lock as queue insertion and project deletion.
    with tasks.LOCK:
        from . import lifecycle
        if lifecycle.deleting(project): raise ValueError('El proyecto se está eliminando')
        data = catalog()
        rows = data.setdefault(project, [])
        if len(rows) >= 100: raise ValueError('Máximo 100 chats adicionales por proyecto')
        row = {'id': secrets.token_hex(8), 'title': str(title or f'Chat {len(rows) + 2}').strip()[:100], 'created_at': time.time()}
        if not row['title']: raise ValueError('Escribe un nombre para el chat')
        rows.append(row)
        write_json(config.CONFIG / 'chats.json', data)
        return row


def rename(project, chat_id, title):
    with tasks.LOCK:
        require(project, chat_id)
        if chat_id == 'main': raise ValueError('El chat principal conserva su nombre')
        title = str(title or '').strip()[:100]
        if not title: raise ValueError('Escribe un nombre para el chat')
        data = catalog()
        for row in data[project]:
            if row['id'] == chat_id: row['title'] = title
        write_json(config.CONFIG / 'chats.json', data)


def delete(project, chat_id):
    """Elimina un chat adicional o vacía el principal. Cancela su cola y olvida sus contextos;
    los archivos del proyecto y las ejecuciones en disco no se tocan."""
    from . import runs
    with tasks.LOCK, runs.STATE_LOCK:
        require(project, chat_id)
        records = tasks.task_records()
        mine = [t for t in records if t['project'] == project and t.get('chat_id', 'main') == chat_id]
        if any(t['status'] == 'working' for t in mine): raise ValueError('Detén la petición en curso antes de eliminar este chat')
        queued = [t for t in mine if t['status'] == 'espera']
        for task in queued: task.update(status='error', finished_at=now_text(), result='Cancelada al eliminar el chat')
        if queued: tasks.save_tasks(records)
        sessions = runs.agent_sessions()
        bucket = sessions.get(project, {})
        if chat_id == 'main':
            previous = {key: bucket.pop(key) for key in [*config.PROVIDERS, '_reset_at'] if key in bucket}
        else:
            previous = bucket.get('_chats', {}).pop(chat_id, {})
        write_json(config.SESSIONS_FILE, sessions)
        data = catalog()
        row = next((c for c in data.get(project, []) if c['id'] == chat_id), {'id': 'main', 'title': 'Chat principal', 'created_at': 0})
        stored = archive()
        stored.setdefault(project, []).append({**row, 'deleted_at': time.time(), 'sessions': previous, 'cancelled': len(queued)})
        write_json(config.CONFIG / 'chats-archive.json', stored)
        if chat_id != 'main':
            data[project] = [c for c in data[project] if c['id'] != chat_id]
            write_json(config.CONFIG / 'chats.json', data)
    runs.changed()
    return 'Chat principal vaciado: empieza de cero' if chat_id == 'main' else f'Chat «{row["title"]}» eliminado'
