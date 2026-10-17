"""Archiva solo la papelera y jobs de cm-voice-check-20261017 en /archive."""
import json
import shutil
from pathlib import Path

PROJECT = 'cm-voice-check-20261017'
projects = Path('/projects')
config = Path('/config')
archive = Path('/archive')
assert archive.is_dir() and not (projects / PROJECT).exists(), 'Primero termina la prueba de eliminación'
for folder in (projects / '.cm-trash').iterdir():
    if not folder.is_dir() or folder.is_symlink(): continue
    try: meta = json.loads((folder / 'meta.json').read_text())
    except (OSError, ValueError): continue
    if meta.get('project') != PROJECT: continue
    destination = archive / 'trash' / folder.name
    destination.parent.mkdir(exist_ok=True)
    assert not destination.exists()
    shutil.move(str(folder), str(destination))
for folder in (config / 'jobs').iterdir():
    if not folder.is_dir(): continue
    try: meta = json.loads((folder / 'meta.json').read_text())
    except (OSError, ValueError): continue
    if meta.get('project') != PROJECT: continue
    assert (folder / 'exit.json').is_file(), 'Hay una prueba aún activa'
    destination = archive / 'jobs' / folder.name
    destination.parent.mkdir(exist_ok=True)
    assert not destination.exists()
    shutil.move(str(folder), str(destination))
operation = config / 'project-operations' / (PROJECT + '.json')
if operation.exists(): shutil.move(str(operation), str(archive / 'test-project-operation.json'))
print('VOICE_VALIDATION_ARCHIVED: solo artefactos de prueba, sin borrar proyectos ajenos')
