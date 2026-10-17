#!/usr/bin/env python3
"""Exporta solo metadatos de modelos de los CLI del host, sin ejecutar turnos."""
import json, os, subprocess, tempfile, tomllib
from datetime import datetime, timezone
from pathlib import Path


def refresh():
    home = Path.home()
    codex = json.loads((home / '.codex/models_cache.json').read_text())
    request = {'type': 'control_request', 'request_id': 'cm-models', 'request': {'subtype': 'initialize'}}
    result = subprocess.run([str(home / '.local/bin/claude'), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
                            input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=30)
    if result.returncode: raise RuntimeError('Claude no pudo consultar su catálogo')
    claude = []
    for line in result.stdout.splitlines():
        try: row = json.loads(line)
        except ValueError: continue
        if row.get('type') == 'control_response':
            claude = row.get('response', {}).get('response', {}).get('models', [])
    if not claude: raise RuntimeError('Claude no devolvió modelos; se conserva el catálogo anterior')
    try: config = tomllib.loads((home / '.codex/config.toml').read_text())
    except (OSError, ValueError): config = {}
    catalog = {'updated_at': datetime.now(timezone.utc).isoformat(), 'codex': [], 'claude': [], 'defaults': {'codex': config.get('model', '')}}
    for row in codex.get('models', []):
        if row.get('visibility') != 'list': continue
        catalog['codex'].append({'id': row['slug'], 'name': row.get('display_name', row['slug']),
            'efforts': [level['effort'] for level in row.get('supported_reasoning_levels', [])], 'default_effort': row.get('default_reasoning_level', '')})
    for row in claude:
        if row['value'] == 'default':
            catalog['defaults']['claude'] = row.get('resolvedModel', '')
        catalog['claude'].append({'id': row.get('resolvedModel') if row['value'] == 'default' else row['value'],
            'resolved': row.get('resolvedModel', ''), 'name': row.get('displayName', row['value']),
            'efforts': row.get('supportedEffortLevels', []) if row.get('supportsEffort') else []})
    if not catalog['codex']: raise RuntimeError('Codex no devolvió modelos visibles')
    target = home / '.config/codex-automation/model-catalog.json'
    fd, tmp = tempfile.mkstemp(prefix='.models-', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as handle: json.dump(catalog, handle, ensure_ascii=False)
        os.chmod(tmp, 0o600); os.replace(tmp, target)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    print('Catálogo actualizado:', len(catalog['codex']), 'Codex,', len(catalog['claude']), 'Claude')

if __name__ == '__main__': refresh()
