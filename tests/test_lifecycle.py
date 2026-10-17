import json
import sys
import time
import unittest
from unittest.mock import patch
from cm import config, dockerapi, lifecycle, runs, tasks, tmux
from cm.util import write_json
from test_core import IsolatedConfig, load_script

host_delete = load_script('host_delete', 'cm-project-delete.py')


class LifecycleTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def test_self_and_path_traversal_are_protected(self):
        for name in ('../alpha', 'BadName', 'missing'):
            with self.assertRaises(ValueError): lifecycle.root_for(name)
        with patch.object(config, 'HOST_APP_DIR', config.host_path(config.PROJECTS / 'alpha')):
            with self.assertRaises(ValueError): lifecycle.root_for('alpha')
        (config.PROJECTS / 'linked').symlink_to(config.PROJECTS / 'alpha', target_is_directory=True)
        with self.assertRaises(ValueError): lifecycle.root_for('linked')

    def test_active_agents_prevent_deletion(self):
        tasks.save_tasks([self.task(status='working')])
        with patch.object(dockerapi, 'project_containers', return_value=[]), patch.object(tmux, 'new_session') as start:
            ok, message, _ = lifecycle.start_delete('alpha', 'alpha')
        self.assertFalse(ok); self.assertIn('Detén', message); start.assert_not_called()

    def test_requires_exact_confirmation(self):
        self.assertFalse(lifecycle.start_delete('alpha', 'ALPHA')[0])

    def test_launch_failure_does_not_cancel_pending_work(self):
        tasks.save_tasks([self.task()])
        with patch.object(dockerapi, 'project_containers', return_value=[]), patch.object(tmux, 'new_session', return_value=(False, 'no tmux')):
            ok, _, _ = lifecycle.start_delete('alpha', 'alpha')
        self.assertFalse(ok); self.assertFalse(lifecycle.deleting('alpha'))
        self.assertEqual(tasks.task_records()[0]['status'], 'espera')

    def test_reservation_cancels_only_this_project_and_preserves_recovery(self):
        tasks.save_tasks([self.task(), self.task(project='beta')])
        runs.set_agent_session('alpha', 'codex', 'old-session'); runs.set_agent_session('beta', 'codex', 'other-session')
        write_json(config.RULES_FILE, {'alpha': ['Bash:npm run build'], 'beta': ['WebSearch']})
        with patch.object(dockerapi, 'project_containers', return_value=[]), patch.object(tmux, 'new_session', return_value=(True, '')):
            ok, _, job_id = lifecycle.start_delete('alpha', 'alpha')
        self.assertTrue(ok); self.assertTrue(lifecycle.deleting('alpha'))
        self.assertEqual([t['status'] for t in tasks.task_records()], ['error', 'espera'])
        self.assertEqual(runs.job_meta(job_id)['recovery']['sessions']['codex']['id'], 'old-session')
        self.assertEqual(runs.agent_sessions()['beta']['codex']['id'], 'other-session')
        self.assertEqual(runs.approval_rules('alpha'), []); self.assertEqual(runs.approval_rules('beta'), ['WebSearch'])
        self.assertFalse(runs.start_job('alpha', 'deploy')[0])

    def test_trash_restore_and_collision_guards(self):
        archive_id = runs.new_id(); folder = config.PROJECTS / '.cm-trash' / archive_id
        write_json(folder / 'meta.json', {'project': 'restored', 'deleted_at': time.time()})
        (folder / 'project').mkdir(); (folder / 'project/README.md').write_text('datos conservados')
        self.assertEqual(lifecycle.trash()[0]['project'], 'restored')
        self.assertTrue(lifecycle.restore(archive_id)[0]); self.assertFalse(lifecycle.trash())
        self.assertEqual((config.PROJECTS / 'restored/README.md').read_text(), 'datos conservados')
        self.assertFalse(lifecycle.restore(archive_id)[0]); self.assertFalse(lifecycle.restore('../../alpha')[0])

    def test_host_archives_without_executing_compose_or_removing_volumes(self):
        job_id = runs.new_id(); folder = config.JOBS / job_id
        write_json(folder / 'meta.json', {'id': job_id, 'project': 'alpha', 'projects_root': str(config.PROJECTS), 'action': 'delete-project', 'container_ids': []})
        with patch.object(sys, 'argv', ['cm-project-delete.py', str(folder)]), patch.object(host_delete, 'command', return_value='') as command, patch.object(host_delete.subprocess, 'run'):
            host_delete.main()
        self.assertFalse((config.PROJECTS / 'alpha').exists())
        self.assertTrue((config.PROJECTS / '.cm-trash' / job_id / 'project').is_dir())
        self.assertFalse(any('compose' in call.args[0] or 'volume' in call.args[0] for call in command.call_args_list))

    def test_host_never_adopts_other_compose_project_by_prefix(self):
        container = {'Name': '/alpha-other-web-1', 'Config': {'Labels': {'com.docker.compose.project': 'alpha-other'}}}
        self.assertFalse(host_delete.belongs(container, 'alpha'))
