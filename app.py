#!/usr/bin/env python3
"""Codex Manager: entorno web para desarrollar proyectos del VPS con Claude Code y Codex.

Servidor aiohttp (HTTP + WebSocket). La lógica vive en el paquete `cm`; aquí solo
están las rutas, la autenticación y la terminal web.
"""
import asyncio, fcntl, json, mimetypes, os, re, signal, struct, subprocess, termios, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from aiohttp import web, WSMsgType

from cm import auth, chats, config, dockerapi, files, gitops, lifecycle, media, projects, push, quota, repos, runs, speech, tasks, tmux, websecurity, terminal as terminalio

EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix='cm-io')
PUBLIC_API = {'/api/login', '/api/login/mfa', '/api/logout'}
SETUP_API = {'/api/me', '/api/security', '/api/security/setup', '/api/security/confirm'}
PRIORITIES = ('alta', 'media', 'baja')
runs.on_change(projects.invalidate)
dockerapi.on_change(projects.invalidate)


async def blocking(func, *args, **kwargs):
    return await asyncio.get_running_loop().run_in_executor(EXECUTOR, lambda: func(*args, **kwargs))


def reply(data, status=200):
    return web.json_response(data, status=status, headers={'Cache-Control': 'no-store'}, dumps=lambda value: json.dumps(value, ensure_ascii=False))


def fail(message, status=400):
    return reply({'message': message}, status)


def client_ip(request):
    return websecurity.client_ip(request)


def same_origin(request):
    """Las acciones que cambian algo deben venir de la propia web. Importante porque
    todos los proyectos viven en *.devdj.lat: para el navegador son el mismo sitio."""
    origin = request.headers.get('Origin')
    if not origin: return request.path != '/api/term'
    return origin == websecurity.expected_origin(request)


def session_cookie(response, session):
    response.set_cookie(auth.COOKIE, session['token'],
                        max_age=max(0, int(session['expires'] - time.time())) if session['remember'] else None,
                        httponly=True, secure=True, samesite='Strict', path='/')
    response.del_cookie(auth.OLD_COOKIE, path='/')
    return response


@web.middleware
async def security(request, handler):
    path = request.path
    session = None
    try:
        if path.startswith('/api/'):
            if request.method not in ('GET', 'HEAD', 'OPTIONS') or path == '/api/term':
                if not same_origin(request): return fail('Origen no permitido', 403)
            if path not in PUBLIC_API:
                session = await blocking(auth.authenticate, request.cookies.get(auth.COOKIE), path != '/api/term')
                if not session:
                    return fail('Sesión expirada: inicia sesión de nuevo', 401)
                request[websecurity.SESSION_KEY] = session
                if not session['mfa'] and path not in SETUP_API:
                    return reply({'message': 'Configura tu autenticador para continuar', 'setup_required': True}, 403)
        response = await handler(request)
    except auth.AuthError as error:
        if error.status in (400, 401): await asyncio.sleep(0.5)
        response = fail(str(error), error.status)
    if session and session['token'] and not response.prepared and auth.COOKIE not in response.cookies:
        session_cookie(response, session)
    if path.startswith('/api/'): response.headers.setdefault('Cache-Control', 'no-store')
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    return response


def agent_project(value):
    # Las rutas del chat aceptan además el agente general (esfera central), que no es una carpeta de proyecto.
    return config.GENERAL if value == config.GENERAL else project_param(value)


def project_param(value):
    name = str(value or '')
    if name not in projects.project_names(): raise web.HTTPBadRequest(text=json.dumps({'message': 'Proyecto inválido'}), content_type='application/json')
    if lifecycle.deleting(name): raise web.HTTPConflict(text=json.dumps({'message': 'El proyecto se está eliminando'}), content_type='application/json')
    return name


async def body(request):
    if request.content_type != 'application/json':
        raise web.HTTPUnsupportedMediaType(reason='Se requiere JSON')
    limit = 4096 if request.path.startswith(('/api/login', '/api/security')) else 6 * 1024 * 1024
    if request.content_length and request.content_length > limit:
        raise web.HTTPRequestEntityTooLarge(max_size=limit, actual_size=request.content_length)
    raw = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        raw.extend(chunk)
        if len(raw) > limit: raise web.HTTPRequestEntityTooLarge(max_size=limit, actual_size=len(raw))
    try: data = json.loads(raw)
    except Exception: raise web.HTTPBadRequest(text=json.dumps({'message': 'JSON inválido'}), content_type='application/json')
    if not isinstance(data, dict): raise web.HTTPBadRequest(text=json.dumps({'message': 'JSON inválido'}), content_type='application/json')
    return data


