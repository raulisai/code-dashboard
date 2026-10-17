"""Baja de proyectos mediante trabajo del host y papelera recuperable."""
import re
import time
from pathlib import Path
from . import config, dockerapi, runs, tasks, tmux
from .util import read_json, write_json

ID = r'[0-9]{8}-[0-9]{6}-[0-9a-f]{6}'


def root_for(name):
    if not re.fullmatch(config.PROJECT_NAME, str(name or '')): raise ValueError('Proyecto inválido')
    if name.startswith(config.INTERNAL_SESSION_PREFIXES): raise ValueError('Nombre reservado del sistema')
    path = config.PROJECTS / name
    if path.is_symlink() or path.resolve().parent != config.PROJECTS.resolve() or not path.is_dir(): raise ValueError('Proyecto inválido')
    if config.host_path(path) == config.HOST_APP_DIR: raise ValueError('No se puede eliminar el propio dashboard')
    return path


def operation(name):
    if not re.fullmatch(config.PROJECT_NAME, str(name or '')): return None
    return read_json(config.CONFIG / 'project-operations' / f'{name}.json', None)


def deleting(name):
    meta = operation(name)
    return bool(meta and not (config.JOBS / meta['job_id'] / 'exit.json').exists())


def preview(name):
    root_for(name)
    working = [t for t in tasks.task_records() if t['project'] == name and t['status'] == 'working']
    jobs = [m for m in runs.list_runs(name, kind='job', limit=None) if not (config.JOBS / m['id'] / 'exit.json').exists()]
    containers = dockerapi.project_containers(name)
    if any(dockerapi.is_self_container(c) for c in containers): raise ValueError('No se puede eliminar el propio dashboard')
    return {'project': name, 'containers': [dockerapi.container_name(c) for c in containers],
            'container_ids': [c['Id'] for c in containers], 'busy': bool(working or jobs or deleting(name)),
            'queued': sum(t['project'] == name and t['status'] == 'espera' for t in tasks.task_records()),
            'recoverable': True, 'volumes_preserved': True}


def start_delete(name, confirmation):
    if confirmation != name: return False, 'Escribe el nombre exacto del proyecto para confirmar', ''
    with tasks.LOCK, runs.STATE_LOCK:
        try: details = preview(name)
        except (ValueError, OSError) as error: return False, str(error), ''
        except Exception: return False, 'No se pudo comprobar Docker. Reintenta antes de eliminar.', ''
        if details['busy']: return False, 'Detén los agentes y espera a que terminen los despliegues antes de eliminar el proyecto', ''
        job_id = runs.new_id(); folder = config.JOBS / job_id
        folder.mkdir(parents=True, mode=0o700)
        records = tasks.task_records()
        from . import chats
        recovery = {'sessions': runs.agent_sessions().get(name, {}), 'chats': chats.catalog().get(name, []), 'rules': runs.approval_rules(name),
                    'tasks': [t for t in records if t['project'] == name]}
        meta = {'id': job_id, 'kind': 'job', 'project': name, 'action': 'delete-project', 'title': 'Eliminar proyecto',
                'cwd': f'{config.HOST_PROJECTS}/{name}', 'projects_root': config.HOST_PROJECTS, 'created_at': time.time(),
                'container_ids': details['container_ids'], 'recovery': recovery,
                'argv': ['/usr/bin/python3', f'{config.HOST_APP_DIR}/bin/cm-project-delete.py', config.host_path(folder)]}
        write_json(folder / 'meta.json', meta)
        write_json(config.CONFIG / 'project-operations' / f'{name}.json', {'job_id': job_id, 'created_at': meta['created_at']})
        ok, error = tmux.new_session(f'cmj-{job_id}', meta['cwd'], ['/usr/bin/python3', runs.RUNNER, config.host_path(folder)])
        if not ok:
            write_json(folder / 'exit.json', {'code': 127, 'finished_at': time.time(), 'launch_error': error})
            return False, f'No se pudo iniciar la eliminación: {error}', job_id
        for task in records:
            if task['project'] == name and task['status'] == 'espera':
                task.update(status='error', finished_at=runs.now_text(), result='Cancelada al eliminar el proyecto')
        tasks.save_tasks(records)
        sessions = runs.agent_sessions(); sessions.pop(name, None); write_json(config.SESSIONS_FILE, sessions)
        catalog = chats.catalog(); catalog.pop(name, None); write_json(config.CONFIG / 'chats.json', catalog)
        # Un proyecto nuevo con el mismo nombre no hereda permisos del anterior.
        rules = read_json(config.RULES_FILE, {}); rules.pop(name, None); write_json(config.RULES_FILE, rules)
    runs.changed()
    return True, 'Eliminando el proyecto. Sus archivos quedarán en la papelera.', job_id


def trash():
    folder = config.PROJECTS / '.cm-trash'
    if folder.is_symlink(): return []
    rows = []
    for path in sorted(folder.glob('*/meta.json'), reverse=True):
        if not re.fullmatch(ID, path.parent.name) or path.parent.is_symlink(): continue
        meta = read_json(path, {})
        if not re.fullmatch(config.PROJECT_NAME, str(meta.get('project', ''))) or not (path.parent / 'project').is_dir(): continue
        rows.append({'id': path.parent.name, 'project': meta['project'], 'deleted_at': meta.get('deleted_at'), 'volumes_preserved': True})
    return rows


def restore(archive_id):
    if not re.fullmatch(ID, str(archive_id or '')): return False, 'Archivo de papelera inválido'
    with tasks.LOCK, runs.STATE_LOCK:
        folder = config.PROJECTS / '.cm-trash' / archive_id
        if folder.is_symlink() or (config.PROJECTS / '.cm-trash').is_symlink(): return False, 'Ruta de papelera inválida'
        meta = read_json(folder / 'meta.json', {})
        name = meta.get('project', '')
        if not re.fullmatch(config.PROJECT_NAME, str(name)): return False, 'Proyecto archivado inválido'
        target = config.PROJECTS / name
        if target.exists() or target.is_symlink(): return False, 'Ya existe un proyecto con ese nombre'
        source = folder / 'project'
        if source.is_symlink() or not source.is_dir(): return False, 'No se encuentran los archivos del proyecto'
        source.rename(target)
        # Recuperar nombres/historial, nunca reanudar agentes ni permisos antiguos.
        from . import chats
        recovered = meta.get('recovery', {}).get('chats', [])
        if recovered:
            catalog = chats.catalog(); catalog[name] = recovered; write_json(config.CONFIG / 'chats.json', catalog)
        meta['restored_at'] = time.time(); write_json(folder / 'meta.json', meta)
    runs.changed()
    return True, f'{name} restaurado. Puedes desplegarlo de nuevo cuando quieras.'
