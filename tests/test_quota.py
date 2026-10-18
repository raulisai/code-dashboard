import unittest
from unittest.mock import patch
from cm import quota, repos
from test_core import IsolatedConfig
from http_support import start_client, login_client

RAW = {'ok': True,
       'claude': {'state': 'ok', 'windows': [{'minutes': 300, 'used': 59.0, 'resets_at': '2026-10-18T03:59:59+00:00'}, {'minutes': 10080, 'used': 138, 'resets_at': None}]},
       'codex': {'state': 'ok', 'plan': 'plus', 'windows': [{'minutes': 300, 'used': 100.0, 'resets_at': 1792287659}], 'credits': {'has': False, 'unlimited': False, 'balance': '0'}}}


class QuotaTests(IsolatedConfig, unittest.TestCase):
    def setUp(self): self.isolate(); quota._cache.update(at=0, data=None)

    def test_normalizes_clamps_and_caches(self):
        with patch.object(repos, 'host_op', return_value=RAW) as op:
            data = quota.read(); again = quota.read()
        self.assertEqual(op.call_count, 1); self.assertIs(data, again)
        self.assertEqual(data['claude']['windows'][0]['resets_at'], 1792295999.0)
        self.assertEqual(data['claude']['windows'][1]['used'], 100.0)
        self.assertEqual((data['codex']['plan'], data['codex']['windows'][0]['resets_at']), ('plus', 1792287659.0))
        self.assertFalse(data['stale'])

    def test_failure_keeps_last_reading_as_stale(self):
        with patch.object(repos, 'host_op', return_value=RAW): quota.read()
        with patch.object(repos, 'host_op', side_effect=repos.RepoError('tmux caído')):
            data = quota.read(refresh=True)
        self.assertTrue(data['stale']); self.assertEqual(data['codex']['state'], 'ok')

    def test_failure_without_history_reports_error(self):
        with patch.object(repos, 'host_op', side_effect=repos.RepoError('tmux caído')):
            data = quota.read()
        self.assertEqual((data['claude']['state'], data['stale']), ('error', True))


class QuotaHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); quota._cache.update(at=0, data=None); self.client = await start_client(self)

    async def test_requires_login_and_returns_quota(self):
        self.assertEqual((await self.client.get('/api/quota')).status, 401)
        await login_client(self)
        with patch.object(repos, 'host_op', return_value=RAW):
            response = await self.client.get('/api/quota?refresh=1')
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['codex']['windows'][0]['used'], 100.0)


if __name__ == '__main__':
    unittest.main()
