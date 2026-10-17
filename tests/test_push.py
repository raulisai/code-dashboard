import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException
from cm import auth, config, push, tasks
from test_core import IsolatedConfig


class PushTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate(); push.RETRY_AT.clear()
        with auth._db() as db: self.session = auth._new_session(db, mfa=True, remember=True)
        key = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.subscription = {'endpoint': 'https://fcm.googleapis.com/fcm/send/cm-unit-test', 'keys': {'auth': push.b64(b'a' * 16), 'p256dh': push.b64(key)}}

    def test_vapid_key_is_stable_and_private(self):
        public = push.public_key()
        self.assertEqual(len(public), 87); self.assertEqual(public, push.public_key())
        self.assertEqual(push.key_file().stat().st_mode & 0o777, 0o600)

    def test_rejects_non_push_endpoints_and_invalid_keys(self):
        for endpoint in ('https://127.0.0.1/admin', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.test/x',
                         'https://fcm.googleapis.com:8000/x', 'https://user:pass@fcm.googleapis.com/x'):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError): push.validate({**self.subscription, 'endpoint': endpoint})
        with self.assertRaises(ValueError): push.validate({**self.subscription, 'keys': {}})

    def test_deduplicates_and_delivers_new_results_only(self):
        tasks.save_tasks([self.task(status='terminado', run_id='old')])
        sid = push.subscribe(self.subscription, self.session['id']); self.assertEqual(sid, push.subscribe(self.subscription, self.session['id']))
        push.public_key()
        with patch.object(push, 'webpush') as send:
            push.deliver_once(); send.assert_not_called()
            tasks.save_tasks([self.task(status='terminado', run_id='new')]); push.deliver_once(); push.deliver_once()
            self.assertEqual(send.call_count, 1)
            payload = json.loads(send.call_args.kwargs['data']); self.assertEqual(payload['url'], '/p/alpha?chat=main')
        push.unsubscribe(self.subscription['endpoint'])
        self.assertEqual(json.loads(push.subscription_file().read_text()), {})

    def test_expired_subscription_is_removed(self):
        push.public_key(); push.subscribe(self.subscription, self.session['id'])
        tasks.save_tasks([self.task(status='error', run_id='new')])
        error = WebPushException('expired', response=SimpleNamespace(status_code=410))
        with patch.object(push, 'webpush', side_effect=error): push.deliver_once()
        self.assertEqual(json.loads(push.subscription_file().read_text()), {})

    def test_transient_failure_retries_without_losing_event(self):
        push.public_key(); push.subscribe(self.subscription, self.session['id']); tasks.save_tasks([self.task(status='error', run_id='new')])
        with patch.object(push, 'webpush', side_effect=WebPushException('temporary')) as send:
            push.deliver_once(); push.deliver_once(); self.assertEqual(send.call_count, 1)
        push.RETRY_AT.clear()
        with patch.object(push, 'webpush') as send: push.deliver_once(); self.assertEqual(send.call_count, 1)

    def test_revoked_and_legacy_sessions_receive_no_private_notifications(self):
        push.public_key(); push.subscribe(self.subscription, self.session['id'])
        tasks.save_tasks([self.task(status='error', run_id='new')])
        auth.revoke_token(self.session['token'])
        with patch.object(push, 'webpush') as send: push.deliver_once(); send.assert_not_called()
        self.assertEqual(json.loads(push.subscription_file().read_text()), {})
        push.subscribe(self.subscription)
        tasks.save_tasks([self.task(status='error', run_id='new-legacy')])
        with patch.object(push, 'webpush') as send: push.deliver_once(); send.assert_not_called()
