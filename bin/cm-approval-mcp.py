#!/usr/bin/env python3
"""Servidor MCP mínimo (stdio) que Claude Code usa como --permission-prompt-tool.

Cuando Claude necesita permiso para algo que no es editar archivos del proyecto
(un comando, una petición web…), llama a la herramienta `approve`. Este proceso
escribe la solicitud en `<run_dir>/approvals/<id>.req.json`; el panel web la
muestra con los botones Permitir / Denegar y deja la respuesta en
`<id>.ans.json`. Si el usuario eligió "permitir siempre", la regla se guarda en
`approval-rules.json` y las siguientes solicitudes equivalentes pasan solas.
"""
import json, os, secrets, shlex, sys, threading, time
from pathlib import Path
from urllib.parse import urlsplit

RUN_DIR = Path(sys.argv[1]).resolve()
APPROVALS = RUN_DIR / 'approvals'
RULES_FILE = RUN_DIR.parent.parent / 'approval-rules.json'
TIMEOUT = 30 * 60
WRITE_LOCK = threading.Lock()
# Nunca se ofrecen como "permitir siempre": cada uso debe confirmarse.
NEVER_REMEMBER = {'rm', 'sudo', 'su', 'dd', 'mkfs', 'shutdown', 'reboot', 'chmod', 'chown', 'kill', 'pkill', 'killall', 'eval', 'bash', 'sh'}
SHELL_OPERATORS = (';', '|', '`', '$', '>', '<', '\n', '\r', '&', '\\')
REMEMBER_COMMANDS = {'echo', 'printf', 'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'npm', 'pnpm', 'yarn', 'bun', 'git', 'docker'}


def project_name():
    try: return json.loads((RUN_DIR / 'meta.json').read_text()).get('project', '')
    except (OSError, ValueError): return ''


def rule_for(tool_name, tool_input):
    """Regla reutilizable para 'permitir siempre', o None si no es seguro generalizar."""
    if tool_name in ('Write', 'Edit', 'MultiEdit', 'NotebookEdit'):
        return None
    if tool_name == 'WebFetch':
        url = urlsplit(str((tool_input or {}).get('url', '')))
        return f'WebFetch:{url.scheme}://{url.netloc}' if url.scheme in ('http', 'https') and url.netloc else None
    if tool_name == 'WebSearch': return 'WebSearch'
    if tool_name != 'Bash': return None
    command = str((tool_input or {}).get('command', '')).strip()
    if not command or any(op in command for op in SHELL_OPERATORS):
        return None
    try: words = shlex.split(command)
    except ValueError: return None
    if not words or words[0] not in REMEMBER_COMMANDS or any(word in NEVER_REMEMBER for word in words):
        return None
    if words[0] == 'git' and (len(words) < 2 or words[1] not in ('status', 'diff', 'show', 'log')): return None
    if words[0] == 'docker' and any(word in ('down', 'prune', 'remove', 'stop', 'kill') for word in words): return None
    # Se recuerda el comando completo: aprobar «npm run build» no concede
    # permiso para «npm run <otro script>» ni para un intérprete arbitrario.
    return f'Bash:{command}'


def remembered(rule):
    if not rule: return False
    try: rules = json.loads(RULES_FILE.read_text())
    except (OSError, ValueError): return False
    return rule in rules.get(project_name(), [])


def decide(arguments):
    tool_name = str(arguments.get('tool_name', ''))
    tool_input = arguments.get('input') or {}
    rule = rule_for(tool_name, tool_input)
    if remembered(rule):
        return {'behavior': 'allow', 'updatedInput': tool_input}
    APPROVALS.mkdir(parents=True, exist_ok=True)
    request_id = f'{time.time_ns()}-{secrets.token_hex(3)}'
    request = {'id': request_id, 'tool_name': tool_name, 'input': tool_input, 'tool_use_id': arguments.get('tool_use_id', ''),
               'rule': rule, 'created_at': time.time()}
    tmp = APPROVALS / f'.{request_id}.tmp'
    tmp.write_text(json.dumps(request, ensure_ascii=False))
    os.replace(tmp, APPROVALS / f'{request_id}.req.json')
    answer_file = APPROVALS / f'{request_id}.ans.json'
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if answer_file.exists():
            try: answer = json.loads(answer_file.read_text())
            except ValueError:
                time.sleep(0.2); continue
            if answer.get('decision') == 'allow':
                return {'behavior': 'allow', 'updatedInput': tool_input}
            return {'behavior': 'deny', 'message': answer.get('message') or 'El usuario denegó esta acción desde Codex Manager.'}
        if (RUN_DIR / 'stop').exists():
            return {'behavior': 'deny', 'message': 'La ejecución fue detenida por el usuario.'}
        time.sleep(0.4)
    (APPROVALS / f'{request_id}.ans.json').write_text(json.dumps({'decision': 'deny', 'message': 'timeout'}))
    return {'behavior': 'deny', 'message': 'Nadie respondió la solicitud de permiso en 30 minutos.'}


def send(message):
    with WRITE_LOCK:
        sys.stdout.write(json.dumps(message, ensure_ascii=False) + '\n')
        sys.stdout.flush()


TOOL = {
    'name': 'approve',
    'description': 'Pide al usuario de Codex Manager que apruebe o deniegue una acción de Claude.',
    'inputSchema': {'type': 'object', 'properties': {'tool_name': {'type': 'string'}, 'input': {'type': 'object'}, 'tool_use_id': {'type': 'string'}},
                    'required': ['tool_name', 'input']},
}


def handle_call(message_id, params):
    try:
        result = decide(params.get('arguments') or {})
    except Exception as error:
        result = {'behavior': 'deny', 'message': f'Error al pedir aprobación: {error}'}
    send({'jsonrpc': '2.0', 'id': message_id, 'result': {'content': [{'type': 'text', 'text': json.dumps(result, ensure_ascii=False)}]}})


def main():
    for line in sys.stdin:
        try: message = json.loads(line)
        except ValueError: continue
        method, message_id = message.get('method'), message.get('id')
        if message_id is None:
            continue  # notificaciones (initialized, cancelled…)
        if method == 'initialize':
            version = (message.get('params') or {}).get('protocolVersion', '2025-06-18')
            send({'jsonrpc': '2.0', 'id': message_id, 'result': {'protocolVersion': version, 'capabilities': {'tools': {}},
                                                                 'serverInfo': {'name': 'codexmanager', 'version': '1.0.0'}}})
        elif method == 'tools/list':
            send({'jsonrpc': '2.0', 'id': message_id, 'result': {'tools': [TOOL]}})
        elif method == 'tools/call':
            # En un hilo: Claude puede pedir varias aprobaciones a la vez.
            threading.Thread(target=handle_call, args=(message_id, message.get('params') or {}), daemon=True).start()
        elif method == 'ping':
            send({'jsonrpc': '2.0', 'id': message_id, 'result': {}})
        else:
            send({'jsonrpc': '2.0', 'id': message_id, 'error': {'code': -32601, 'message': f'Método no soportado: {method}'}})


if __name__ == '__main__':
    main()