# ---------------------------------------------------------------- sesión

async def login(request):
    data = await body(request)
    result = await blocking(auth.begin_login, data.get('user'), data.get('password'), client_ip(request),
                            request.headers.get('User-Agent', ''), data.get('remember') is True)
    if result.get('mfa_required'): return reply(result)
    return session_cookie(reply({'ok': True, 'user': config.USER, 'setup_required': True}), result)


async def login_mfa(request):
    data = await body(request)
    result = await blocking(auth.finish_login, data.get('challenge'), data.get('code'), client_ip(request), request.headers.get('User-Agent', ''))
    return session_cookie(reply({'ok': True, 'user': config.USER}), result)


async def logout(request):
    await blocking(auth.revoke_token, request.cookies.get(auth.COOKIE))
    response = reply({'ok': True})
    response.del_cookie(auth.COOKIE, path='/', secure=True, httponly=True, samesite='Strict')
    response.del_cookie(auth.OLD_COOKIE, path='/')
    return response


async def me(request):
    return reply({'ok': True, 'user': config.USER, 'setup_required': not request[websecurity.SESSION_KEY]['mfa']})


async def security_get(request):
    return reply(await blocking(auth.security_status, request[websecurity.SESSION_KEY]['id']))


async def security_setup(request):
    data = await body(request)
    return reply(await blocking(auth.begin_setup, request[websecurity.SESSION_KEY]['id'], data.get('password'), data.get('code'), client_ip(request)))


async def security_confirm(request):
    data = await body(request)
    result = await blocking(auth.confirm_setup, request[websecurity.SESSION_KEY]['id'], data.get('code'), client_ip(request), data.get('remember') is True)
    return session_cookie(reply({'ok': True, 'recovery_codes': result['recovery_codes']}), result)


async def security_recovery(request):
    data = await body(request)
    return reply(await blocking(auth.regenerate_recovery, request[websecurity.SESSION_KEY]['id'], data.get('password'), data.get('code'), client_ip(request)))


async def security_revoke(request):
    data = await body(request)
    await blocking(auth.revoke_sessions, request[websecurity.SESSION_KEY]['id'], data.get('id'))
    return reply({'ok': True})


# ---------------------------------------------------------------- estado

async def state(request):
    return reply(await blocking(projects.snapshot))


async def settings_get(request):
    return reply({'settings': runs.load_settings(), 'stacks': {k: v[0] for k, v in projects.STACKS.items()}})


async def settings_post(request):
    ok, message = await blocking(runs.save_settings, await body(request))
    projects.invalidate()
    return reply({'message': message, 'settings': runs.load_settings()}, 200 if ok else 400)


async def push_get(request):
    return reply({'public_key': await blocking(push.public_key)})


async def push_post(request):
    data = await body(request)
    try:
        if data.get('action') == 'unsubscribe':
            await blocking(push.unsubscribe, data.get('endpoint', ''))
            return reply({'message': 'Avisos desactivados en este dispositivo'})
        await blocking(push.public_key)
        await blocking(push.subscribe, data.get('subscription'), request[websecurity.SESSION_KEY]['id'])
    except (ValueError, TypeError): return fail('Suscripción de notificaciones inválida')
    return reply({'message': 'Avisos activados en este dispositivo'})


# ---------------------------------------------------------------- agente

def add_task(project, provider, title, details, priority='media', origin='task', chat_id='main', model='', effort=''):
    task = tasks.new_task(project, provider, title, details, priority, origin, chat_id, model, effort)
    with tasks.LOCK:
        chats.require(project, chat_id)
        if lifecycle.deleting(project) or (project != config.GENERAL and project not in projects.project_names()):
            raise web.HTTPConflict(text=json.dumps({'message': 'El proyecto ya no está disponible para nuevas peticiones'}), content_type='application/json')
        records = tasks.task_records()
        records.append(task)
        tasks.save_tasks(records)
    runs.changed()
    return task


