import base64
import importlib.util
import json
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from cm import auth, config, dockerapi, files, projects, runs, tasks, tmux
from cm.util import write_json

ROOT = Path(__file__).resolve().parents[1]


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bin' / filename)
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'argv', [filename, '/tmp/cm-unit-unused']): spec.loader.exec_module(module)
    return module


approval = load_script('approval', 'cm-approval-mcp.py')
runner = load_script('runner', 'cm-runner.py')


class IsolatedConfig:
    def isolate(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        values = {'CONFIG': root / 'config', 'PROJECTS': root / 'projects', 'USER': 'tester', 'PASSWORD': 'unit-password'}
        for key, filename in {'TASKS': 'tasks.tsv', 'RUNS': 'runs', 'JOBS': 'jobs', 'SESSIONS_FILE': 'agent-sessions.json',
                              'SETTINGS_FILE': 'settings.json', 'RULES_FILE': 'approval-rules.json', 'SECRET_FILE': '.cm-secret',
                              'FEATURED': 'featured.json', 'USAGE': 'usage.tsv'}.items(): values[key] = root / 'config' / filename
        for key, value in values.items(): stack.enter_context(patch.object(config, key, value))
        config.PROJECTS.mkdir(); config.CONFIG.mkdir()
        for name in ('alpha', 'beta'): (config.PROJECTS / name).mkdir()
        runs._events_cache.clear(); projects.invalidate()
        self.addCleanup(projects.invalidate)

    def task(self, project='alpha', provider='codex', **changes):
        task = tasks.new_task(project, provider, 'Prueba'); task.update(changes)
        return task

    def run_meta(self, provider='codex', **changes):
        meta = {'id': runs.new_id(), 'kind': 'agent', 'project': 'alpha', 'provider': provider,
                'created_at': time.time() - 30, 'cwd': str(config.PROJECTS / 'alpha')}
        meta.update(changes); write_json(config.RUNS / meta['id'] / 'meta.json', meta)
        return meta


class TaskTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_escape_round_trip(self):
        for value in ('línea\nsegunda\tcolumna', r'C:\new\tab\file', '\\n\n\\t\t', 'Español ☀', r'\unknown'):
            self.assertEqual(tasks.decode(tasks.encode(value)), value)

    def test_persist_all_fields_and_multiline_prompt(self):
        task = self.task(details='```js\nconsole.log("a\\nb");\n```\tfin', origin='chat')
        tasks.save_tasks([task]); self.assertEqual(tasks.task_records(), [task])
        self.assertEqual(tasks.task_prompt(task), task['details'])
        self.assertEqual(config.TASKS.stat().st_mode & 0o777, 0o600)

    def test_legacy_five_columns(self):
        config.TASKS.write_text('# comentario\npendiente\talpha\talta\t2026-08-01\tHola\ninválido\n')
        task, = tasks.task_records()
        self.assertEqual((task['status'], task['provider'], task['title']), ('espera', 'codex', 'Hola'))

    def test_legacy_eleven_columns_preserve_literal_backslash(self):
        config.TASKS.write_text('\t'.join(['old', 'enviada', 'claude', 'alpha', 'alta', '2026-08-01', r'C:\new', r'\test', '', '', '']) + '\n')
        task, = tasks.task_records()
        self.assertEqual(task['status'], 'working'); self.assertEqual(task['title'], r'C:\new')
        self.assertEqual(task['details'], r'\test')

    def test_priority_is_stable(self):
        records = [self.task(priority=p) for p in ('baja', 'alta', 'media', 'alta')]
        self.assertEqual(tasks.pending_in_order(records), [records[1], records[3], records[2], records[0]])


class RunTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_claude_normalization(self):
        events, info = runs.normalize_claude([
            {'type': 'system', 'subtype': 'init', 'session_id': 'session', 'model': 'test'},
            {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Hola'}, {'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': 'echo hola'}}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': [{'type': 'text', 'text': 'hola'}]}]}},
            {'type': 'result', 'subtype': 'success', 'result': 'Listo', 'total_cost_usd': 0.01}])
        self.assertEqual(info['session_id'], 'session'); self.assertTrue(info['result']['ok'])
        self.assertEqual((events[1]['status'], events[1]['output']), ('done', 'hola'))

    def test_claude_failure_and_nested_tools(self):
        events, info = runs.normalize_claude([
            {'type': 'assistant', 'parent_tool_use_id': 'parent', 'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Read'}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'is_error': True, 'content': 'No existe'}]}},
            {'type': 'result', 'subtype': 'error_during_execution', 'is_error': True}])
        self.assertTrue(events[0]['sub']); self.assertEqual(events[0]['status'], 'error'); self.assertFalse(info['result']['ok'])

    def test_codex_updates_in_place_and_keeps_result(self):
        events, info = runs.normalize_codex([
            {'type': 'thread.started', 'thread_id': 'thread'},
            {'type': 'item.started', 'item': {'id': '1', 'type': 'command_execution', 'command': 'false'}},
            {'type': 'item.completed', 'item': {'id': '1', 'type': 'command_execution', 'command': 'false', 'exit_code': 1, 'aggregated_output': 'fallo'}},
            {'type': 'item.completed', 'item': {'id': '2', 'type': 'agent_message', 'text': 'Terminé'}},
            {'type': 'turn.completed', 'usage': {'output_tokens': 5}}])
        self.assertEqual(len(events), 2); self.assertEqual(events[0]['status'], 'error')
        self.assertEqual(info['result']['text'], 'Terminé')

    def test_codex_turn_failure(self):
        events, info = runs.normalize_codex([{'type': 'turn.failed', 'error': {'message': 'Sin cuota'}}])
        self.assertFalse(info['result']['ok']); self.assertEqual(events[0]['text'], 'Sin cuota')

    def test_dispatches_every_free_project_chat_in_priority_order(self):
        # Un mensaje a la vez por chat (aunque cambie de agente); chats y proyectos distintos van en paralelo.
        records = [self.task(priority='baja'), self.task(priority='alta'), self.task(provider='claude', chat_id='otro'), self.task(project='beta')]
        tasks.save_tasks(records)
        with patch.object(tmux, 'host_server_ok', return_value=True), patch.object(runs, 'start_run', return_value=(True, 'iniciado', 'fake')) as start:
            self.assertTrue(runs.tick())
        self.assertEqual([c.args[0]['id'] for c in start.call_args_list], [records[1]['id'], records[2]['id'], records[3]['id']])
        self.assertEqual([r['status'] for r in tasks.task_records()], ['espera', 'working', 'working', 'working'])

    def test_finalizes_and_dispatches_next_in_same_tick(self):
        meta = self.run_meta(); write_json(config.RUNS / meta['id'] / 'exit.json', {'code': 0})
        (config.RUNS / meta['id'] / 'events.jsonl').write_text(json.dumps({'type': 'thread.started', 'thread_id': 'thread'}) + '\n')
        tasks.save_tasks([self.task(status='working', run_id=meta['id']), self.task()])
        with patch.object(tmux, 'host_server_ok', return_value=True), patch.object(runs, 'start_run', return_value=(True, 'iniciado', 'next')): runs.tick()
        self.assertEqual([r['status'] for r in tasks.task_records()], ['terminado', 'working'])
        self.assertEqual(runs.agent_sessions()['alpha']['codex']['id'], 'thread')

    def test_legacy_working_does_not_block_queue(self):
        tasks.save_tasks([self.task(status='working'), self.task()])
        with patch.object(tmux, 'host_server_ok', return_value=True), patch.object(runs, 'start_run', return_value=(True, 'iniciado', 'new')): runs.tick()
        self.assertEqual([r['status'] for r in tasks.task_records()], ['error', 'working'])

    def test_missing_process_becomes_error(self):
        meta = self.run_meta(); tasks.save_tasks([self.task(status='working', run_id=meta['id'])])
        with patch.object(tmux, 'has_session', return_value=False): runs.tick()
        self.assertEqual(tasks.task_records()[0]['status'], 'error'); self.assertTrue(runs.exit_info(meta['id'])['lost'])

    def test_timeout_requests_stop(self):
        meta = self.run_meta(created_at=time.time() - config.RUN_TIMEOUT_MINUTES * 60 - 1)
        tasks.save_tasks([self.task(status='working', run_id=meta['id'])])
        with patch.object(tmux, 'has_session', return_value=True): runs.tick()
        self.assertEqual((config.RUNS / meta['id'] / 'stop').read_text(), 'timeout')

    def test_dead_tmux_leaves_pending_task_for_recovery(self):
        tasks.save_tasks([self.task()])
        with patch.object(tmux, 'host_server_ok', return_value=False), patch.object(runs, 'start_run') as start: runs.tick()
        start.assert_not_called(); self.assertEqual(tasks.task_records()[0]['status'], 'espera')

    def test_stop_rejects_traversal(self): self.assertFalse(runs.request_stop('../../outside')[0])

    def test_failed_launch_does_not_store_unusable_claude_session(self):
        with patch.object(tmux, 'new_session', return_value=(False, 'tmux caído')): ok, _, run_id = runs.start_run(self.task(provider='claude'))
        self.assertFalse(ok); self.assertFalse(runs.agent_sessions()); self.assertEqual(runs.exit_info(run_id)['code'], 127)

    def test_approval_remember_duplicate_and_finished(self):
        meta = self.run_meta(provider='claude'); folder = config.RUNS / meta['id'] / 'approvals'; request_id = '123456-abcdef'
        write_json(folder / f'{request_id}.req.json', {'id': request_id, 'rule': 'Bash:npm run build', 'tool_name': 'Bash', 'input': {}})
        self.assertEqual(len(runs.pending_approvals(meta['id'])), 1)
        self.assertTrue(runs.answer_approval(meta['id'], request_id, 'allow', True)[0])
        self.assertEqual(runs.approval_rules('alpha'), ['Bash:npm run build'])
        self.assertFalse(runs.answer_approval(meta['id'], request_id, 'deny')[0]); self.assertFalse(runs.pending_approvals(meta['id']))
        write_json(config.RUNS / meta['id'] / 'exit.json', {'code': 0})
        self.assertFalse(runs.answer_approval(meta['id'], request_id, 'allow')[0])

    def test_invalid_approval_is_rejected(self):
        meta = self.run_meta(provider='claude'); self.assertFalse(runs.answer_approval(meta['id'], '../../escape', 'allow')[0])

    def test_concurrent_session_updates_preserve_every_project(self):
        with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(lambda i: runs.set_agent_session(f'p{i}', 'codex', f's{i}'), range(24)))
        self.assertEqual(len(runs.agent_sessions()), 24)

    def test_cannot_reset_active_conversation(self):
        tasks.save_tasks([self.task(status='working')]); self.assertFalse(runs.reset_conversation('alpha', 'codex')[0])

    def test_job_loss_is_reconciled(self):
        meta = {'id': runs.new_id(), 'kind': 'job', 'project': 'alpha', 'action': 'build', 'created_at': time.time() - 30}
        write_json(config.JOBS / meta['id'] / 'meta.json', meta)
        with patch.object(tmux, 'has_session', return_value=False): runs.tick()
        self.assertEqual(runs.describe_job(meta)['status'], 'error')

    def test_dashboard_cannot_shutdown_itself(self):
        with patch.object(config, 'HOST_APP_DIR', f'{config.HOST_PROJECTS}/alpha'): self.assertFalse(runs.start_job('alpha', 'down')[0])


class FileTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_traversal_and_external_symlinks_are_rejected(self):
        (config.PROJECTS / 'alpha' / 'outside').symlink_to(config.CONFIG, target_is_directory=True)
        for path in ('../beta', '../../config', 'outside', 'outside/new.txt', 'nul\0file'):
            with self.subTest(path=path), self.assertRaises(files.FileError): files.resolve('alpha', path, False)

    def test_project_itself_must_be_confined(self):
        with self.assertRaises(files.FileError): files.resolve('../config', '')

    def test_lossless_mtime_and_conflicts(self):
        files.write_file('alpha', 'test.txt', 'primero'); original = files.read_file('alpha', 'test.txt')
        self.assertIsInstance(original['mtime'], str)
        files.write_file('alpha', 'test.txt', 'segundo', original['mtime'])
        with self.assertRaises(files.FileError): files.write_file('alpha', 'test.txt', 'perdido', original['mtime'])
        self.assertEqual(files.read_file('alpha', 'test.txt')['content'], 'segundo')

    def test_upload_destination_and_collisions(self):
        self.assertEqual(files.save_upload('alpha', '', 'test.txt', b'1'), 'test.txt')
        self.assertEqual(files.save_upload('alpha', '', 'test.txt', b'2'), 'test-1.txt')
        self.assertEqual(files.save_upload('alpha', None, 'photo.png', b'png'), '.codex-manager/uploads/photo.png')

    def test_upload_does_not_follow_broken_symlink(self):
        outside = config.CONFIG / 'missing.txt'; (config.PROJECTS / 'alpha' / 'test.txt').symlink_to(outside)
        self.assertEqual(files.save_upload('alpha', '', 'test.txt', b'safe'), 'test-1.txt'); self.assertFalse(outside.exists())

    def test_binary_and_truncated_files(self):
        files.save_upload('alpha', '', 'binary', b'\0abc'); self.assertTrue(files.read_file('alpha', 'binary')['binary'])
        files.write_file('alpha', 'large', 'a' * (files.MAX_READ + 1)); self.assertTrue(files.read_file('alpha', 'large')['truncated'])

    def test_deleting_internal_symlink_preserves_target(self):
        target = config.PROJECTS / 'alpha' / 'target.txt'; target.write_text('preservar')
        link = target.with_name('link.txt'); link.symlink_to(target)
        files.operate('alpha', 'delete', 'link.txt')
        self.assertFalse(link.is_symlink()); self.assertEqual(target.read_text(), 'preservar')


class AuthTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_signed_token_expiry_tamper_and_password_rotation(self):
        token, expires = auth.make_token(); self.assertTrue(auth.valid_token(token)); self.assertFalse(auth.valid_token(token + 'x'))
        with patch.object(auth.time, 'time', return_value=expires + 1): self.assertFalse(auth.valid_token(token))
        with patch.object(config, 'PASSWORD', 'changed'): self.assertFalse(auth.valid_token(token))
        for bad in ('', 'invalid', '1.2.3.4'): self.assertFalse(auth.valid_token(bad))

    def test_credentials_and_empty_password(self):
        self.assertTrue(auth.check_credentials('tester', 'unit-password'))
        self.assertFalse(auth.check_credentials('tester', 'invalid'))
        with patch.object(config, 'PASSWORD', ''): self.assertFalse(auth.check_credentials('tester', ''))

    def test_throttling_and_expiry(self):
        for _ in range(6): auth.record_failure('ip')
        self.assertTrue(auth.throttled('ip'))
        with patch.object(auth.time, 'time', return_value=time.time() + 601): self.assertFalse(auth.throttled('ip'))
        auth.record_failure('ip'); auth.clear_failures('ip'); self.assertFalse(auth.throttled('ip'))

    def test_secret_initialization_is_thread_safe(self):
        with ThreadPoolExecutor(max_workers=8) as pool: tokens = list(pool.map(lambda _: auth.make_token()[0], range(16)))
        self.assertTrue(all(auth.valid_token(t) for t in tokens))


