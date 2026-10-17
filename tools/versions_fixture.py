"""Instancia local AISLADA para probar Versiones en un navegador real.

Siembra proyectos de prueba con historial, ramas, un despliegue y una respuesta
de agente, y sirve el panel por HTTPS con un certificado autofirmado. No monta
proyectos reales ni credenciales. Uso (ver tools/verify_versions_browser.cjs):

  docker run --rm -d --name cm-versions-check --user 1002:1002 -p 127.0.0.1:13017:3443 \
    -v /srv/projects/codex-dashboard:/src:ro --tmpfs /work:uid=1002,gid=1002 \
    -e CONFIG_DIR=/work/config -e PROJECTS_DIR=/work/projects -e HOME=/work \
    -e MONITOR_USER=tester -e MONITOR_PASSWORD=unit-password -e FRONTEND_DIR=/src/frontend/dist \
    codex-dashboard-dashboard python /src/tools/versions_fixture.py
"""
import json, os, ssl, subprocess, sys, time
sys.path.insert(0, '/src')
if not os.environ.get('PROJECTS_DIR', '').startswith('/work/'): sys.exit('Solo para la instancia aislada (/work)')
from aiohttp import web
import app
from cm import config, gitops, runs, vcs
from cm.util import write_json


def write(root, name, text):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def fake_run(project, provider, title, prompt, answer, commit, base):
    run_id = runs.new_id(); time.sleep(1.1)
    folder = config.RUNS / run_id
    folder.mkdir(parents=True)
    write_json(folder / 'meta.json', {'id': run_id, 'kind': 'agent', 'provider': provider, 'project': project, 'chat_id': 'main', 'title': title,
                                      'cwd': str(config.PROJECTS / project), 'created_at': time.time() - 60, 'origin': 'chat', 'versioning': True})
    (folder / 'prompt.txt').write_text(prompt)
    (folder / 'events.jsonl').write_text(json.dumps({'type': 'item.completed', 'item': {'id': '1', 'type': 'agent_message', 'text': answer}}) + '\n'
                                         + json.dumps({'type': 'turn.completed', 'usage': {}}) + '\n')
    write_json(folder / 'exit.json', {'code': 0, 'stopped': False, 'finished_at': time.time() - 30, 'duration': 30})
    write_json(folder / 'versions.json', {'base': base, 'commit': commit, 'head': commit})
    return run_id


def seed():
    for folder in (config.CONFIG, config.RUNS, config.JOBS, config.PROJECTS): folder.mkdir(parents=True, exist_ok=True)
    root = config.PROJECTS / 'demo'
    write(root, 'index.html', '<h1>Demo</h1>\n'); write(root, 'style.css', 'body{background:#fff}\n')
    write(root, 'compose.yaml', 'services: {}\n'); write(root, '.env', 'SECRETO=no-versionar\n')
    gitops.record('demo', 'Crear página', 'edit')
    base = vcs.head(root)
    write(root, 'menu.js', 'export const menu = ["Inicio", "Contacto"];\n'); write(root, 'style.css', 'body{background:#111;color:#eee}\n')
    claude = vcs.snapshot(root, 'Claude: Añade el menú y el modo oscuro', 'agent', 'Petición:\nAñade un menú y modo oscuro',
                          {'Provider': 'claude', 'Run': 'x', 'Chat': 'main'})['sha']
    fake_run('demo', 'claude', 'Añade el menú y el modo oscuro', 'Añade un menú y modo oscuro', 'Listo: añadí menu.js y el modo oscuro.', claude, base)
    write(root, 'style.css', 'body{background:#111;color:#eee}\n@media(max-width:600px){h1{font-size:2rem}}\n')
    vcs.snapshot(root, 'Codex: Corrige el diseño en celular', 'agent', '', {'Provider': 'codex'})
    gitops.versioned('demo', 'Editar index.html', 'edit', lambda: write(root, 'index.html', '<h1>Demo</h1>\n<p>Hola desde el editor</p>\n'))
    job = runs.new_id(); write_json(config.JOBS / job / 'meta.json', {'id': job, 'kind': 'job', 'project': 'demo', 'action': 'deploy', 'title': 'Desplegar',
                                                                       'commit': vcs.head(root), 'created_at': time.time() - 20, 'argv': [], 'cwd': ''})
    write_json(config.JOBS / job / 'exit.json', {'code': 0, 'finished_at': time.time() - 10})
    gitops.versioned('demo', 'Subir 2 archivo(s): logo.png, foto.jpg', 'upload', lambda: (write(root, 'logo.png', 'png'), write(root, 'foto.jpg', 'jpg')))
    vcs.ok(root, 'branch', 'alternativa-azul', claude); vcs.ok(root, 'switch', '-q', 'alternativa-azul')
    write(root, 'style.css', 'body{background:#0b3d91;color:#fff}\n')
    vcs.snapshot(root, 'Claude: Prueba una paleta azul', 'agent', '', {'Provider': 'claude'})
    vcs.ok(root, 'switch', '-q', 'main')
    write(root, 'notas.txt', 'cambio hecho en la terminal\n')  # pendiente sin guardar
    plain = config.PROJECTS / 'nuevo'
    write(plain, 'index.html', '<p>Sin versiones</p>\n'); write(plain, '.env', 'TOKEN=x\n')


def main():
    seed()
    cert, key = '/work/cert.pem', '/work/key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'],
                   check=True, capture_output=True)
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH); context.load_cert_chain(cert, key)
    print('VERSIONS_FIXTURE_READY', flush=True)
    web.run_app(app.make_app(), host='0.0.0.0', port=3443, ssl_context=context, access_log=None, print=None)


if __name__ == '__main__':
    main()