async def agent_get(request):
    project = agent_project(request.query.get('project'))
    try: chat_id = await blocking(chats.require, project, request.query.get('chat_id', 'main'))
    except ValueError as exc: return fail(str(exc), 404)
    rev = await blocking(runs.conversation_revision, project, chat_id)
    if request.query.get('rev') == rev: return reply({'same': True, 'rev': rev})
    def build():
        task_rows = [t for t in tasks.task_records() if t['project'] == project and t.get('chat_id', 'main') == chat_id]
        return {'rev': rev, 'runs': runs.conversation(project, full_runs=1 if project == config.GENERAL else 6, chat_id=chat_id), 'queue': [t for t in task_rows if t['status'] == 'espera'],
                'working': [t for t in task_rows if t['status'] == 'working'],
                'sessions': {k: v.get('id') for k, v in runs.chat_sessions(project, chat_id).items()},
                'rules': runs.approval_rules(project), 'settings': runs.load_settings()}
    return reply(await blocking(build))


async def models_get(request):
    from cm import modelcatalog
    return reply(await blocking(modelcatalog.catalog))


async def agent_send(request):
    data = await body(request)
    project = agent_project(data.get('project'))
    provider = str(data.get('provider') or runs.load_settings()['default_provider'])
    text = str(data.get('text') or '').strip()
    if provider not in config.PROVIDERS: return fail('Agente inválido')
    if not text: return fail('Escribe un mensaje')
    if len(text) > 100_000: return fail('El mensaje es demasiado largo (máx. 100 000 caracteres)')
    model = data.get('model', '')
    if not isinstance(model, str) or (model and not re.fullmatch(r'[A-Za-z0-9._:\[\]-]{1,80}', model)):
        return fail('Modelo inválido (máximo 80 caracteres, sin espacios)')
    if project == config.GENERAL and model: return fail('El agente general usa el modelo de Ajustes')
    from cm import modelcatalog
    effort = data.get('effort', '')
    if not isinstance(effort, str) or (effort and effort not in modelcatalog.supported_efforts(provider, model)):
        return fail('Esfuerzo no compatible con el modelo seleccionado')
    if project == config.GENERAL and effort: return fail('El agente general usa el esfuerzo predeterminado')
    if project == config.GENERAL:
        from cm import availability
        provider = availability.choose(provider) or provider
    priority = data.get('priority') if data.get('priority') in PRIORITIES else 'media'
    title = text.splitlines()[0][:200]
    try: task = await blocking(add_task, project, provider, title, text, priority, 'chat', data.get('chat_id', 'main'), model, effort)
    except ValueError as exc: return fail(str(exc), 404)
    return reply({'message': f'Enviado a {runs.label(provider)}', 'task': task}, 201)


async def agent_reset(request):
    data = await body(request)
    project = agent_project(data.get('project'))
    try: chat_id = await blocking(chats.require, project, data.get('chat_id', 'main'))
    except ValueError as exc: return fail(str(exc), 404)
    ok, message = await blocking(runs.reset_conversation, project, str(data.get('provider')), chat_id)
    return reply({'message': message}, 200 if ok else 400)


async def chats_get(request):
    project = agent_project(request.query.get('project'))
    return reply({'chats': await blocking(chats.list_chats, project)})


async def chats_post(request):
    data = await body(request)
    project = agent_project(data.get('project'))
    if data.get('action', 'create') not in ('create', 'rename', 'delete'): return fail('Acción de chat inválida')
    try:
        if data.get('action') == 'delete':
            return reply({'message': await blocking(chats.delete, project, data.get('chat_id'))})
        if data.get('action') == 'rename':
            await blocking(chats.rename, project, data.get('chat_id'), data.get('title'))
            return reply({'message': 'Nombre del chat actualizado'})
        chat = await blocking(chats.create, project, data.get('title'))
    except ValueError as exc: return fail(str(exc))
    return reply({'chat': chat}, 201)


async def run_get(request):
    meta = runs.run_meta(request.match_info['run_id'])
    if not meta: return fail('Ejecución no encontrada', 404)
    def build():
        data = runs.describe_run(meta)
        data['stderr'] = runs.stderr_tail(meta['id'])
        return data
    return reply(await blocking(build))


async def run_stop(request):
    ok, message = await blocking(runs.request_stop, request.match_info['run_id'])
    return reply({'message': message}, 200 if ok else 409)


async def approval_post(request):
    data = await body(request)
    ok, message = await blocking(runs.answer_approval, str(data.get('run_id')), str(data.get('request_id')), str(data.get('decision')),
                                 bool(data.get('remember')), str(data.get('message') or ''))
    return reply({'message': message}, 200 if ok else 409)


