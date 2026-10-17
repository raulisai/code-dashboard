#!/usr/bin/env python3
"""Ejecutor del lado del host para Codex Manager.

El panel corre dentro de Docker y no tiene los binarios de Claude Code ni de
Codex. Para cada petición escribe un directorio con `meta.json` (y `prompt.txt`)
y lanza este script en una sesión tmux del host:

    cm-runner.py <directorio-de-la-ejecución>

El script ejecuta el agente en modo no interactivo (o un comando de despliegue),
guarda stdout/stderr en archivos que el panel lee mientras avanza y, al terminar,
escribe `exit.json` con el código de salida. Detener = el panel crea el archivo
`stop`; aquí se reenvía la señal a todo el grupo de procesos del agente.
"""
import json, os, signal, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from cm import vcs  # solo biblioteca estándar; compartido con el panel
except Exception:  # p. ej. el panel se restauró a una versión sin versionado
    vcs = None

HOME = Path(os.environ.get('HOME', '/home/dv1'))
LOCAL_BIN = HOME / '.local' / 'bin'
MCP_SCRIPT = Path(__file__).resolve().with_name('cm-approval-mcp.py')
APPROVAL_TOOL = 'mcp__codexmanager__approve'


def write_json(path, data):
    tmp = path.with_name(f'.{path.name}.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    os.replace(tmp, path)


def agent_env():
    env = dict(os.environ)
    # Variables heredadas de una sesión de Claude/tmux que confundirían al agente.
    for key in ('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'TMUX', 'TMUX_PANE'):
        env.pop(key, None)
    env['PATH'] = f"{LOCAL_BIN}:/usr/local/bin:/usr/bin:/bin:{env.get('PATH', '')}"
    env.setdefault('LANG', 'C.UTF-8')
    # La aprobación desde la web puede tardar: el cliente MCP no debe cortar antes
    # de que el servidor de aprobaciones responda (él mismo deniega a los 30 min).
    env['MCP_TOOL_TIMEOUT'] = str(35 * 60 * 1000)
    return env


def claude_command(meta, run_dir):
    argv = [str(LOCAL_BIN / 'claude'), '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
    if meta.get('resume_id'):
        argv += ['--resume', meta['resume_id']]
    elif meta.get('session_id'):
        argv += ['--session-id', meta['session_id']]
    if meta.get('model'):
        argv += ['--model', meta['model']]
    if meta.get('effort'):
        argv += ['--effort', meta['effort']]
    mode = meta.get('permission', 'ask')
    if mode == 'auto':
        argv += ['--permission-mode', 'auto', '--permission-prompts', 'none']
    elif mode == 'edits':
        argv += ['--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
                 '--tools', 'Read,Edit,Write,Glob,Grep,NotebookEdit,TodoWrite',
                 '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
    else:
        # Las ediciones dentro del proyecto se aceptan solas; cualquier otra acción
        # que requiera permiso se consulta al usuario en la web.
        mcp = {'mcpServers': {'codexmanager': {'type': 'stdio', 'command': sys.executable, 'args': [str(MCP_SCRIPT), str(run_dir)]}}}
        argv += ['--permission-mode', 'acceptEdits', '--permission-prompt-tool', APPROVAL_TOOL, '--mcp-config', json.dumps(mcp),
                 '--settings', json.dumps({'permissions': {'ask': ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Skill']}})]
    if meta.get('system_prompt'):
        argv += ['--append-system-prompt', meta['system_prompt']]
    return argv


def codex_command(meta):
    argv = [str(LOCAL_BIN / 'codex'), 'exec', '--json', '--skip-git-repo-check', '-C', meta['cwd']]
    sandbox = meta.get('sandbox', 'full')
    if sandbox == 'full':
        argv.append('--dangerously-bypass-approvals-and-sandbox')
    else:
        argv += ['-s', 'read-only' if sandbox == 'read-only' else 'workspace-write']
    if meta.get('model'):
        argv += ['-m', meta['model']]
    if meta.get('effort'):
        argv += ['-c', 'model_reasoning_effort=' + json.dumps(meta['effort'])]
    if meta.get('resume_id'):
        argv += ['resume', meta['resume_id']]
    argv.append('-')
    return argv


def build(meta, run_dir):
    if meta['kind'] == 'job':
        return list(meta['argv'])
    if meta['provider'] == 'claude':
        return claude_command(meta, run_dir)
    return codex_command(meta)


def final_text(path, provider):
    """Última respuesta del agente, para describir el commit de sus cambios."""
    try:
        with open(path, 'rb') as handle:
            handle.seek(0, os.SEEK_END); handle.seek(max(0, handle.tell() - 400000))
            lines = handle.read().decode('utf-8', errors='replace').splitlines()
    except OSError:
        return ''
    for line in reversed(lines):
        try: row = json.loads(line)
        except ValueError: continue
        if provider == 'claude' and row.get('type') == 'result': return str(row.get('result') or '')
        item = row.get('item') or {}
        if provider == 'codex' and row.get('type') == 'item.completed' and item.get('type') == 'agent_message': return str(item.get('text') or '')
    return ''


def version(meta, run_dir, phase, outcome=''):
    """Un commit con lo pendiente antes del agente y otro con lo que cambió el agente."""
    if vcs is None or meta.get('kind') != 'agent' or not meta.get('versioning'): return
    who = 'Claude' if meta.get('provider') == 'claude' else 'Codex'
    title = meta.get('title') or 'petición desde Codex Manager'
    path = run_dir / 'versions.json'
    try: data = json.loads(path.read_text())
    except (OSError, ValueError): data = {}
    try:
        if phase == 'before':
            result = vcs.snapshot(meta['cwd'], f'Cambios pendientes antes de {who}', 'pending',
                                  f'Guardados automáticamente antes de la petición: {title}', {'Run': meta['id']})
            data.update({'base': result['head'], 'before': result['sha']})
        else:
            # request.txt = mensaje del usuario sin el contexto añadido por el panel (cambio de agente).
            source = run_dir / 'request.txt' if (run_dir / 'request.txt').exists() else run_dir / 'prompt.txt'
            prompt = source.read_text(errors='replace') if source.exists() else ''
            if prompt.startswith('[Contexto de Codex Manager]'): prompt = prompt.split('\n\n', 1)[-1]
            answer = final_text(run_dir / 'events.jsonl', meta.get('provider'))
            body = f'Petición:\n{prompt.strip()[:1500]}' + (f'\n\nRespuesta:\n{answer.strip()[:1200]}' if answer.strip() else '')
            result = vcs.snapshot(meta['cwd'], f'{who}: {title}' + (f' ({outcome})' if outcome else ''), 'agent', body,
                                  {'Provider': meta.get('provider'), 'Run': meta['id'], 'Chat': meta.get('chat_id', 'main')})
            data.update({'commit': result['sha'], 'head': result['head']})
        if result['error']: data['error'] = result['error']
    except Exception as error:  # el versionado nunca impide ejecutar ni cerrar la petición
        data['error'] = str(error)
    write_json(path, data)


def main():
    run_dir = Path(sys.argv[1]).resolve()
    meta = json.loads((run_dir / 'meta.json').read_text())
    os.umask(0o077)
    stop_file = run_dir / 'stop'
    exit_file = run_dir / 'exit.json'
    requested = {'stop': False}

    def on_signal(signum, _frame):
        requested['stop'] = True
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, on_signal)

    is_job = meta['kind'] == 'job'
    out_path = run_dir / ('output.log' if is_job else 'events.jsonl')
    err_path = run_dir / ('output.log' if is_job else 'stderr.log')
    prompt = run_dir / 'prompt.txt'
    started = time.time()
    version(meta, run_dir, 'before')
    try:
        argv = build(meta, run_dir)
        with open(out_path, 'ab', buffering=0) as out, open(err_path, 'ab', buffering=0) as err, \
                (open(prompt, 'rb') if prompt.exists() else open(os.devnull, 'rb')) as stdin:
            child = subprocess.Popen(argv, cwd=meta['cwd'], stdin=stdin, stdout=out, stderr=subprocess.STDOUT if is_job else err,
                                     env=agent_env(), start_new_session=True)
    except Exception as error:
        with open(err_path, 'a') as log:
            log.write(f'No se pudo iniciar: {error}\n')
        write_json(exit_file, {'code': 127, 'stopped': False, 'finished_at': time.time(), 'duration': 0})
        return 127

    write_json(run_dir / 'pid.json', {'runner': os.getpid(), 'child': child.pid, 'started_at': started})
    stopped, stop_sent = False, 0.0
    while True:
        code = child.poll()
        if code is not None:
            break
        if not stopped and (requested['stop'] or stop_file.exists()):
            stopped, stop_sent = True, time.monotonic()
            # SIGINT primero: Claude y Codex cierran limpio y guardan la sesión.
            try: os.killpg(child.pid, signal.SIGINT)
            except ProcessLookupError: pass
        elif stopped:
            waited = time.monotonic() - stop_sent
            sig = signal.SIGKILL if waited > 15 else signal.SIGTERM if waited > 6 else None
            if sig:
                try: os.killpg(child.pid, sig)
                except ProcessLookupError: pass
        time.sleep(0.4)
    version(meta, run_dir, 'after', 'detenida' if stopped else 'con error' if code else '')
    write_json(exit_file, {'code': code, 'stopped': stopped, 'finished_at': time.time(), 'duration': round(time.time() - started, 1)})
    return 0


if __name__ == '__main__':
    sys.exit(main())