class ApprovalRuleTests(unittest.TestCase):
    def test_remembers_exact_command_only(self):
        self.assertEqual(approval.rule_for('Bash', {'command': 'npm run build'}), 'Bash:npm run build')
        self.assertNotEqual(approval.rule_for('Bash', {'command': 'npm run test'}), 'Bash:npm run build')

    def test_dangerous_commands_wrappers_and_operators_are_not_remembered(self):
        for command in ('rm -rf files', '/bin/rm file', 'sudo ls', 'env rm file', 'python3 -c pass', 'node -e x', 'echo x && ls',
                        'echo x; ls', 'echo $(whoami)', 'echo `whoami`', 'echo x > file', 'echo $COMMAND', 'docker compose down', 'git reset --hard', 'npx arbitrary'):
            with self.subTest(command=command): self.assertIsNone(approval.rule_for('Bash', {'command': command}))

    def test_web_rules_are_scoped_and_unknown_tools_not_remembered(self):
        self.assertEqual(approval.rule_for('WebFetch', {'url': 'https://example.com/docs'}), 'WebFetch:https://example.com')
        self.assertIsNone(approval.rule_for('Agent', {})); self.assertIsNone(approval.rule_for('Write', {}))


class RunnerCommandTests(unittest.TestCase):
    def test_codex_resume_stdin_and_sandbox(self):
        argv = runner.codex_command({'cwd': '/tmp', 'sandbox': 'read-only', 'resume_id': 'thread'})
        self.assertEqual(argv[-3:], ['resume', 'thread', '-']); self.assertIn('read-only', argv)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', argv)

    def test_claude_approvals_forwarded_and_bash_always_asks(self):
        argv = runner.claude_command({'permission': 'ask'}, Path('/tmp/run'))
        self.assertIn('--permission-prompt-tool', argv); self.assertNotIn('bypassPermissions', argv)
        self.assertIn('Bash', json.loads(argv[argv.index('--settings') + 1])['permissions']['ask'])

    def test_edits_mode_excludes_command_tools(self):
        argv = runner.claude_command({'permission': 'edits'}, Path('/tmp/run'))
        self.assertNotIn('Bash', argv[argv.index('--tools') + 1])