async def rules_post(request):
    data = await body(request)
    project = project_param(data.get('project'))
    ok, message = await blocking(runs.remove_rule, project, str(data.get('rule')))
    return reply({'message': message, 'rules': runs.approval_rules(project)}, 200 if ok else 400)


# ---------------------------------------------------------------- cola (compatibilidad con la API anterior)

def task_action(data):
    action = data.get('action')
    with tasks.LOCK:
        records = tasks.task_records()
        task = next((x for x in records if x['id'] == str(data.get('id'))), None)
        if action in ('delete', 'status', 'dispatch', 'stop', 'retry') and not task: return 404, 'Petición no encontrada'
        if action == 'delete':
            if task['status'] == 'working': return 409, 'Detén la petición antes de eliminarla'
            tasks.save_tasks([x for x in records if x['id'] != task['id']])
            return 200, 'Petición eliminada'
        if action == 'stop':
            if task['status'] != 'working': return 409, 'Esa petición no está en ejecución'
            if not task.get('run_id'):
                task.update({'status': 'terminado', 'finished_at': runs.now_text(), 'result': 'Detenida manualmente'})
                tasks.save_tasks(records); return 200, 'Petición detenida'
            ok, message = runs.request_stop(task['run_id'])
            return (200 if ok else 409), message
        if action in ('retry', 'status') and (action == 'retry' or data.get('status') == 'espera'):
            if task['status'] == 'working': return 409, 'La petición está en ejecución'
            task.update({'providers_tried': '', 'status': 'espera', 'started_at': '', 'finished_at': '', 'result': '', 'run_id': ''})
            tasks.save_tasks(records); runs.WAKE.set()
            return 200, 'Petición devuelta a la cola'
        if action == 'status':
            if data.get('status') != 'terminado' or task['status'] == 'working': return 400, 'Estado inválido'
            task.update({'status': 'terminado', 'finished_at': runs.now_text(), 'result': task.get('result') or 'Marcada como terminada'})
            tasks.save_tasks(records); return 200, 'Estado actualizado'
        if action == 'dispatch':
            # Ya no hace falta forzar el envío: el planificador despacha al instante si el
            # agente del proyecto está libre. Se sube la prioridad para que salga primero.
            if task['status'] != 'espera': return 409, 'La petición ya no está en espera'
            task['priority'] = 'alta'; tasks.save_tasks(records); runs.WAKE.set()
            return 200, 'Petición priorizada: sale en cuanto el agente quede libre'
    required = ('provider', 'project', 'title')
    if any(not str(data.get(k, '')).strip() for k in required) or data['provider'] not in config.PROVIDERS:
        return 400, 'Faltan datos o agente inválido'
    if data['project'] not in projects.project_names(): return 400, 'Proyecto inexistente'
    add_task(data['project'], data['provider'], data['title'], data.get('details', ''), data.get('priority', 'media'), 'task')
    return 201, 'Petición añadida a la cola'


async def tasks_post(request):
    status, message = await blocking(task_action, await body(request))
    runs.changed()
    return reply({'message': message}, status)


# ---------------------------------------------------------------- proyectos, docker y despliegues

async def projects_post(request):
    data = await body(request)
    action = data.get('action')
    if action == 'restore':
        ok, message = await blocking(lifecycle.restore, str(data.get('archive_id', '')))
        projects.invalidate()
        return reply({'message': message}, 200 if ok else 409)
    if action == 'delete':
        ok, message, job_id = await blocking(lifecycle.start_delete, str(data.get('name', '')), str(data.get('confirmation', '')))
        projects.invalidate()
        return reply({'message': message, 'job_id': job_id}, 202 if ok else 409)
    if action == 'create':
        name = str(data.get('name', '')).strip().lower()
        description = str(data.get('description', '')).strip()[:4000]
        stack = str(data.get('stack') or 'auto')
        provider = str(data.get('provider') or runs.load_settings()['default_provider'])
        if provider not in config.PROVIDERS: return fail('Agente inválido')
        repo_url = str(data.get('repo_url') or '').strip()
        if repo_url:
            branch = str(data.get('repo_branch') or '').strip()
            ok, message, info = await blocking(projects.import_project, name, repo_url, branch, description)
            if not ok: return fail(message)
            notes = [message]
            if not info['empty']:
                # Un repo con código no se despliega a ciegas (puertos, nombres de router): lo adapta el agente.
                if data.get('build', True):
                    await blocking(add_task, name, provider, f'Adaptar y publicar el repo importado {info["repo"]}'[:200],
                                   projects.import_prompt(name, info['url'], info['branch'], description), 'alta', 'create')
                    notes.append(f'{runs.label(provider)} lo está adaptando para publicarlo')
                return reply({'message': ' · '.join(notes), 'project': name, 'repo': info}, 201)
        else:
            ok, message = await blocking(projects.create_project, name, description, stack)
            if not ok: return fail(message)
            notes = [message]
            if data.get('github'):
                notes.append((await blocking(projects.publish_github, name, description))[1])
        if data.get('deploy', True):
            deployed, deploy_message, _ = await blocking(runs.start_job, name, 'deploy')
            notes.append('Desplegando la primera versión…' if deployed else deploy_message)
        if description and data.get('build', True):
            await blocking(add_task, name, provider, f'Construir: {description.splitlines()[0][:150]}', projects.build_prompt(name, description, stack), 'alta', 'create')
            notes.append(f'{runs.label(provider)} empezó a construirlo')
        return reply({'message': ' · '.join(notes), 'project': name}, 201)
    name = project_param(data.get('name'))
    if action == 'toggle_featured':
        return reply({'message': await blocking(projects.toggle_featured, name)})
    return fail('Acción inválida')


