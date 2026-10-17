import unittest
from unittest.mock import patch
from cm import availability, config, runs, tasks
from cm.util import write_json
from test_core import IsolatedConfig

class AvailabilityTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate()

    def fail(self, task, provider, message='You have hit your usage limit'):
        meta = self.run_meta(provider=provider, project=task['project'], task_id=task['id'], providers_tried=task.get('providers_tried',''))
        info = {'result':{'ok':False,'text':message}}
        with patch.object(runs,'exit_info',return_value={'code':1}), patch.object(runs,'run_events',return_value=([],info)):
            runs._finalize(task,meta)
        return meta

    def test_quota_failover_continues_same_task_and_stops_after_both(self):
        task=self.task(project=config.GENERAL, provider='codex', status='working', providers_tried='codex')
        self.fail(task,'codex')
        self.assertEqual((task['provider'],task['status']),('claude','espera'))
        self.assertFalse(availability.status()['codex']['available'])
        task['status']='working'
        self.fail(task,'claude','Credit balance is too low')
        self.assertEqual(task['status'],'error')
        self.assertEqual(set(task['providers_tried'].split(',')),{'claude','codex'})
        tasks.save_tasks([task]); self.assertEqual(tasks.task_records()[0]['providers_tried'],task['providers_tried'])

    def test_only_availability_failures_retry_only_general(self):
        for project,message in [('alpha','Usage limit exceeded'),(config.GENERAL,'Test assertion failed')]:
            task=self.task(project=project, status='working')
            self.fail(task,'codex',message)
            self.assertEqual(task['status'],'error')

    def test_chooses_available_then_success_clears_observation(self):
        availability.observe('codex','quota')
        self.assertEqual(availability.choose('codex'),'claude')
        availability.observe('codex')
        self.assertEqual(availability.choose('codex'),'codex')
        self.assertIsNone(availability.choose('codex',['claude','codex']))
        self.assertEqual(availability.failure({'result':{'text':'invalid_api_key'}}),'auth')
        self.assertEqual(availability.failure({'result':{'text':'temporarily unavailable'}}),'temporary')

    def test_streamed_text_deduplicates_final_message(self):
        events,info=runs.normalize_claude([
            {'type':'stream_event','event':{'type':'content_block_start','content_block':{'type':'text'}}},
            {'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'Hola '}}},
            {'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'mundo'}}},
            {'type':'assistant','message':{'content':[{'type':'text','text':'Hola mundo'}]}}])
        self.assertEqual([e['text'] for e in events],['Hola mundo'])
        self.assertFalse(events[0]['streaming'])

    def test_quota_rejection_never_masquerades_as_success(self):
        meta=self.run_meta()
        self.assertEqual(runs.run_status(meta,{'code':0},{'limits':{'status':'rejected'}}),'error')
        self.assertEqual(runs.run_status(meta,{'code':0},{'limits':{'status':'rejected'},'result':{'ok':True}}),'done')

    def test_scheduler_retries_once_with_context_and_persists_attempts(self):
        meta=self.run_meta(provider='codex', project=config.GENERAL)
        task=self.task(project=config.GENERAL, provider='codex', status='working', run_id=meta['id'])
        write_json(config.RUNS/meta['id']/'exit.json', {'code':1})
        (config.RUNS/meta['id']/'events.jsonl').write_text('{"type":"turn.failed","error":{"message":"Usage limit exceeded"}}\n')
        tasks.save_tasks([task])
        with patch('cm.tmux.new_session',return_value=(True,'')), patch('cm.tmux.host_server_ok',return_value=True):
            runs.tick()
        current=tasks.task_records()[0]
        self.assertEqual((current['provider'],current['status']),('claude','working'))
        self.assertEqual(set(current['providers_tried'].split(',')),{'claude','codex'})
        self.assertIn('Continuidad automática',(config.RUNS/current['run_id']/'prompt.txt').read_text())
