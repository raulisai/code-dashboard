#!/usr/bin/env python3
"""Elimina contenedores propios, cierra terminales y archiva un proyecto del host.

No ejecuta el Compose del proyecto ni borra volúmenes o imágenes.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def command(argv, timeout=45):
    result = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
    if result.returncode: raise RuntimeError(result.stderr.strip()[:500] or 'Falló el comando de mantenimiento')
    return result.stdout


def belongs(container, name):
    label = (container.get('Config', {}).get('Labels') or {}).get('com.docker.compose.project')
    if label: return label == name
    actual = container.get('Name', '').lstrip('/')
    return actual == name or actual.startswith(name + '-')


def main():
    os.umask(0o077)
    job = Path(sys.argv[1]).resolve(); meta = json.loads((job / 'meta.json').read_text())
    name, job_id = meta['project'], meta['id']
    if meta.get('action') != 'delete-project' or not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[0-9a-f]{6}', job_id): raise ValueError('Trabajo inválido')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?', name): raise ValueError('Proyecto inválido')
    if name.startswith(('cmr-', 'cmj-', 'cm-keepalive')): raise ValueError('Nombre reservado del sistema')
    base = Path(meta['projects_root']).resolve(); project = base / name
    if project.is_symlink() or project.resolve().parent != base or not project.is_dir(): raise ValueError('Ruta inválida')
    if project.resolve() == Path(__file__).resolve().parents[1]: raise ValueError('No se puede eliminar el dashboard')
    trash = base / '.cm-trash'
    if trash.is_symlink(): raise ValueError('Papelera inválida')
    trash.mkdir(mode=0o700, exist_ok=True)
    archive = trash / job_id; archive.mkdir(mode=0o700)
    (archive / 'meta.json').write_text(json.dumps({'project': name, 'deleted_at': time.time(), 'job_id': job_id,
                                                 'recovery': meta.get('recovery', {}), 'volumes_preserved': True}, ensure_ascii=False))
    identifiers = set(meta.get('container_ids', []))
    identifiers.update(command(['docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={name}', '--format', '{{.ID}}']).splitlines())
    for identifier in sorted(identifiers):
        if not re.fullmatch(r'[a-f0-9]{12,64}', identifier): raise ValueError('Contenedor inválido')
        inspected = subprocess.run(['docker', 'inspect', identifier], text=True, capture_output=True, timeout=10)
        if inspected.returncode: continue  # ya desapareció; nunca buscar otro por un prefijo ambiguo
        container = json.loads(inspected.stdout)[0]
        if not belongs(container, name): raise ValueError('El contenedor ya no pertenece al proyecto')
        print(f"Retirando {container.get('Name', identifier).lstrip('/')}", flush=True)
        if container.get('State', {}).get('Running'): command(['docker', 'stop', '--time', '20', identifier])
        command(['docker', 'rm', identifier])
    networks = command(['docker', 'network', 'ls', '--filter', f'label=com.docker.compose.project={name}', '--format', '{{.ID}}']).splitlines()
    for identifier in networks:
        if not re.fullmatch(r'[a-f0-9]{12,64}', identifier): raise ValueError('Red inválida')
        network = json.loads(command(['docker', 'network', 'inspect', identifier]))[0]
        if (network.get('Labels') or {}).get('com.docker.compose.project') != name or network.get('Name') == 'proxy': continue
        if not network.get('Containers'): command(['docker', 'network', 'rm', identifier])
    for session in (name, name + '-claude', name + '-shell'):
        subprocess.run(['tmux', 'kill-session', '-t', '=' + session], capture_output=True, timeout=5)
    # La carpeta y el archivo conservan todos los datos del proyecto para restaurar.
    project.rename(archive / 'project')
    print('Proyecto retirado. Archivos recuperables en la papelera; volúmenes Docker conservados.', flush=True)


if __name__ == '__main__': main()