async def repo_check(request):
    data = await body(request)
    try: return reply(await blocking(repos.check, data.get('url')))
    except repos.RepoError as error: return fail(str(error), 422)


async def quota_get(request):
    return reply(await blocking(quota.read, request.query.get('refresh') == '1'))


async def github_get(request):
    return reply(await blocking(repos.github_status))


async def github_post(request):
    data = await body(request)
    try:
        if data.get('action') == 'disconnect': return reply({**await blocking(repos.github_disconnect), 'message': 'GitHub desconectado'})
        status = await blocking(repos.github_connect, data.get('token'))
        return reply({**status, 'message': f'GitHub conectado como {status["login"]}'})
    except repos.RepoError as error: return fail(str(error), 422)


async def project_delete_preview(request):
    try: return reply(await blocking(lifecycle.preview, str(request.query.get('project', ''))))
    except ValueError as error: return fail(str(error), 409)
    except Exception: return fail('No se pudo comprobar el estado del proyecto', 503)


async def project_trash(request):
    return reply({'projects': await blocking(lifecycle.trash)})


async def docker_post(request):
    data = await body(request)
    project = project_param(data.get('project'))
    ok, message = await blocking(dockerapi.docker_action, project, str(data.get('action', '')), str(data.get('container', '') or ''))
    return reply({'message': message}, 200 if ok else 409)


async def logs_get(request):
    project = project_param(request.query.get('project'))
    try: entries = await blocking(dockerapi.project_logs, project, request.query.get('container', ''), request.query.get('tail', '200'))
    except LookupError as error: return fail(str(error), 404)
    except Exception as error: return fail(f'No se pudieron leer los logs: {error}', 502)
    return reply({'entries': entries})


async def jobs_get(request):
    project = project_param(request.query.get('project'))
    return reply({'jobs': await blocking(lambda: [runs.describe_job(m, tail=4000) for m in runs.list_runs(project, kind='job', limit=8)])})


async def job_get(request):
    meta = runs.job_meta(request.match_info['job_id'])
    if not meta: return fail('Trabajo no encontrado', 404)
    return reply(await blocking(runs.describe_job, meta, 60000))


async def jobs_post(request):
    data = await body(request)
    project = project_param(data.get('project'))
    ok, message, job_id = await blocking(runs.start_job, project, str(data.get('action')))
    return reply({'message': message, 'job_id': job_id}, 201 if ok else 409)


# ---------------------------------------------------------------- archivos y git

def files_call(func, *args):
    try: return func(*args), None
    except files.FileError as error: return None, str(error)
    except FileNotFoundError: return None, 'No existe'
    except FileExistsError: return None, 'Ya existe'
    except (IsADirectoryError, NotADirectoryError): return None, 'Tipo de archivo inválido para esta acción'
    except PermissionError: return None, 'Sin permisos sobre ese archivo'
    except OSError as error: return None, str(error)


