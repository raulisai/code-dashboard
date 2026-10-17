"""Catálogo saneado exportado por los CLI, nunca credenciales ni prompts internos."""
from . import config
from .util import read_json

LEVELS = ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')


def catalog():
    data = read_json(config.CONFIG / 'model-catalog.json', {})
    return {key: data.get(key, [] if key in config.PROVIDERS else {}) for key in ('codex', 'claude', 'defaults', 'updated_at')}


def supported_efforts(provider, model=''):
    data = catalog()
    from . import runs
    selected = model or runs.load_settings().get(f'{provider}_model') or data['defaults'].get(provider, '')
    row = next((row for row in data.get(provider, []) if selected in (row['id'], row.get('resolved'))), {})
    return [level for level in row.get('efforts', []) if level in LEVELS]
