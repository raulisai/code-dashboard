"""Versionador: commit por acción, historial, deshacer, restaurar, revertir y ramas."""
import json
import subprocess
import time
import unittest
from unittest.mock import patch
from cm import config, gitops, runs, tasks, vcs
from cm.util import write_json
from test_core import IsolatedConfig, runner
from http_support import start_client, login_client


def sh(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout


class VersionTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        self.root = config.PROJECTS / 'alpha'

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def save(self, name, text, subject=None):
        self.write(name, text)
        return gitops.record('alpha', subject or f'Editar {name}', 'edit')['sha']

    def subjects(self):
        return [c['subject'] for c in gitops.log('alpha')['commits']]

    def test_first_action_creates_repo_without_secrets_or_dependencies(self):
        self.write('index.html', 'hola'); self.write('.env', 'TOKEN=secreto'); self.write('.env.example', 'TOKEN=')
        self.write('node_modules/x/index.js', 'x'); self.write('dist/app.js', 'build'); self.write('.claude/settings.local.json', '{}')
        result = gitops.record('alpha', 'Editar index.html', 'edit')
        self.assertTrue(result['sha'], result)
        tracked = sh(self.root, 'ls-files').split()
        self.assertEqual(sorted(tracked), ['.env.example', 'index.html'])
        self.assertEqual(self.subjects(), ['Versión inicial del proyecto'])
        self.assertEqual(gitops.log('alpha')['commits'][0]['action'], 'init')
        self.assertEqual(gitops.record('alpha', 'Nada', 'edit')['sha'], '')

    def test_each_action_is_its_own_commit_and_pending_changes_are_separate(self):
        self.save('a.txt', 'uno')
        self.write('b.txt', 'hecho en la terminal')
        gitops.versioned('alpha', 'Editar a.txt', 'edit', lambda: self.write('a.txt', 'dos'))
        commits = gitops.log('alpha')['commits']
        self.assertEqual([c['subject'] for c in commits[:2]], ['Editar a.txt', 'Cambios pendientes antes de: Editar a.txt'])
        self.assertEqual([c['action'] for c in commits[:2]], ['edit', 'pending'])
        self.assertTrue(commits[0]['current']); self.assertEqual(commits[0]['files'], 1)
        self.assertEqual(sh(self.root, 'status', '--porcelain'), '')

    def test_auto_commit_can_be_disabled(self):
        runs.save_settings({'auto_commit': 'off'})
        self.write('a.txt', 'uno')
        self.assertEqual(gitops.record('alpha', 'Editar', 'edit')['sha'], '')
        self.assertFalse((self.root / '.git').exists())
        self.assertFalse(runs.save_settings({'auto_commit': 'quizá'})[0])

    def test_undo_walks_back_one_version_at_a_time_and_keeps_history(self):
        self.save('a.txt', 'v1'); self.save('a.txt', 'v2'); self.save('b.txt', 'v3')
        self.write('.env', 'NO_TOCAR')
        status = gitops.status('alpha')
        self.assertEqual(status['undo']['subject'], 'Editar a.txt')
        self.assertTrue(gitops.undo('alpha')[0])
        self.assertFalse((self.root / 'b.txt').exists())
        self.assertEqual((self.root / 'a.txt').read_text(), 'v2')
        self.assertTrue(gitops.undo('alpha')[0])
        self.assertEqual((self.root / 'a.txt').read_text(), 'v1')
        self.assertEqual((self.root / '.env').read_text(), 'NO_TOCAR')
        commits = gitops.log('alpha')['commits']
        self.assertEqual(commits[0]['action'], 'undo'); self.assertTrue(commits[0]['restores'])
        self.assertIn('Editar b.txt', [c['subject'] for c in commits])  # lo deshecho sigue en el historial
        with self.assertRaisesRegex(vcs.VersionError, 'anterior'): gitops.undo('alpha')  # v1 es la primera versión

    def test_undo_with_unsaved_changes_discards_them_but_keeps_them_in_history(self):
        self.save('a.txt', 'v1'); self.save('a.txt', 'v2')
        self.write('a.txt', 'a medias'); self.write('nuevo.txt', 'terminal')
        target = gitops.status('alpha')['undo']
        self.assertTrue(target['pending']); self.assertEqual(target['subject'], 'Editar a.txt')
        ok, message, sha = gitops.undo('alpha')
        self.assertTrue(ok, message); self.assertIn('Editar a.txt', message)
        self.assertEqual((self.root / 'a.txt').read_text(), 'v2'); self.assertFalse((self.root / 'nuevo.txt').exists())
        self.assertEqual(gitops.show('alpha', sha)['subject'], 'Deshacer cambios sin guardar')
        saved = gitops.log('alpha')['commits'][1]
        self.assertEqual(saved['action'], 'pending')
        self.assertTrue(gitops.restore('alpha', saved['sha'])[0])  # y se pueden recuperar
        self.assertEqual((self.root / 'a.txt').read_text(), 'a medias')

    def test_restore_any_version_and_come_back(self):
        first = self.save('a.txt', 'v1'); self.save('a.txt', 'v2'); last = self.save('c.txt', 'v3')
        ok, message, sha = gitops.restore('alpha', first[:7])
        self.assertTrue(ok, message); self.assertEqual((self.root / 'a.txt').read_text(), 'v1')
        self.assertFalse((self.root / 'c.txt').exists())
        row = gitops.show('alpha', sha)
        self.assertEqual(row['action'], 'restore'); self.assertEqual(row['restores'], first)
        self.assertEqual(gitops.restore('alpha', first)[1], 'El proyecto ya estaba en esa versión')
        self.assertTrue(gitops.restore('alpha', last)[0])
        self.assertEqual((self.root / 'c.txt').read_text(), 'v3')
        self.assertTrue(gitops.show('alpha', first)['contained'])
        for bad in ('--all', 'HEAD~1', 'main;rm', 'zzzz'):
            with self.subTest(rev=bad), self.assertRaises(vcs.VersionError): gitops.restore('alpha', bad)

    def test_restore_keeps_a_copy_of_ignored_files_it_would_overwrite(self):
        self.save('a.txt', 'v1')
        self.write('config.local', 'antiguo'); sh(self.root, 'add', 'config.local'); sh(self.root, 'commit', '-qm', 'con config')
        old = sh(self.root, 'rev-parse', 'HEAD').strip()
        sh(self.root, 'rm', '-q', '--cached', 'config.local'); self.write('.gitignore', 'config.local\n')
        self.write('config.local', 'ACTUAL'); gitops.record('alpha', 'Dejar de versionar config', 'edit')
        ok, message, _ = gitops.restore('alpha', old)
        self.assertTrue(ok); self.assertIn('copia de 1 archivo', message)
        backups = list((self.root / '.git/codex-manager/respaldos').glob('*/config.local'))
        self.assertEqual([p.read_text() for p in backups], ['ACTUAL'])

    def test_revert_only_one_change_and_conflicts_leave_repo_clean(self):
        self.save('a.txt', 'a'); middle = self.save('b.txt', 'b'); self.save('c.txt', 'c')
        ok, message, sha = gitops.revert('alpha', middle)
        self.assertTrue(ok, message)
        self.assertFalse((self.root / 'b.txt').exists()); self.assertTrue((self.root / 'c.txt').exists())
        self.assertEqual(gitops.show('alpha', sha)['reverts'], middle)
        edit = self.save('a.txt', 'a2'); self.save('a.txt', 'a3')
        with self.assertRaisesRegex(vcs.VersionError, 'choca'): gitops.revert('alpha', edit)
        self.assertEqual(vcs.operation_in_progress(self.root), '')
        self.assertEqual(sh(self.root, 'status', '--porcelain'), '')
        self.assertEqual((self.root / 'a.txt').read_text(), 'a3')

    def test_branches_are_alternatives_that_can_be_switched_merged_and_deleted(self):
        first = self.save('a.txt', 'base'); self.save('a.txt', 'main 2')
        ok, message = gitops.create_branch('alpha', 'idea/azul', first[:7])
        self.assertTrue(ok, message); self.assertEqual(vcs.branch(self.root), 'idea/azul')
        self.assertEqual((self.root / 'a.txt').read_text(), 'base')
        self.save('azul.css', 'body{color:blue}')
        data = gitops.branches('alpha')
        main = next(b for b in data['branches'] if b['name'] == 'main')
        self.assertEqual(data['current'], 'idea/azul'); self.assertEqual((main['ahead'], main['behind']), (1, 1))
        self.assertTrue(gitops.switch('alpha', 'main')[0])
        self.assertFalse((self.root / 'azul.css').exists())
        only = [c for c in gitops.log('alpha', 'idea/azul')['commits'] if c['only_here']]
        self.assertEqual([c['subject'] for c in only], ['Editar azul.css'])
        ok, message = gitops.merge('alpha', 'idea/azul')
        self.assertTrue(ok, message); self.assertTrue((self.root / 'azul.css').exists())
        self.assertEqual(gitops.log('alpha')['commits'][0]['action'], 'merge')
        self.assertIn('ya estaba integrada', gitops.merge('alpha', 'idea/azul')[1])
        ok, message = gitops.delete_branch('alpha', 'idea/azul')
        self.assertTrue(ok); self.assertNotIn('idea/azul', gitops.branch_names(self.root))
        self.assertTrue(sh(self.root, 'for-each-ref', 'refs/codex-manager/archivadas/').strip())
        for bad in ('-x', 'a..b', 'HEAD', 'con espacio', 'x.lock', '/x'):
            with self.subTest(name=bad), self.assertRaises(vcs.VersionError): gitops.create_branch('alpha', bad)
        with self.assertRaises(vcs.VersionError): gitops.delete_branch('alpha', 'main')

    def test_merge_conflict_is_aborted(self):
        self.save('a.txt', 'base')
        gitops.create_branch('alpha', 'otra'); self.save('a.txt', 'otra')
        gitops.switch('alpha', 'main'); self.save('a.txt', 'principal')
        with self.assertRaisesRegex(vcs.VersionError, 'a.txt'): gitops.merge('alpha', 'otra')
        self.assertEqual(vcs.operation_in_progress(self.root), '')
        self.assertEqual((self.root / 'a.txt').read_text(), 'principal')

    def test_tree_changes_wait_for_running_agents(self):
        self.save('a.txt', 'v1'); self.save('a.txt', 'v2')
        tasks.save_tasks([self.task(status='working')])
        with self.assertRaisesRegex(vcs.VersionError, 'agente'): gitops.undo('alpha')
        self.assertEqual((self.root / 'a.txt').read_text(), 'v2')
        self.assertIn('agente', gitops.status('alpha')['blocked'])

    def test_large_files_are_not_versioned(self):
        with patch.object(vcs, 'LARGE_FILE', 10):
            self.write('small.txt', 'x'); self.write('video.bin', 'y' * 50)
            gitops.record('alpha', 'Subir', 'upload')
        self.assertEqual(sh(self.root, 'ls-files').split(), ['small.txt'])
        self.assertIn('/video.bin', (self.root / '.git/info/exclude').read_text())

    def test_versioning_does_not_run_repository_programs(self):
        self.save('a.txt', 'one')
        marker = config.CONFIG / 'executed'
        script = config.CONFIG / 'spy.sh'
        script.write_text(f'#!/bin/sh\ntouch {marker}\ncat "$1" 2>/dev/null\n'); script.chmod(0o755)
        sh(self.root, 'config', 'diff.spy.textconv', str(script)); sh(self.root, 'config', 'diff.external', str(script))
        sh(self.root, 'config', 'core.fsmonitor', str(script))
        self.write('.gitattributes', '*.txt diff=spy\n'); self.save('a.txt', 'two')
        gitops.log('alpha'); gitops.show('alpha', 'HEAD'); gitops.diff('alpha', rev='HEAD'); gitops.status('alpha'); gitops.undo('alpha')
        self.assertFalse(marker.exists())

    def test_runner_saves_a_version_before_and_after_the_agent(self):
        self.save('a.txt', 'v1'); self.write('manual.txt', 'terminal')
        meta = self.run_meta(versioning=True, title='Cambia el color', chat_id='main')
        folder = config.RUNS / meta['id']
        (folder / 'prompt.txt').write_text('Cambia el color a azul')
        runner.version(meta, folder, 'before')
        self.write('a.txt', 'azul')
        (folder / 'events.jsonl').write_text(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'Listo, ahora es azul'}}) + '\n')
        runner.version(meta, folder, 'after')
        saved = json.loads((folder / 'versions.json').read_text())
        commits = gitops.log('alpha')['commits']
        self.assertEqual(commits[0]['subject'], 'Codex: Cambia el color'); self.assertEqual(commits[0]['run'], meta['id'])
        self.assertEqual(commits[1]['subject'], 'Cambios pendientes antes de Codex')
        self.assertEqual(saved['commit'], commits[0]['sha']); self.assertEqual(saved['base'], commits[1]['sha'])
        self.assertIn('Listo, ahora es azul', gitops.show('alpha', saved['commit'])['body'])
        self.assertEqual(runs.describe_run(meta, full=False)['version']['commit'], saved['commit'])
        runner.version({**meta, 'versioning': False}, folder, 'after')  # desactivado: no toca nada
        self.assertEqual(json.loads((folder / 'versions.json').read_text()), saved)

    def test_deploy_records_the_published_version(self):
        (self.root / 'compose.yaml').write_text('services: {}\n'); self.save('a.txt', 'v1')
        self.write('a.txt', 'v2 sin guardar')
        with patch.object(runs.tmux, 'new_session', return_value=(True, '')), patch.object(runs.tmux, 'has_session', return_value=False):
            ok, message, job_id = runs.start_job('alpha', 'deploy')
        self.assertTrue(ok, message)
        head = vcs.head(self.root)
        self.assertEqual(runs.job_meta(job_id)['commit'], head)
        write_json(config.JOBS / job_id / 'exit.json', {'code': 0, 'finished_at': time.time()})
        self.assertEqual(gitops.status('alpha')['deployed']['sha'], head)
        self.assertTrue(gitops.log('alpha')['commits'][0]['production'])


class VersionHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate()
        self.client = await start_client(self)
        self.root = config.PROJECTS / 'alpha'

    async def test_history_restore_and_branch_api(self):
        self.assertEqual((await self.client.get('/api/git/log?project=alpha')).status, 401)
        await login_client(self)
        for text in ('v1', 'v2'):
            (self.root / 'a.txt').write_text(text); gitops.record('alpha', f'Editar {text}', 'edit')
        log = await (await self.client.get('/api/git/log?project=alpha')).json()
        self.assertEqual([c['subject'] for c in log['commits']], ['Editar v2', 'Versión inicial del proyecto'])
        detail = await (await self.client.get(f"/api/git/commit?project=alpha&rev={log['commits'][0]['sha']}")).json()
        self.assertEqual(detail['changes'][0]['path'], 'a.txt'); self.assertEqual(detail['changes'][0]['added'], 1)
        diff = await (await self.client.get(f"/api/git/diff?project=alpha&rev={log['commits'][1]['sha']}&compare=1")).json()
        self.assertIn('-v2', diff['diff'])
        self.assertEqual((await self.client.get('/api/git/commit?project=alpha&rev=--output=x')).status, 404)
        with patch.object(runs, 'start_job', return_value=(True, 'Desplegar: en curso', 'job1')) as start:
            response = await self.client.post('/api/git', json={'project': 'alpha', 'action': 'undo', 'deploy': True})
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual((await response.json())['job_id'], 'job1'); start.assert_called_once_with('alpha', 'deploy')
        self.assertEqual((self.root / 'a.txt').read_text(), 'v1')
        response = await self.client.post('/api/git', json={'project': 'alpha', 'action': 'branch-create', 'name': 'prueba'})
        self.assertEqual(response.status, 200, await response.text())
        branches = await (await self.client.get('/api/git/branches?project=alpha')).json()
        self.assertEqual(branches['current'], 'prueba')
        self.assertEqual((await self.client.post('/api/git', json={'project': 'alpha', 'action': 'switch', 'name': 'nope'})).status, 409)
        self.assertEqual((await self.client.post('/api/git', json={'project': 'alpha', 'action': 'raro'})).status, 409)
        self.assertEqual((await self.client.post('/api/git', headers={'Origin': 'https://otro.devdj.lat'}, json={'project': 'alpha', 'action': 'undo'})).status, 403)

    async def test_editor_and_file_actions_create_commits(self):
        await login_client(self)
        response = await self.client.post('/api/files/write', json={'project': 'alpha', 'path': 'web/index.html', 'content': '<h1>Hola</h1>'})
        self.assertEqual(response.status, 200, await response.text())
        await self.client.post('/api/files/op', json={'project': 'alpha', 'action': 'rename', 'path': 'web/index.html', 'to': 'web/home.html'})
        subjects = [c['subject'] for c in gitops.log('alpha')['commits']]
        self.assertEqual(subjects[:2], ['Mover web/index.html → web/home.html', 'Versión inicial del proyecto'])
