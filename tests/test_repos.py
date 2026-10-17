import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from cm import config, projects, repos, tasks, tmux
from cm.util import read_json, write_json
from test_core import IsolatedConfig, load_script
from http_support import start_client, login_client

helper = load_script('repo_helper', 'cm-repo.py')


def git(*args, cwd=None):
    return subprocess.run(['git', *args], cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def remote_repo(root, branches=('main', 'diseno'), empty=False):
    """Repositorio «remoto» local: los tests nunca salen a la red."""
    bare = Path(root) / 'remote.git'
    git('init', '-q', '--bare', '-b', 'main', str(bare))
    if empty: return bare
    work = Path(root) / 'work'
    git('init', '-q', '-b', 'main', str(work))
    git('-C', str(work), 'config', 'user.email', 't@example.com'); git('-C', str(work), 'config', 'user.name', 'T')
    (work / 'README.md').write_text('# Repo existente\n')
    git('-C', str(work), 'add', '-A'); git('-C', str(work), 'commit', '-q', '-m', 'Primero')
    for branch in branches[1:]:
        git('-C', str(work), 'checkout', '-q', '-b', branch)
        (work / f'{branch}.txt').write_text(branch)
        git('-C', str(work), 'add', '-A'); git('-C', str(work), 'commit', '-q', '-m', f'Rama {branch}')
        git('-C', str(work), 'checkout', '-q', 'main')
    git('-C', str(work), 'push', '-q', str(bare), *branches)
    return bare


class RepoTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        self.tmp = Path(tempfile.mkdtemp(dir=config.CONFIG))

    def test_normalize_accepts_common_forms_and_prefers_ssh_for_github(self):
        cases = {
            'https://github.com/raulisai/poleana_game': ('git@github.com:raulisai/poleana_game.git', 'poleana_game'),
            'https://github.com/raulisai/cuidemonos.git/': ('git@github.com:raulisai/cuidemonos.git', 'cuidemonos'),
            'github.com/raulisai/app-x': ('git@github.com:raulisai/app-x.git', 'app-x'),
            'raulisai/cuidemonos': ('git@github.com:raulisai/cuidemonos.git', 'cuidemonos'),
            'git@github.com:raulisai/cuidemonos.git': ('git@github.com:raulisai/cuidemonos.git', 'cuidemonos'),
            'https://gitlab.com/grupo/sub/proyecto.git': ('https://gitlab.com/grupo/sub/proyecto.git', 'proyecto'),
            'ssh://git@git.example.com:2222/equipo/web.git': ('ssh://git@git.example.com:2222/equipo/web.git', 'web'),
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw): self.assertEqual(repos.normalize(f'  {raw} '), expected)
        self.assertEqual(repos.suggested_name('Poleana_Game.v2'), 'poleana-game-v2')

    def test_normalize_rejects_local_paths_transports_options_and_credentials(self):
        for raw in ['', 'file:///etc', '/srv/projects/alpha', '--upload-pack=touch /tmp/x', 'ext::sh -c id', 'https://user:token@github.com/a/b',
                    'https://ghp_x@github.com/a/b', 'http://example.com/a.git', 'git@github.com:a/../b.git', 'https://github.com/a/b c', 'a' * 400, 'x\n/y']:
            with self.subTest(raw=raw), self.assertRaises(repos.RepoError): repos.normalize(raw)
        for url in ['file:///etc/x', '-oProxyCommand=x', 'ext::sh', 'https://a/../b', 'git@h:x y']:
            with self.subTest(url=url): self.assertFalse(helper.valid_url(url))
        self.assertEqual(helper.handle({'op': 'check', 'url': 'file:///etc'})['ok'], False)

    def test_helper_parses_refs_and_explains_errors(self):
        text = 'ref: refs/heads/dev\tHEAD\nabc\tHEAD\nabc\trefs/heads/main\ndef\trefs/heads/dev\n'
        self.assertEqual(helper.parse_refs(text), ('dev', ['dev', 'main']))
        self.assertEqual(helper.parse_refs(''), ('', []))
        self.assertIn('no existe', helper.explain('ERROR: Repository not found.\nfatal: Could not read from remote repository.'))
        self.assertIn('SSH', helper.explain('git@github.com: Permission denied (publickey).'))
        self.assertIn('rama', helper.explain('warning: Remote branch nope not found in upstream origin'))

    def test_helper_only_clones_into_an_empty_staging_dir_inside_projects(self):
        root = config.PROJECTS
        staging = Path(tempfile.mkdtemp(prefix='.nuevo-creating-', dir=root))
        self.assertEqual(helper.safe_dir(root, 'nuevo', staging.name), staging.resolve())
        for name, folder in [('nuevo', '../config'), ('nuevo', '.otro-creating-x'), ('Mal', staging.name), ('cmj-x', '.cmj-x-creating-a')]:
            with self.subTest(folder=folder), self.assertRaises(ValueError): helper.safe_dir(root, name, folder)
        (root / 'enlace').symlink_to(config.CONFIG, target_is_directory=True)
        with self.assertRaises(ValueError): helper.safe_dir(root, 'enlace', '')
        bare = remote_repo(self.tmp)
        with patch.object(helper, 'valid_url', return_value=True), \
             patch.object(helper, 'git', side_effect=lambda args, timeout: (subprocess.run(['git', *args[:-2], str(bare), args[-1]], capture_output=True).returncode, '', '')):
            result = helper.handle({'op': 'clone', 'url': 'git@github.com:a/b.git', 'projects_root': str(root), 'name': 'nuevo', 'staging': staging.name})
            self.assertEqual(result, {'ok': True})
            self.assertFalse(helper.handle({'op': 'clone', 'url': 'git@github.com:a/b.git', 'projects_root': str(root), 'name': 'nuevo', 'staging': staging.name})['ok'])

    def test_host_op_round_trip_cleanup_and_dead_process(self):
        def fake_host(name, cwd, argv):
            folder = Path(argv[-1])
            request = read_json(folder / 'request.json', {})
            write_json(folder / 'result.json', {'ok': True, 'default_branch': 'main', 'branches': ['main', 'dev'], 'echo': request['url']})
            return True, ''
        with patch.object(config, 'host_path', side_effect=str), patch.object(tmux, 'new_session', side_effect=fake_host):
            result = repos.check('raulisai/cuidemonos')
        self.assertEqual((result['url'], result['suggested'], result['branches']), ('git@github.com:raulisai/cuidemonos.git', 'cuidemonos', ['main', 'dev']))
        self.assertEqual(list((config.CONFIG / 'repo-ops').iterdir()), [])
        with patch.object(tmux, 'new_session', return_value=(True, '')), patch.object(tmux, 'has_session', return_value=False), \
             patch.object(repos.time, 'monotonic', side_effect=[0, 0, 10, 10, 10]), self.assertRaises(repos.RepoError):
            repos.host_op({'op': 'check', 'url': 'git@github.com:a/b.git'}, 50)

    def fake_clone(self, bare):
        return lambda url, staging, name, branch='': git('clone', '-q', *(['--branch', branch] if branch else []), str(bare), str(staging))

    def test_import_keeps_history_and_branches_without_scaffold(self):
        bare = remote_repo(self.tmp)
        with patch.object(repos, 'clone', side_effect=self.fake_clone(bare)):
            ok, message, info = projects.import_project('importado', 'https://github.com/raulisai/repo-existente', 'diseno')
        self.assertTrue(ok, message)
        target = config.PROJECTS / 'importado'
        self.assertEqual((info['branch'], info['empty'], info['compose'], info['url']), ('diseno', False, False, 'git@github.com:raulisai/repo-existente.git'))
        self.assertTrue((target / 'diseno.txt').exists())
        self.assertFalse((target / 'compose.yaml').exists())
        self.assertIn('origin/main', git('-C', str(target), 'branch', '-r'))
        self.assertEqual([p.name for p in config.PROJECTS.iterdir() if p.name.startswith('.')], [])
        self.assertIn('importado', projects.project_names())
        prompt = projects.import_prompt('importado', info['url'], info['branch'], 'Cambia el título')
        for text in ('No partas de cero', 'Cambia el título', 'Host(`importado.', 'No hagas push'):
            self.assertIn(text, prompt)

    def test_empty_repo_gets_scaffold_and_failures_leave_nothing(self):
        bare = remote_repo(self.tmp, empty=True)
        with patch.object(repos, 'clone', side_effect=self.fake_clone(bare)):
            ok, message, info = projects.import_project('vacio', 'git@github.com:raulisai/vacio.git', '', 'Mi idea')
        self.assertTrue(ok, message)
        self.assertTrue(info['empty'] and info['compose'])
        self.assertEqual(git('-C', str(config.PROJECTS / 'vacio'), 'log', '--format=%s'), 'Scaffold inicial desde Codex Manager')
        with patch.object(repos, 'clone', side_effect=repos.RepoError('El repositorio no existe o esta cuenta no tiene acceso')):
            self.assertEqual(projects.import_project('falla', 'raulisai/nada')[:2], (False, 'El repositorio no existe o esta cuenta no tiene acceso'))
        self.assertFalse(projects.import_project('alpha', 'raulisai/x')[0])
        self.assertFalse(projects.import_project('rama', 'raulisai/x', '../main')[0])
        self.assertEqual([p.name for p in config.PROJECTS.iterdir() if p.name.startswith('.')], [])

    def test_github_token_is_validated_encrypted_and_used_to_create_private_repo(self):
        with self.assertRaises(repos.RepoError): repos.github_connect('no-es-un-token')
        token = 'github_pat_' + 'A1' * 20
        with patch.object(repos, '_api', return_value=(401, {}, {})), self.assertRaises(repos.RepoError): repos.github_connect(token)
        with patch.object(repos, '_api', return_value=(200, {'login': 'raulisai'}, {'X-OAuth-Scopes': 'read:user'})), self.assertRaises(repos.RepoError):
            repos.github_connect('ghp_' + 'b' * 36)
        with patch.object(repos, '_api', return_value=(200, {'login': 'raulisai'}, {})):
            self.assertEqual(repos.github_connect(token)['login'], 'raulisai')
        stored = (config.CONFIG / 'github.json')
        self.assertNotIn(token, stored.read_text())
        self.assertEqual(stored.stat().st_mode & 0o077, 0)
        self.assertEqual(repos._token(), token)
        self.assertTrue(projects.create_project('nuevo', 'Mi tienda')[0])
        calls = []
        def api(method, path, used, body=None):
            calls.append((method, path, used, body))
            return 201, {'full_name': 'raulisai/nuevo', 'ssh_url': 'git@github.com:raulisai/nuevo.git', 'html_url': 'https://github.com/raulisai/nuevo'}, {}
        with patch.object(repos, '_api', side_effect=api), patch.object(repos, 'push') as push:
            ok, message, _ = projects.publish_github('nuevo', 'Mi tienda')
        self.assertTrue(ok, message)
        self.assertEqual(calls[0][:3], ('POST', '/user/repos', token))
        self.assertEqual((calls[0][3]['name'], calls[0][3]['private']), ('nuevo', True))
        push.assert_called_once_with('nuevo')
        self.assertEqual(git('-C', str(config.PROJECTS / 'nuevo'), 'remote', 'get-url', 'origin'), 'git@github.com:raulisai/nuevo.git')
        with patch.object(repos, '_api', return_value=(422, {'message': 'exists'}, {})):
            ok, message, _ = projects.publish_github('beta')
        self.assertFalse(ok); self.assertIn('Ya existe', message)
        repos.github_disconnect()
        self.assertFalse(repos.github_status()['connected'])
        self.assertIn('Conecta GitHub', projects.publish_github('nuevo')[1])


class RepoHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)

    async def test_endpoints_require_session_and_origin(self):
        for method, path in [('get', '/api/github'), ('post', '/api/github'), ('post', '/api/projects/repo-check')]:
            self.assertEqual((await getattr(self.client, method)(path, json={})).status, 401)
        await login_client(self)
        self.assertEqual((await self.client.post('/api/github', json={'token': 'x'}, headers={'Origin': 'https://evil.example'})).status, 403)
        response = await self.client.post('/api/projects/repo-check', json={'url': 'file:///etc/passwd'})
        self.assertEqual(response.status, 422)
        self.assertEqual((await (await self.client.get('/api/github')).json())['connected'], False)

    async def test_import_queues_adaptation_without_blind_deploy(self):
        await login_client(self)
        info = {'url': 'git@github.com:raulisai/existente.git', 'repo': 'existente', 'branch': 'main', 'empty': False, 'compose': True}
        with patch.object(projects, 'import_project', return_value=(True, 'Proyecto importado', info)) as imported, \
             patch('cm.runs.start_job') as deploy, patch.object(projects, 'project_names', return_value=['importado', 'alpha', 'beta']):
            response = await self.client.post('/api/projects', json={'action': 'create', 'name': 'importado', 'repo_url': 'raulisai/existente',
                                                                     'repo_branch': 'main', 'provider': 'codex', 'deploy': True, 'build': True})
        self.assertEqual(response.status, 201, await response.text())
        imported.assert_called_once_with('importado', 'raulisai/existente', 'main', '')
        deploy.assert_not_called()
        task = tasks.task_records()[0]
        self.assertEqual((task['project'], task['origin'], task['priority']), ('importado', 'create', 'alta'))
        self.assertIn('No partas de cero', task['details'])

    async def test_new_project_with_github_option(self):
        await login_client(self)
        with patch.object(projects, 'publish_github', return_value=(True, 'Repo privado raulisai/nuevo creado en GitHub y subido', {})) as publish, \
             patch('cm.runs.start_job', return_value=(True, 'ok', 'job')):
            response = await self.client.post('/api/projects', json={'action': 'create', 'name': 'nuevo', 'description': '', 'github': True, 'build': False})
        self.assertEqual(response.status, 201, await response.text())
        self.assertIn('raulisai/nuevo', (await response.json())['message'])
        publish.assert_called_once_with('nuevo', '')
