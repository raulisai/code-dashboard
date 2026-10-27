#!/usr/bin/env python3
"""Integración HTTPS local y proceso hijo real, con agente falso y repos temporales.

Ejemplo: python tools/verify_workstation_bridge.py --desktop ../utilizetokens
No conecta al VPS, no usa cuentas reales y no consume cupo de modelos.
"""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
from unittest.mock import patch
import urllib.request

from aiohttp.test_utils import TestServer
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from cm import config, workstations


def certificate(folder):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(minutes=30))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),
                       x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
        .sign(key, hashes.SHA256()))
    cert_file, key_file = folder / 'cert.pem', folder / 'key.pem'
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.load_cert_chain(cert_file, key_file)
    return server, ssl.create_default_context(cafile=str(cert_file))


async def verify(desktop):
    sys.path.insert(0, str(desktop))
    from estadoia import connector, util
    with tempfile.TemporaryDirectory(prefix='cm-bridge-') as tmp:
        root = Path(tmp)
        project = root / 'app'
        project.mkdir()
        environment = {**os.environ, 'ESTADO_IA_CONFIG_DIR': str(root / 'local-config'),
            'ESTADO_IA_STATE_DIR': str(root / 'local-state'), 'PYTHONUTF8': '1',
            'GIT_AUTHOR_NAME': 'Prueba', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
            'GIT_COMMITTER_NAME': 'Prueba', 'GIT_COMMITTER_EMAIL': 'test@example.invalid'}
        for command in (['git', 'init', '-q'], ['git', 'symbolic-ref', 'HEAD', 'refs/heads/main']):
            subprocess.run(command, cwd=project, env=environment, check=True)
        (project / 'base.txt').write_text('original\n')
        (project / 'test_base.py').write_text('import unittest\nclass BaseTest(unittest.TestCase):\n def test_base(self): self.assertEqual(1 + 1, 2)\n')
        subprocess.run(['git', 'add', '.'], cwd=project, env=environment, check=True)
        subprocess.run(['git', 'commit', '-qm', 'inicial'], cwd=project, env=environment, check=True)
        initial = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project).decode().strip()
        bootstrap = root / 'fake_agent_bootstrap.py'
        bootstrap.write_text(
            'import sys\n'
            f'sys.path.insert(0, {str(desktop)!r})\n'
            'from estadoia import agentes, ciclo, connector_job\n'
            "ciclo.read_quota = lambda *a, **k: dict(estado='ok', restante_5h=90, restante_semanal=90, texto='simulado')\n"
            'def fake(agent, worktree, prompt, *args, **kwargs):\n'
            "    (worktree / 'feature.py').write_text('def feature(): return 1\\n')\n"
            "    (worktree / 'test_feature.py').write_text('import unittest\\nfrom feature import feature\\nclass FeatureTest(unittest.TestCase):\\n def test_feature(self): self.assertEqual(feature(), 1)\\n')\n"
            "    return 'TITULO: Función implementada\\nValidación: prueba local', {}\n"
            "agentes.RUNNERS['claude'] = fake\n"
            'raise SystemExit(connector_job.execute(sys.argv[1]))\n', encoding='utf-8')
        server_ssl, client_ssl = certificate(root)
        original_init = connector.Transport.__init__
        def trusted_init(self, server, token=None):
            original_init(self, server, token)
            self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), connector.NoRedirect(),
                urllib.request.HTTPSHandler(context=client_ssl))
        original_popen = subprocess.Popen
        def launch(command, *args, **kwargs):
            if isinstance(command, list) and '--connector-job' in command:
                command = [sys.executable, '-u', str(bootstrap), command[-1]]
            return original_popen(command, *args, **kwargs)
        with patch.dict(os.environ, environment), \
                patch.multiple(config, CONFIG=root / 'server-config', SECRET_FILE=root / 'server-config/.secret',
                               USER='test', PASSWORD='unit-only-password', PUBLIC_ORIGIN=''), \
                patch.object(connector.Transport, '__init__', trusted_init), \
                patch.object(subprocess, 'Popen', launch):
            server = TestServer(app.make_app(), scheme='https')
            await server.start_server(ssl=server_ssl)
            try:
                url = str(server.make_url('/')).rstrip('/')
                enrollment = workstations.create_enrollment('PC de prueba', ['android'])
                pair = await asyncio.to_thread(connector.pair, url, enrollment['code'])
                util.write_json_atomic(root / 'local-config/config.json', {'correo': {'para': ''}, 'proyectos': [
                    {'ruta': str(project), 'fetch': False, 'preparar': None, 'lint': None,
                     'test': f'{sys.executable} -m unittest discover -q'}]})
                util.write_json_atomic(connector.settings_path(), {**connector.DEFAULTS,
                    'server': url, 'projects': {'android': 'app'}, 'max_minutes': 1})
                job = workstations.enqueue(pair['device_id'], 'android', 'claude', 'Implementa feature con su prueba', 'integration-key-0001')
                secret = connector.load_secret(url)
                worker = connector.Worker()
                worker.options = connector.load_settings()
                worker.device_id = pair['device_id']
                worker.transport = connector.Transport(url, secret['token'])
                approvals = []
                def approve(request):
                    approvals.append(request['id'])
                    worker.approve(request['id'], True)
                worker.request_approval = approve
                claim = await asyncio.to_thread(worker.transport.request, 'poll', {'projects': ['android']})
                await asyncio.to_thread(worker.perform, claim['job'])
                records = workstations.overview()['jobs']
                assert records[0]['id'] == job['id'] and records[0]['status'] == 'completed', records
                assert approvals == [job['id']]
                assert 'test: pasa' in records[0]['result']['validation'], [
                    {k: util.read_json(p).get(k) for k in ('antes', 'despues', 'veredictos')}
                    for p in (root / 'local-state/runs').glob('*/resultado.json')]
                assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project).decode().strip() == initial
                assert not (project / 'feature.py').exists()
                assert not util.read_json(worker.journal)
                print(json.dumps({'https': 'verified', 'local_approvals': len(approvals), 'job': 'completed',
                    'branch': records[0]['result']['branch'], 'validation': records[0]['result']['validation'],
                    'working_copy': 'unchanged', 'outbox': 'acknowledged'}, ensure_ascii=False, indent=2))
            finally:
                await server.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--desktop', required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(verify(args.desktop.resolve()))
