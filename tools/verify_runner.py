#!/usr/bin/env python3
"""Prueba real y acotada del runner. Usa Claude con aprobación y Codex solo lectura.

No cambia ajustes ni cola del panel. Conserva evidencias en el directorio indicado.
Uso: python3 tools/verify_runner.py /srv/platform/backups/cm-validation-<fecha>
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(sys.argv[1]).resolve()
BASE.mkdir(parents=True, exist_ok=True)
CWD = BASE / 'workspace'
CWD.mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT))
from cm.runs import normalize_claude, normalize_codex


def execute(name, provider, prompt, resume='', decision='allow', stop=False):
    folder = BASE / 'runs' / name
    folder.mkdir(parents=True, exist_ok=False)
    meta = {'id': name, 'kind': 'agent', 'provider': provider, 'project': 'cm-validation', 'cwd': str(CWD),
            'created_at': time.time(), 'permission': 'ask', 'sandbox': 'read-only', 'resume_id': resume}
    if provider == 'claude' and not resume: meta['session_id'] = str(uuid.uuid4())
    (folder / 'meta.json').write_text(json.dumps(meta))
    (folder / 'prompt.txt').write_text(prompt)
    env = dict(os.environ)
    for key in ('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'TMUX', 'TMUX_PANE'): env.pop(key, None)
    process = subprocess.Popen([sys.executable, str(ROOT / 'bin/cm-runner.py'), str(folder)], env=env)
    deadline, approvals, stopped = time.monotonic() + 150, 0, False
    try:
        while process.poll() is None and time.monotonic() < deadline:
            for request in (folder / 'approvals').glob('*.req.json'):
                answer = request.with_name(request.name.replace('.req.json', '.ans.json'))
                if answer.exists(): continue
                data = json.loads(request.read_text())
                command = data.get('input', {}).get('command', '')
                if data['tool_name'] != 'Bash' or command not in ('echo cm-approval-ok', 'echo cm-deny-test', 'sleep 60'):
                    raise AssertionError(f'Solicitud inesperada: {data["tool_name"]}: {command}')
                approvals += 1
                answer.write_text(json.dumps({'decision': decision, 'message': 'Prueba de integración autorizada'}))
                print(json.dumps({'test': name, 'approval': command, 'decision': decision}), flush=True)
                if stop:
                    time.sleep(1)
                    (folder / 'stop').write_text('integration test'); stopped = True
            time.sleep(0.2)
        if process.poll() is None:
            (folder / 'stop').write_text('test timeout')
            process.wait(timeout=25)
            raise AssertionError(f'{name}: timeout; revisar {folder}')
    finally:
        if process.poll() is None:
            (folder / 'stop').write_text('test cleanup'); process.wait(timeout=25)
    exit_data = json.loads((folder / 'exit.json').read_text())
    rows = [json.loads(line) for line in (folder / 'events.jsonl').read_text().splitlines() if line.strip()]
    events, info = (normalize_claude if provider == 'claude' else normalize_codex)(rows)
    print(json.dumps({'test': name, 'exit': exit_data, 'events': len(events), 'result': info.get('result'), 'approvals': approvals}, ensure_ascii=False), flush=True)
    if stop: assert stopped and exit_data['stopped'], name
    else: assert exit_data['code'] == 0 and info.get('result', {}).get('ok'), name
    return info, events, approvals


def main():
    provider = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if provider in ('all', 'claude'):
        info, events, count = execute('claude-allow', 'claude', 'Prueba de integración. Usa Bash para ejecutar exactamente: echo cm-approval-ok . El punto final no forma parte del comando. No uses otras herramientas. Al terminar responde solo VALIDACION_OK.')
        assert count == 1 and any('cm-approval-ok' in e.get('output', '') for e in events)
        info, events, count = execute('claude-resume-deny', 'claude', 'Ahora usa Bash para ejecutar exactamente: echo cm-deny-test . Si se deniega, no reintentes y responde DENEGADO_OK. No uses otras herramientas.', resume=info['session_id'], decision='deny')
        assert count == 1 and not any(e.get('output', '').strip() == 'cm-deny-test' for e in events)
        execute('claude-stop', 'claude', 'Usa Bash para ejecutar exactamente: sleep 60 . No uses ninguna otra herramienta.', stop=True)
    if provider in ('all', 'codex'):
        info, _, _ = execute('codex-initial', 'codex', 'No uses herramientas ni comandos. Recuerda el código CM_RESUME_742 y responde solo VALIDACION_OK.')
        assert info.get('session_id')
        info, events, _ = execute('codex-resume', 'codex', 'Sin usar herramientas ni comandos, responde solo el código que te pedí recordar.', resume=info['session_id'])
        assert 'CM_RESUME_742' in info['result']['text']
    print(f'RUNNER_VALIDATION_OK: {provider}', flush=True)


if __name__ == '__main__': main()