class DockerTests(unittest.TestCase):
    def test_compose_label_wins_over_name_prefix(self):
        other = {'Names': ['/poleana-game-web-1'], 'Labels': {'com.docker.compose.project': 'poleana-game'}}
        self.assertFalse(dockerapi.container_belongs_to(other, 'poleana')); self.assertTrue(dockerapi.container_belongs_to(other, 'poleana-game'))

    def test_demux_logs(self):
        frame = lambda stream, text: bytes([stream, 0, 0, 0]) + len(text).to_bytes(4, 'big') + text
        self.assertEqual(dockerapi.demux_logs(frame(1, b'hola\n') + frame(2, b'fallo\n')), [('stdout', 'hola\n'), ('stderr', 'fallo\n')])
        self.assertEqual(dockerapi.demux_logs(b'tty\n'), [('stdout', 'tty\n')])

    def test_dependency_start_order(self):
        db = {'Id': 'db', 'Labels': {'com.docker.compose.service': 'db'}}
        api = {'Id': 'api', 'Labels': {'com.docker.compose.service': 'api', 'com.docker.compose.depends_on': 'db:service_healthy:false'}}
        web = {'Id': 'web', 'Labels': {'com.docker.compose.service': 'web', 'com.docker.compose.depends_on': 'api:service_started:false'}}
        self.assertEqual([c['Id'] for c in dockerapi.start_order([web, api, db])], ['db', 'api', 'web'])

    def test_refuses_to_stop_dashboard_itself(self):
        me = {'Id': 'abc123full', 'Names': ['/codex-dashboard-dashboard-1'], 'State': 'running', 'Labels': {'com.docker.compose.project': 'codex-dashboard'}}
        with patch.object(dockerapi, 'docker', return_value=[me]), patch.object(dockerapi.socket, 'gethostname', return_value='abc123'), patch.object(dockerapi, 'container_action') as action:
            self.assertFalse(dockerapi.docker_action('codex-dashboard', 'stop')[0])
        action.assert_not_called()

    def test_stops_only_own_running_containers(self):
        rows = [{'Id': 'a', 'Names': ['/shop-web-1'], 'State': 'running', 'Labels': {'com.docker.compose.project': 'shop'}},
                {'Id': 'b', 'Names': ['/shop-db-1'], 'State': 'exited', 'Labels': {'com.docker.compose.project': 'shop'}},
                {'Id': 'c', 'Names': ['/news-news-1'], 'State': 'running', 'Labels': {'com.docker.compose.project': 'news'}}]
        with patch.object(dockerapi, 'docker', return_value=rows), patch.object(dockerapi, 'container_action', return_value=(True, 'ok')) as action:
            self.assertTrue(dockerapi.docker_action('shop', 'stop')[0]); self.assertEqual([c.args[0]['Id'] for c in action.call_args_list], ['a'])
            self.assertFalse(dockerapi.docker_action('shop', 'stop', 'c')[0])


class ProjectTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_atomic_scaffold_for_both_base_stacks(self):
        for stack in ('web', 'node'):
            ok, message = projects.create_project(f'new-{stack}', 'Prueba <segura>', stack); self.assertTrue(ok, message)
            target = config.PROJECTS / f'new-{stack}'
            for name in ('README.md', 'Dockerfile', 'compose.yaml', '.env.example', '.git'): self.assertTrue((target / name).exists(), name)
            self.assertIn('healthcheck:', (target / 'compose.yaml').read_text()); self.assertEqual(target.stat().st_mode & 0o777, 0o750)
            self.assertIn('HEALTHCHECK', (target / 'Dockerfile').read_text())
            self.assertTrue((target / '.git/refs/heads/main').is_file())
            self.assertIn('COPY public/', (target / 'Dockerfile').read_text())
            self.assertFalse(projects.create_project(f'new-{stack}')[0])

    def test_invalid_names(self):
        for name in ('BadName', 'bad_name', '-bad', 'bad-', '../bad', 'api', 'traefik'): self.assertFalse(projects.create_project(name)[0], name)

    def test_cache_reuses_snapshot(self):
        with patch.object(projects, '_snapshot_uncached', return_value={'cached': True}) as build: self.assertEqual(projects.snapshot(), projects.snapshot())
        self.assertEqual(build.call_count, 1)
