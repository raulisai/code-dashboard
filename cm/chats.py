"""Persistent, project-scoped conversation catalog. Legacy history belongs to main."""
import secrets
import time
from . import config, tasks
from .util import read_json, write_json


def catalog():
    return read_json(config.CONFIG / 'chats.json', {})


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