async def files_list(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(files_call, files.list_dir, project, request.query.get('path', ''))
    return reply(result) if error is None else fail(error, 404)


async def files_read(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(files_call, files.read_file, project, request.query.get('path', ''))
    return reply(result) if error is None else fail(error, 404)


async def files_raw(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(files_call, files.resolve, project, request.query.get('path', ''))
    if error is not None or not result[1].is_file(): return fail(error or 'No es un archivo', 404)
    path = result[1]
    content_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    if not content_type.startswith(('image/', 'video/', 'audio/')) and content_type != 'application/pdf':
        content_type = 'text/plain; charset=utf-8'
    # sandbox: un SVG o HTML del proyecto no puede ejecutar scripts con la sesión del panel.
    return web.FileResponse(path, headers={'Content-Type': content_type, 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
                                           'Cache-Control': 'no-store'})


async def media_get(request):
    # Imágenes que el agente general guarda para la interfaz viva; sandbox igual que /api/files/raw.
    found = await blocking(media.read, request.match_info.get('name', ''))
    if not found: return fail('Imagen no encontrada', 404)
    content_type, data = found
    return web.Response(body=data, headers={'Content-Type': content_type, 'Cache-Control': 'private, max-age=300',
                                            'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"})


async def files_write(request):
    data = await body(request)
    project = project_param(data.get('project'))
    if not isinstance(data.get('content'), str): return fail('Contenido inválido')
    write = lambda: files.write_file(project, data.get('path'), data['content'], data.get('mtime'))
    result, error = await blocking(files_call, gitops.versioned, project, f'Editar {clean_path(data.get("path"))}', 'edit', write)
    return reply({'message': 'Guardado', **result}) if error is None else fail(error, 409)


async def files_op(request):
    data = await body(request)
    project = project_param(data.get('project'))
    action, path = str(data.get('action')), clean_path(data.get('path'))
    subject = {'mkdir': f'Crear carpeta {path}', 'create': f'Crear archivo {path}', 'delete': f'Eliminar {path}',
               'rename': f'Mover {path} → {clean_path(data.get("to"))}'}.get(action, f'Archivos: {action}')
    operate = lambda: files.operate(project, action, data.get('path'), data.get('to', ''))
    result, error = await blocking(files_call, gitops.versioned, project, subject, 'files', operate)
    return reply({'message': result}) if error is None else fail(error, 409)


async def files_upload(request):
    project = project_param(request.query.get('project'))
    if request.content_type != 'multipart/form-data': return fail('Se requiere una carga multipart', 415)
    if request.content_length and request.content_length > 25 * 1024 * 1024: return fail('Carga demasiado grande', 413)
    reader = await request.multipart()
    saved = []
    total = 0
    # Los adjuntos del chat (.codex-manager/uploads) no se versionan; las cargas al proyecto sí.
    versioning = request.query.get('dir') is not None
    if versioning: await blocking(gitops.record, project, 'Cambios pendientes antes de: subir archivos', 'pending')
    async for part in reader:
        if len(saved) >= 16: return fail('Máximo 16 archivos por carga', 413)
        data = bytearray()
        while chunk := await part.read_chunk():
            total += len(chunk)
            if total > 25 * 1024 * 1024: return fail('La carga supera los 25 MB', 413)
            data.extend(chunk)
            if len(data) > 20 * 1024 * 1024: return fail('Archivo demasiado grande (máx. 20 MB)', 413)
        if part.name != 'file': continue
        result, error = await blocking(files_call, files.save_upload, project, request.query.get('dir'), part.filename, data)
        if error: return fail(error)
        saved.append(result)
    if versioning and saved:
        await blocking(gitops.record, project, f'Subir {len(saved)} archivo(s): ' + ', '.join(saved[:3]) + ('…' if len(saved) > 3 else ''), 'upload')
    return reply({'message': f'{len(saved)} archivo(s) subidos', 'paths': saved}, 201)


def clean_path(value):
    return ' '.join(str(value or '').strip().lstrip('/').split())[:120]


def git_call(func, *args):
    try: return func(*args), None
    except gitops.VersionError as error: return None, str(error)
    except files.FileError as error: return None, str(error)


def query_int(request, key, default):
    try: return int(request.query.get(key, default))
    except ValueError: return default


async def git_get(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(git_call, gitops.status, project)
    return reply(result) if error is None else fail(error, 409)


async def git_log(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(git_call, gitops.log, project, request.query.get('ref', ''), query_int(request, 'skip', 0), query_int(request, 'limit', 40))
    return reply(result) if error is None else fail(error, 404)


async def git_commit(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(git_call, gitops.show, project, request.query.get('rev', ''))
    return reply(result) if error is None else fail(error, 404)


async def git_branches(request):
    project = project_param(request.query.get('project'))
    result, error = await blocking(git_call, gitops.branches, project)
    return reply(result) if error is None else fail(error, 409)


async def git_diff(request):
    project = project_param(request.query.get('project'))
    path = request.query.get('path', '')
    if path:
        _, error = await blocking(files_call, files.resolve, project, path, False)
        if error: return fail(error)
        path = path.lstrip('/')
        if path.startswith('-'): return fail('Ruta inválida')
    result, error = await blocking(git_call, gitops.diff, project, path, request.query.get('rev', ''), request.query.get('compare') == '1')
    return reply(result) if error is None else fail(error, 404)


async def git_post(request):
    data = await body(request)
    project = project_param(data.get('project'))
    ok, message, extra = await blocking(gitops.act, project, data)
    projects.invalidate()
    if ok and data.get('deploy') is True and data.get('action') in ('restore', 'undo', 'revert', 'switch', 'merge'):
        # «Restaurar y desplegar»: el rollback llega también a la web publicada.
        started, job_message, job_id = await blocking(runs.start_job, project, 'deploy')
        extra['job_id'] = job_id if started else ''
        message += f' {job_message}' if started else f' No se pudo desplegar: {job_message}'
    return reply({'message': message, **extra}, 200 if ok else 409)


# ---------------------------------------------------------------- terminal web

TERMINAL_KINDS = ('shell', 'claude', 'codex', 'attach')


def terminal_session(project, kind, session=''):
    """Devuelve el nombre de la sesión tmux a la que conectar, creándola si hace falta."""
    host_dir = f'{config.HOST_PROJECTS}/{project}'
    if kind == 'attach':
        names = {s['name'] for s in tmux.sessions()}
        if session not in names: return None, 'Esa sesión ya no existe'
        return session, None
    name = {'shell': f'{project}-shell', 'claude': f'{project}-claude', 'codex': project}[kind]
    if tmux.has_session(name): return name, None
    if kind == 'shell': argv = ['/bin/bash', '-l']
    else: argv = ['/home/dv1/.local/bin/codex-session-run', project, host_dir] + (['claude'] if kind == 'claude' else [])
    ok, error = tmux.new_session(name, host_dir, argv)
    projects.invalidate()
    return (name, None) if ok else (None, error or 'No se pudo crear la sesión')


async def terminal_status(request):
    query = request.query
    kind = query.get('kind', 'shell')
    if kind not in TERMINAL_KINDS: return fail('Tipo de terminal inválido')
    project = project_param(query.get('project'))
    if not await blocking(tmux.host_server_ok): return fail(tmux.server_error(), 503)
    if not terminalio.capacity(request): return fail('Demasiadas terminales abiertas. Cierra otra pestaña o dispositivo.', 429)
    name = query.get('session', '') if kind == 'attach' else {'shell': f'{project}-shell', 'claude': f'{project}-claude', 'codex': project}[kind]
    return reply({'ok': True, 'session': name, **await blocking(tmux.pane_state, name)})


async def terminal(request):
    query = request.query
    kind = query.get('kind', 'shell')
    if kind not in TERMINAL_KINDS: return fail('Tipo de terminal inválido')
    project = project_param(query.get('project'))
    if not terminalio.capacity(request): return fail('Demasiadas terminales abiertas. Cierra otra pestaña o dispositivo.', 429)
    name, error = await blocking(terminal_session, project, kind, query.get('session', ''))
    if error: return fail(error, 503)
    return await terminalio.connect(request, name, blocking)


async def terminal_scroll(request):
    data = await body(request)
    name = str(data.get('session', ''))
    if name not in {s['name'] for s in tmux.sessions()}: return fail('Sesión inválida')
    ok = await blocking(tmux.scroll, name, str(data.get('direction', 'up')))
    return reply({'ok': ok, **await blocking(tmux.pane_state, name)})


async def terminal_kill(request):
    data = await body(request)
    name = str(data.get('session', ''))
    if name not in {s['name'] for s in tmux.sessions()}: return fail('Sesión inválida')
    ok = await blocking(tmux.kill_session, name)
    projects.invalidate()
    return reply({'message': 'Sesión cerrada' if ok else 'No se pudo cerrar la sesión'}, 200 if ok else 409)


# ---------------------------------------------------------------- archivos estáticos (PWA)

def static_response(path, cache):
    headers = {'Cache-Control': cache}
    content_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    if path.suffix == '.webmanifest': content_type = 'application/manifest+json'
    headers['Content-Type'] = content_type + ('; charset=utf-8' if content_type.startswith('text/') or content_type.endswith(('javascript', 'json')) else '')
    return web.FileResponse(path, headers=headers)


async def frontend(request):
    root = config.FRONTEND.resolve()
    relative = request.path.lstrip('/')
    if relative.startswith('api/'): return fail('Ruta de API no encontrada', 404)
    if relative and not relative.startswith('api/'):
        candidate = (root / relative).resolve()
        if root in candidate.parents and candidate.is_file():
            immutable = relative.startswith('assets/')
            return static_response(candidate, 'public, max-age=31536000, immutable' if immutable else 'no-cache')
        if relative.startswith(('assets/', 'icons/')) or '.' in Path(relative).name:
            return web.Response(status=404, text='No encontrado')
    index = root / 'index.html'
    if not index.exists(): return web.Response(status=503, text='Interfaz no compilada')
    response = static_response(index, 'no-cache')
    response.headers['X-Frame-Options'] = 'DENY'
    return response


async def health(request):
    return web.Response(text='ok')


def make_app():
    app = web.Application(middlewares=[websecurity.middleware, security], client_max_size=25 * 1024 * 1024)
    app.on_response_prepare.append(websecurity.prepare)
    app[terminalio.CLIENTS] = {}
    app.add_routes([
        web.get('/health', health),
        web.post('/api/login', login), web.post('/api/login/mfa', login_mfa), web.post('/api/logout', logout), web.get('/api/me', me),
        web.get('/api/security', security_get), web.post('/api/security/setup', security_setup),
        web.post('/api/security/confirm', security_confirm), web.post('/api/security/recovery', security_recovery),
        web.post('/api/security/revoke', security_revoke),
        web.get('/api/state', state), web.get('/api/settings', settings_get), web.post('/api/settings', settings_post),
        web.get('/api/push', push_get), web.post('/api/push', push_post),
        web.get('/api/voice', speech.status), web.post('/api/voice/transcribe', speech.recognize),
        web.get('/api/models', models_get), web.get('/api/agent', agent_get), web.post('/api/agent/send', agent_send), web.post('/api/agent/reset', agent_reset),
        web.get('/api/agent/chats', chats_get), web.post('/api/agent/chats', chats_post),
        web.get(r'/api/runs/{run_id}', run_get), web.post(r'/api/runs/{run_id}/stop', run_stop),
        web.post('/api/approvals', approval_post), web.post('/api/rules', rules_post),
        web.post('/api/tasks', tasks_post), web.post('/api/projects', projects_post),
        web.get('/api/projects/delete-preview', project_delete_preview), web.get('/api/projects/trash', project_trash),
        web.post('/api/projects/repo-check', repo_check), web.get('/api/quota', quota_get), web.get('/api/github', github_get), web.post('/api/github', github_post),
        web.post('/api/docker', docker_post), web.get('/api/logs', logs_get),
        web.get('/api/jobs', jobs_get), web.get(r'/api/jobs/{job_id}', job_get), web.post('/api/jobs', jobs_post),
        web.get(r'/api/media/{name}', media_get),
        web.get('/api/files/list', files_list), web.get('/api/files/read', files_read), web.get('/api/files/raw', files_raw),
        web.post('/api/files/write', files_write), web.post('/api/files/op', files_op), web.post('/api/files/upload', files_upload),
        web.get('/api/git', git_get), web.get('/api/git/diff', git_diff), web.post('/api/git', git_post),
        web.get('/api/git/log', git_log), web.get('/api/git/commit', git_commit), web.get('/api/git/branches', git_branches),
        web.get('/api/term', terminal), web.get('/api/term/status', terminal_status), web.post('/api/term/scroll', terminal_scroll), web.post('/api/term/kill', terminal_kill),
        web.get('/{tail:.*}', frontend),
    ])
    return app


def main():
    projects.cpu_snapshot()
    config.RUNS.mkdir(parents=True, exist_ok=True)
    config.JOBS.mkdir(parents=True, exist_ok=True)
    media.prepare()
    threading.Thread(target=runs.scheduler_loop, name='agent-scheduler', daemon=True).start()
    threading.Thread(target=push.worker, name='push-notifications', daemon=True).start()
    runs.WAKE.set()
    web.run_app(make_app(), host='0.0.0.0', port=int(os.environ.get('PORT', '3000')), access_log=None, print=None)


if __name__ == '__main__':
    main()
